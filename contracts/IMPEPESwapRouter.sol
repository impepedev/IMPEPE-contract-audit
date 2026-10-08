// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IMPEPEHook} from "./IMPEPEHook.sol";
// ERC20 IMD/IMPEPE exact-input router. Native ETH routing requires a separately reviewed adapter.
contract IMPEPESwapRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using BalanceDeltaLibrary for BalanceDelta;
    IPoolManager public immutable manager;
    IMPEPEHook public immutable hook;
    bool private swapping;
    constructor(IPoolManager poolManager, IMPEPEHook fees) {
        require(address(poolManager) == address(fees.manager()), "manager");
        manager = poolManager;
        hook = fees;
    }
    function swapExactInput(
        PoolKey calldata key,
        bool zeroForOne,
        uint128 amountIn,
        uint256 minimumOut,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        require(
            block.timestamp <= deadline && amountIn > 0 && address(key.hooks) == address(hook),
            "swap configuration"
        );
        swapping = true;
        bytes memory result = manager.unlock(
            abi.encode(key, zeroForOne, amountIn, minimumOut, msg.sender)
        );
        swapping = false;
        amountOut = abi.decode(result, (uint256));
        hook.flushFees();
    }
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager) && swapping, "router callback");
        (PoolKey memory key, bool direction, uint128 amount, uint256 minOut, address payer) = abi
            .decode(data, (PoolKey, bool, uint128, uint256, address));
        BalanceDelta delta = manager.swap(
            key,
            SwapParams(
                direction,
                -int256(uint256(amount)),
                direction ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            ""
        );
        int128 input = direction ? delta.amount0() : delta.amount1();
        int128 output = direction ? delta.amount1() : delta.amount0();
        require(
            input < 0 &&
                uint256(uint128(-input)) == amount &&
                output >= 0 &&
                uint256(uint128(output)) >= minOut,
            "amount or slippage"
        );
        Currency inputCurrency = direction ? key.currency0 : key.currency1;
        Currency outputCurrency = direction ? key.currency1 : key.currency0;
        manager.sync(inputCurrency);
        IERC20(Currency.unwrap(inputCurrency)).safeTransferFrom(payer, address(manager), amount);
        manager.settle();
        manager.take(outputCurrency, payer, uint256(uint128(output)));
        return abi.encode(uint256(uint128(output)));
    }
}
