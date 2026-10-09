# IMPEPE live Ethereum token audit

Audit the deployed Ethereum mainnet system as it is. Do not change source, deploy contracts, submit transactions or mark it approved without findings. Website: https://www.impepe.fun

The live ERC-20 is contracts/IMPEPE.sol, NOT the legacy contracts/ProjectToken.sol. IMPEPE uses OpenZeppelin ERC20, with constructor-only minting of 1 billion tokens to the deploying wallet. It has no owner, token transfer tax, blacklist, pause or router allowance shortcut. Verify these statements against the deployed code rather than taking them as conclusions.

Live addresses (chain ID 1):

| Component | Address |
| --- | --- |
| IMPEPE token | 0x5018f7d89e1433dbc0c64e29092e2fa16192905d |
| IMD quote token | 0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7 |
| Uniswap PoolManager | 0x000000000004444c5dc75cB358380D2e3dE08A90 |
| IMPEPEFeeHook | 0x5108c5507dA225a4582E8629661b5D83d476aaCc |
| IMDLaunchSwapRouter | 0x3dbee01da73f4ccb8b781424527c67c579c2f718 |
| Liquidity bootstrap | 0x8f45658fc5ad35ce4fd0c85b541412097d28ba52 |
| Fee router | 0x42a02182432b7de815085efdbed8a0173f813f28 |
| CreationController | 0xde25d66569eb05b7c73f61310d028838b820b570 |
| SwarmCollection | 0x537d5ce0f449faa79affbdbb971cf444277a375a |
| RewardsDistributor | 0xea817217c31565a63c75c865eed8ba76a4ac72d5 |
| Receipt verifier | 0x5a832701be1504094db39c0d01d65b293e0aba66 |

Pool ID: 0xf468a137b19bc0822a46914599afad10af396ee876859f14ff46bbb5d0a1321c
Pool fee 0, tick spacing 60. The hook charges 4% on the IMD side, split 3% creation / 1% protocol. After NFT #1000, the 3% routes to equal-share NFT rewards. These rewards belong to NFT holders, not ERC-20 holders. The public allocation is 98% locked pool liquidity and 2% deployer; confirm current pool state separately from the historical allocation.

Prior audit files and owner approval records refer to older source versions and must not be treated as an audit of this deployed system. Legacy IMD standard-launch contracts also remain in the source tree; use the deployed addresses and bytecode matching to identify the actual scope.

## Required checks

1. Match source/build settings and constructor immutables against deployed bytecode; report discrepancies and any unverifiable component explicitly. Use the verified hook compiler input under artifacts/live-token-audit. Compiler Solidity 0.8.26, optimizer 200, Cancun; router deployment metadata settings are in its deployment record.
2. Assess sellability, honeypot-like behavior, arbitrary holder balance changes, mint/burn authority, unusual token functions and any actual scanner warnings. Do not assume GMGN/GoPlus issued warnings or that they are false positives; quote current evidence when available.
3. Trace router payer/recipient binding, approvals, manager-only callback, slippage, deadline, reentrancy and full-input checks in both swap directions. Test third-party routers and unsupported exact-output/partial-fill cases rather than extrapolating the reference project's findings.
4. Review hook return deltas, actual-versus-requested amount fee calculation, rounding, ERC-6909 claims, flush behavior during PoolManager unlock and fund solvency. Test flash-take/unlock accounting attacks and fee diversion with reproducible local or fork tests; never attack the live pool.
5. Verify locked liquidity cannot be withdrawn by admin, deployer, hook or another caller. State all remaining administrator powers and external IMD/Uniswap trust dependencies accurately.
6. Review creation budget custody, independent signer assumptions, holder selection, retries and delayed migration as they affect the 3% stream. Confirm migration cannot recover locked liquidity or already-accrued NFT rewards.
7. Exercise the irreversible NFT #1000 transition, per-NFT equal shares, proportional multiple ownership and preservation of seller-accrued rewards across transfers. Check no overdistribution, repeated claims or flash-NFT reward capture.

Return a public report with exact repository commit, chain/block used for live observations, component source matches, findings by severity, source lines, concrete impact, proof tests and recommended fixes. Clearly separate proven findings, assumptions, scanner limitations and untested areas. No predetermined pass verdict.
