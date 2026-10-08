// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {FeeRouter} from "./FeeRouter.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
contract IMPEPEHook is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using BalanceDeltaLibrary for BalanceDelta;
    IPoolManager public immutable manager;
    address public immutable imd;
    address public immutable project;
    FeeRouter public immutable router;
    int24 public immutable spacing;
    address public immutable liquidityOwner;
    uint256 public pendingCreation;
    uint256 public pendingProtocol;
    bool private flushing;
    event FeesAccrued(uint256 grossImd, uint256 allocation, uint256 protocol);
    function accrue(uint256 gross, uint256 fee) private {
        uint256 allocation = (gross * 3) / 100;
        pendingCreation += allocation;
        pendingProtocol += fee - allocation;
        manager.mint(address(this), uint256(uint160(imd)), fee);
        emit FeesAccrued(gross, allocation, fee - allocation);
    }
    function flushFees() external nonReentrant {
        uint256 allocation = pendingCreation;
        uint256 protocol = pendingProtocol;
        if (allocation + protocol == 0) return;
        pendingCreation = 0;
        pendingProtocol = 0;
        flushing = true;
        manager.unlock(abi.encode(allocation + protocol));
        flushing = false;
        router.routeAmounts(allocation, protocol);
    }
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager) && flushing, "fee settlement only");
        uint256 amount = abi.decode(data, (uint256));
        manager.burn(address(this), uint256(uint160(imd)), amount);
        manager.take(Currency.wrap(imd), address(this), amount);
        return "";
    }
    constructor(
        IPoolManager poolManager,
        address money,
        address token,
        FeeRouter fees,
        int24 tickSpacing,
        address lockedVault
    ) {
        require(
            address(poolManager) != address(0) &&
                money != token &&
                tickSpacing > 0 &&
                lockedVault.code.length > 0,
            "configuration"
        );
        manager = poolManager;
        imd = money;
        project = token;
        router = fees;
        spacing = tickSpacing;
        liquidityOwner = lockedVault;
        Hooks.Permissions memory p;
        p.beforeInitialize = true;
        p.beforeAddLiquidity = true;
        p.beforeRemoveLiquidity = true;
        p.beforeSwap = true;
        p.afterSwap = true;
        p.beforeSwapReturnDelta = true;
        p.afterSwapReturnDelta = true;
        Hooks.validateHookPermissions(IHooks(address(this)), p);
        IERC20(money).forceApprove(address(fees), type(uint256).max);
    }
    modifier onlyManager() {
        require(msg.sender == address(manager), "pool manager");
        _;
    }
    function check(PoolKey calldata key) private view {
        address a = Currency.unwrap(key.currency0);
        address b = Currency.unwrap(key.currency1);
        require(
            ((a == imd && b == project) || (a == project && b == imd)) &&
                key.fee == 0 &&
                key.tickSpacing == spacing &&
                address(key.hooks) == address(this),
            "official pool only"
        );
    }
    function beforeInitialize(
        address sender,
        PoolKey calldata key,
        uint160
    ) external onlyManager returns (bytes4) {
        check(key);
        require(sender == liquidityOwner, "vault initializes pool");
        return this.beforeInitialize.selector;
    }
    function beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) external onlyManager returns (bytes4) {
        check(key);
        require(sender == liquidityOwner, "locked vault only");
        return this.beforeAddLiquidity.selector;
    }
    function beforeRemoveLiquidity(
        address,
        PoolKey calldata key,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) external onlyManager returns (bytes4) {
        check(key);
        revert("liquidity permanently locked");
    }
    function inputIsImd(
        PoolKey calldata key,
        SwapParams calldata params
    ) private view returns (bool) {
        return Currency.unwrap(params.zeroForOne ? key.currency0 : key.currency1) == imd;
    }
    function beforeSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    ) external onlyManager returns (bytes4, BeforeSwapDelta, uint24) {
        check(key);
        (, , uint24 protocolFee, ) = StateLibrary.getSlot0(manager, PoolIdLibrary.toId(key));
        require(protocolFee == 0, "additional pool protocol fee unsupported");
        require(
            params.amountSpecified < 0 && params.amountSpecified != type(int256).min,
            "exact input only"
        );
        if (!inputIsImd(key, params)) return (this.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        uint256 gross = uint256(-params.amountSpecified);
        uint256 fee = (gross * 4) / 100;
        require(fee <= uint256(uint128(type(int128).max)), "fee range");
        if (fee > 0) accrue(gross, fee);
        return (this.beforeSwap.selector, toBeforeSwapDelta(int128(uint128(fee)), 0), 0);
    }
    function afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external onlyManager returns (bytes4, int128) {
        check(key);
        bool buying = inputIsImd(key, params);
        int128 actualInput = params.zeroForOne ? delta.amount0() : delta.amount1();
        uint256 grossInput = uint256(-params.amountSpecified);
        uint256 expected = buying ? grossInput - (grossInput * 4) / 100 : grossInput;
        require(
            actualInput < 0 && uint256(uint128(-actualInput)) == expected,
            "partial fills unsupported"
        );
        if (buying) return (this.afterSwap.selector, 0);
        int128 output = Currency.unwrap(key.currency0) == imd ? delta.amount0() : delta.amount1();
        require(output >= 0, "output");
        uint256 gross = uint256(uint128(output));
        uint256 fee = (gross * 4) / 100;
        if (fee > 0) accrue(gross, fee);
        return (this.afterSwap.selector, int128(uint128(fee)));
    }
    fallback() external {
        revert("unsupported callback");
    }
}
