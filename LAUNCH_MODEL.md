# IMPEPE single-sided launch

Accepted model: Ethereum Uniswap v4, IMPEPE/IMD, single-sided liquidity with a permanent lock. No graduation phase and no required initial IMD deposit. This replaces the earlier full-range position and timed withdrawal policy.

## Allocation and pool

One billion tokens are minted once: 980 million to LiquidityBootstrap and 20 million to the established deployer. The vault configures once. The opening tick must align with the tick spacing, sit strictly inside the usable extrema, and produce representable uint128 liquidity. For token0=IMPEPE, the range begins at the opening tick and ends at the maximum usable tick. For token1=IMPEPE, it begins at the minimum usable tick and ends at the opening tick. With equal 18-decimal assets, opening IMD per IMPEPE is 1.0001^tick in the first orientation and its reciprocal in the second. Deployment output includes an approximate price for review, not an oracle or a chosen price.

The vault calculates liquidity from its fixed allocation and initializes/seeds in one transaction. Initial real IMD reserves are zero. Up to 0.000001 IMPEPE of bounded rounding dust remains permanently trapped in the vault. The position has no withdrawal, principal transfer, sweep, delegatecall or upgrade path. The hook allows initialization/additions only by this vault and rejects every liquidity removal. The vault's callback can only add its fixed liquidity during seeding; configuration and seeding cannot repeat. Ownership transfers do not create a withdrawal right.

## Trades and fee settlement

Buyers deposit real IMD and receive IMPEPE. Sellers receive available real IMD by returning IMPEPE. Prices move along the chosen v4 range. Virtual quote liquidity describes the curve and is not deposited cash, available reserves or creation funding. Neither the opening market cap nor the locked token count measures real exit liquidity.

The hook accrues precisely 4% of gross IMD per trade in PoolManager ERC-6909 claims: 3% to creation/rewards and the remainder to protocol, preserving per-trade rounding. IMPEPESwapRouter accepts ERC20 IMD/IMPEPE exact-input trades with minimum output and deadline, settles the pool, then flushes fees atomically. It does not handle native ETH. External compatible v4 routers can trade; anyone can later flush their accumulated fee claims, and the worker flushes before opening work. Selection cutoffs use actual creation funding deposits, not unflushed claims. External-router settlement timing needs keeper monitoring.

The creator receives 2% as separately transferable tokens. The empty-IMD pool cannot pay a sell before buyers fund it. After buyers deposit IMD, those creator tokens can also be sold. Sell liquidity may run out at the opening boundary; a lock does not guarantee that all holders can exit. Exact-output and partially filled swaps are unsupported and revert rather than charging for an unfilled trade. The minimum output and deadline protect each router trade; a failed final fee flush reverts the entire router transaction.

## Project lifecycle

Before NFT #1000, the 3% funds genuine IMD agent work and the 1% goes to the established deployer/protocol recipient. At NFT #1000, future 3% goes to equal NFT-holder rewards permanently. Cumulative holder scoring, one original allocation per wallet, artifact authentication, geometry, transfer accounting and operator limits remain unchanged.

The approved target opening fully diluted valuation is 1,000 IMD, corresponding to 0.000001 IMD per token before tick rounding. Tick spacing 60 produces approximately 998.203 IMD valuation and 0.0000009982030284 IMD per token. The planner derives tick -138180 when IMPEPE is currency0, or +138180 when IMPEPE is currency1. It determines this from the predicted token address and IMD address; no signed tick is hardcoded before the deployer's nonce is known. artifacts/opening-price.json records both candidate orientations and the rounded preview. The target valuation is not deposited IMD or available sell reserves.

No launch transaction has been signed, no liquidity has been added, and no production swap or paid IMD job has been executed. Evidence/finality trust approval, recovery rules, live integration, audit and specialist review remain in LAUNCH_READINESS.md.

References: https://developers.uniswap.org/docs/liquidity/overview and https://github.com/0xtenang/PepesFamily#how-it-works
