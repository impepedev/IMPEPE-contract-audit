# IMPEPE IMD audit scope

Historical request for the original audit of commit `cafc305e764f0300c8ddf9d70feea2113a58b913`, now completed. The following scope preserves that audit's original assumptions. Current v1.2 rules, local remediation evidence and owner acceptance are documented in `AUDIT_REMEDIATION.md` and `artifacts/audit-approval.json`. No new audit is requested by this repository update

Audit this exact repository commit without changing code or deploying contracts. Review the complete system, not isolated contracts. Use the compiler-input and contract manifest to identify the reviewed artifacts. Report the commit, source hashes, compiler version, assumptions, testing performed and any review limitations.

## Contracts in scope

1. ProjectToken — fixed 1 billion supply, 98 percent liquidity allocation, 2 percent admin allocation, historical balance-time scores, holder registry, sealed exclusions
2. LiquidityBootstrap — permanently locked single-sided Uniswap v4 liquidity and atomic initialization
3. SwarmCollection — directly deployed ERC-721, 1000 supply cap, on-chain artwork and transfer reward settlement
4. ReceiptVerifier — independent signer authorizations for artifacts, finality and recovery
5. RewardsDistributor — equal per-NFT claims and seller credits
6. CreationController — funding, finalized cutoffs, ranking, bounded job payments, artwork submission, recovery and migration
7. FeeRouter — 3 percent creation/reward allocation, 1 percent protocol allocation and migration escrow
8. HookFactory — administrator-only CREATE2 deployment
9. IMPEPEHook — permission-address validation, official v4 PoolManager callbacks and IMD fee accounting
10. IMPEPESwapRouter — exact-input swaps, deadlines, minimum outputs and atomic fee settlement

SVGRenderer is an embedded library, not an eleventh deployed contract. Its geometry, animation constraints, storage/rendering costs, uniqueness checks and SVG validity are in scope.

## Supporting source in scope

- scripts/deployment-plan.mjs, opening-price.mjs, compile.mjs, prepare-recovery.mjs, contract-manifest.mjs and verify-release.mjs
- backend code supporting IMD quotes/admission/payment, finalized indexing, holder selection, artifact evidence, independent signing, transaction outbox and worker coordination
- tests and locked dependencies
- deployment.json contains public deployment inputs only; empty signer/nonce inputs and false approval flags are intentionally unresolved
- Supporting backend files may contain unrelated website/API features. Identify any security interaction with contract operations; the public airdrop database is not the subject of this contract audit

## Required economic and authority invariants

- Fixed supply is exactly 1 billion tokens with 18 decimals; no subsequent mint capability
- Genesis allocation is 980 million to LiquidityBootstrap and 20 million to the established admin
- Before NFT #1000, the hook collects the configured 4 percent fee in IMD, split 3 percent to creation and 1 percent to the protocol recipient
- After NFT #1000, the 3 percent allocation permanently routes to the existing RewardsDistributor; surplus creation funds are settled as implemented
- One NFT earns one equal share; multiple NFTs earn proportionally; transfers preserve the seller's accrued claim and assign future accrual to the buyer
- Original recipients are selected by historical balance-time score accumulated from token genesis, with a positive cutoff balance, sealed exclusions, lower-address tie breaking and at most one original allocation per address
- Operator cannot choose a recipient, arbitrarily mint, redirect the fixed payment recipient, or forge an independent artifact authorization
- The signer must be distinct from admin and Operator. This is a trusted independent EIP-712 bridge, not a native trustless IMD or Ethereum consensus proof
- Failed-job recovery requires signed authorization and return of the exact prior budget, preserving NFT number and recipient
- Exhausted holder snapshots advance only to the earliest later funding snapshot, not a freely chosen cutoff
- Rejecting ERC-721 receiver callbacks cannot stall minting because direct minting without the callback is an approved design decision
- Creation migration may replace the controller/evidence service but cannot replace the token, unlock the pool or confiscate existing NFTs or holder rewards
- Delayed administrator recovery is an explicit trust boundary: a delay does not prove failure or enforce redeposit

## Specific attack surfaces

Review v4 callback access, hook permission bits and CREATE2 salt handling; exact-input buy/sell direction and fee rounding; claim flushing and alternate routers; pool protocol-fee changes; opening tick orientation; single-sided zero-IMD initial reserves; liquidity math overflow and rounding; initialization front-running; unauthorized liquidity addition/removal; reserve exhaustion and slippage behavior.

Review reentrancy through ERC-20 interactions, minting, reward settlement, migration and callbacks; signature domain separation, replay and expiry; finality attestations and chain reorg assumptions; zero/non-contract/mismatched addresses; setup order, one-time setters and owner renunciation; malicious or unavailable admin, Operator, signer and external protocol; nonce-dependent token/vault address prediction; same-block scoring; holder registry spam and gas/liveness; checkpoint overflow; serialized job stalls; recovery/ancestry limits; duplicate requests/artwork; backend input-hash binding and immutable job-price compatibility.

Test both token address orderings. Distinguish genuine vulnerabilities from explicitly approved trust assumptions and describe the consequences of each assumption.

## Evidence and deliverables

For each finding provide severity, affected source lines/functions, preconditions, attack steps, impact, a reproducible test or proof where feasible, and remediation. Review existing tests critically; tests mirroring implementation are not proof of security. Run the repository's existing Node/Hardhat tests where supported. If a Foundry proof is necessary, create a review artifact without claiming this repository already uses Foundry.

The existing 21 contract/opening-price tests pass locally. The #1000 transition test seeds #999 state; it is not a 1000-job end-to-end run. Constructor gas simulation is not a security audit. No real paid IMD creation job has completed and no contract has been deployed on mainnet by this project.

Return a consolidated report of critical/high/medium/low findings, trust assumptions, operational prerequisites and unresolved coverage. Do not issue a legal opinion or claim the project is legally approved. Do not declare audit approval merely because tests pass.
