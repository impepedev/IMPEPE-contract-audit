// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Pool} from "@uniswap/v4-core/src/libraries/Pool.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {ProjectToken} from "./ProjectToken.sol";
interface ILiquidityHook {
    function manager() external view returns(address);
    function imd() external view returns(address);
    function project() external view returns(address);
    function spacing() external view returns(int24);
    function liquidityOwner() external view returns(address);
}
contract LiquidityBootstrap is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using BalanceDeltaLibrary for BalanceDelta;
    IPoolManager public immutable manager;
    IERC20 public immutable token;
    IERC20 public immutable imd;
    uint256 public constant POOL_ALLOCATION = 980_000_000 ether;
    bool public constant permanentlyLocked = true;
    int24 public openingTick;
    PoolKey public key;
    uint128 public positionLiquidity;
    int24 public lower;
    int24 public upper;
    bool public configured;
    bool private unlocking;
    event LiquiditySeeded(uint256 liquidity, uint256 depositedTokens, uint160 sqrtPriceX96);
    constructor(
        address admin,
        IPoolManager poolManager,
        IERC20 project,
        IERC20 money
    ) Ownable(admin) {
        require(
            address(poolManager) != address(0) &&
                address(project) != address(0) &&
                address(money) != address(0) &&
                address(project) != address(money),
            "configuration"
        );
        manager = poolManager;
        token = project;
        imd = money;
    }
    function configure(PoolKey calldata officialKey, int24 startTick) external onlyOwner {
        require(
            positionLiquidity == 0 &&
                officialKey.fee == 0 &&
                officialKey.tickSpacing > 0 && officialKey.tickSpacing <= 32767 &&
                address(officialKey.hooks).code.length > 0,
            "configuration"
        );
        ILiquidityHook hook = ILiquidityHook(address(officialKey.hooks));
        require(hook.manager() == address(manager) && hook.imd() == address(imd) && hook.project() == address(token) && hook.spacing() == officialKey.tickSpacing && hook.liquidityOwner() == address(this), "hook links");
        address a = Currency.unwrap(officialKey.currency0);
        address b = Currency.unwrap(officialKey.currency1);
        require(
            a < b &&
                ((a == address(token) && b == address(imd)) ||
                    (a == address(imd) && b == address(token))),
            "pair"
        );
        int24 minTick = (TickMath.MIN_TICK / officialKey.tickSpacing) * officialKey.tickSpacing;
        int24 maxTick = (TickMath.MAX_TICK / officialKey.tickSpacing) * officialKey.tickSpacing;
        require(
            startTick > minTick && startTick < maxTick && startTick % officialKey.tickSpacing == 0,
            "opening tick"
        );
        key = officialKey;
        configured = true;
        openingTick = startTick;
        lower = a == address(token) ? startTick : minTick;
        upper = a == address(token) ? maxTick : startTick;
        seedLiquidity();
    }
    function seedLiquidity() public view returns(uint128 result) {
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(lower);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(upper);
        bool token0 = Currency.unwrap(key.currency0) == address(token);
        uint256 calculated = token0
            ? FullMath.mulDiv(POOL_ALLOCATION,FullMath.mulDiv(sqrtA,sqrtB,1 << 96),sqrtB-sqrtA)
            : FullMath.mulDiv(POOL_ALLOCATION,1 << 96,sqrtB-sqrtA);
        require(calculated > 0 && calculated <= Pool.tickSpacingToMaxLiquidityPerTick(key.tickSpacing), "liquidity range");
        result = uint128(calculated);
        uint256 deposited = token0 ? SqrtPriceMath.getAmount0Delta(sqrtA,sqrtB,result,true) : SqrtPriceMath.getAmount1Delta(sqrtA,sqrtB,result,true);
        require(deposited <= POOL_ALLOCATION && POOL_ALLOCATION-deposited <= 1e12,"seed precision");
    }
    function seed() external onlyOwner nonReentrant {
        uint256 beforeBalance = token.balanceOf(address(this));
        require(configured && positionLiquidity == 0 && beforeBalance >= POOL_ALLOCATION, "seed");
        require(ProjectToken(address(token)).eligibilitySealed(), "seal eligibility first");
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(openingTick);
        uint128 calculated = seedLiquidity();
        positionLiquidity = calculated;
        // The sole initializer is this vault. Initialization and seeding are one atomic transaction.
        manager.initialize(key, sqrtPriceX96);
        unlocking = true;
        manager.unlock("");
        unlocking = false;
        uint256 deposited = beforeBalance - token.balanceOf(address(this));
        require(
            deposited <= POOL_ALLOCATION && POOL_ALLOCATION - deposited <= 1e12,
            "98 percent must enter liquidity"
        );
        emit LiquiditySeeded(calculated, deposited, sqrtPriceX96);
    }
    function unlockCallback(bytes calldata) external returns (bytes memory) {
        require(msg.sender == address(manager) && unlocking, "manager");
        (BalanceDelta delta, ) = manager.modifyLiquidity(
            key,
            ModifyLiquidityParams(lower, upper, int256(uint256(positionLiquidity)), bytes32(0)),
            ""
        );
        settle(key.currency0, delta.amount0());
        settle(key.currency1, delta.amount1());
        return "";
    }
    function settle(Currency currency, int128 amount) private {
        require(Currency.unwrap(currency) == address(token) || amount == 0, "single sided only");
        require(amount <= 0, "positive seed delta");
        if (amount < 0) {
            manager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(
                address(manager),
                uint256(uint128(-amount))
            );
            manager.settle();
        }
    }
    function renounceOwnership() public override onlyOwner { revert("ownership required"); }
}
