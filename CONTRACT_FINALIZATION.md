# IMPEPE contract v1.2 source freeze

The active architecture is now the IMD standard launch adaptation described in IMD_LAUNCH_RUNBOOK.md. The v1.2 configuration and audit discussion below describe the prior implementation and must not be used as the active deployment sequence.

Date: 2026-10-08

Status: IMD audit findings remediated and locally tested; project-owner audit approval without a second audit. See AUDIT_REMEDIATION.md and artifacts/audit-approval.json for scope and accepted design risks

## Fixed economics and roles

Ethereum, one billion IMPEPE, 980 million in the official single-sided IMPEPE/IMD pool and 20 million to the established deployer. Liquidity is permanently locked without withdrawal or migration. No upfront IMD or bonding-curve graduation is required. Opening FDV targets 1,000 IMD, approximately 998.203 after tick rounding. The signed tick must be regenerated from final addresses and a fresh deployment nonce.

Established deployer/admin and 1% protocol recipient: 0x61aEFdAAa5FA9ac74AA0051238Fd4a37B1d24148. Separate Swarm Operator: 0x9A6dA9E6f2BEEF402C6A23E2fA1ee7c003cd31b4. SwarmCollection is deployed directly from the established wallet; OpenSea verification is not assumed to transfer. There is no separate mint wallet. The approved independent attestor must have a different address from admin and Operator; its public address is still needed. This adds an independent signing authority to the two project operational wallets.

## Ten deployments

| Contract | Responsibility |
| --- | --- |
| ProjectToken | Fixed supply and historical holder scores |
| LiquidityBootstrap | One-time seed and permanent liquidity lock |
| IMPEPEHook | Official Uniswap v4 pool and 4% IMD fee |
| FeeRouter | 3% creation/rewards and 1% protocol routing |
| CreationController | Snapshots, ranking, bounded jobs and mint sequence |
| SwarmCollection | 1,000 ERC-721 NFTs with committed on-chain art |
| RewardsDistributor | Equal NFT shares and pull claims |
| ReceiptVerifier | Independent artwork, finality and recovery attestations |
| IMPEPESwapRouter | Exact-input swaps, minimum output, deadline and atomic fee settlement |
| HookFactory | CREATE2 deployment at the hook permission address |

SVGRenderer is embedded in the collection, not another deployment. Existing IMD, PoolManager, Quoter and Permit2 are reused. The original approximately five-module target expanded to isolate liquidity, rewards, evidence and swap responsibilities.

## Holder selection and empty snapshots

Scoring starts at the first token mint and accumulates token-seconds. At least 10,000 IMPEPE at the cutoff is required, equal scores favor the lower numeric address, and each wallet receives at most one original allocation. Registry admission starts at the same minimum; earlier scores are preserved. Secondary transfers are unrestricted. Exclusions are sealed before pool seeding

The earliest cumulative creation-funding checkpoint covering the sequential job budget determines its snapshot. Current deployment budget: 0.5 IMD. Contract settlement: 128 blocks plus signed finality; backend: Ethereum finalized RPC state. Leaderboard display refreshes every 100 indexed blocks.

After every holder has been scanned and no eligible recipient exists, anyone can advance to the earliest strictly later funding block. Callers cannot choose an arbitrary cutoff or skip an eligible winner. Same-block checkpoints are skipped. NFT number and allocation rules remain unchanged; finality and ranking repeat. With no later funding checkpoint, the job waits.

## Art and NFT delivery

IMD agents produce the artwork. The Operator validates/authenticates and submits unchanged bytes; it cannot choose recipients or arbitrarily mint. Independent signatures bind artwork commitment, request, NFT number, controller, chain and expiry. Art uses exactly 100 whole cells on a 10x10 canvas, 300 RGB bytes per frame, up to eight frames and 13 animation identifiers. Fill animation preserves cell geometry. Contracts enforce geometry and uniqueness; progression in creative complexity and rarity requires agent/reviewer policy.

Direct minting skips ERC-721 receiver callbacks, as approved. Rejecting contracts cannot block delivery; some contract wallets may be unable to recover their NFT.

## Refund-backed recovery

Recovery preserves NFT number, selected wallet, snapshot and allocation reservation. An independent signature authorizes the current request and attempt, exact budget, payment recipient, controller, chain and expiry. The recovery caller must return the full prior budget via IMD transfer before another budget can be released. Refunds do not count as new fee funding. Recovery clears the paid flag/request and increments the attempt. Old request identifiers remain permanently blocked from reuse.

EIP-712 domain: IMPEPE Artifact, version 1, deployed verifier address and chain ID. Type: `Recovery(uint256 tokenId,bytes32 requestId,uint256 attempt,uint256 amount,address paymentRecipient,address controller,uint256 expiresAt)`. Proof: ABI-encoded `(uint256 expiresAt,bytes signature)`. A zero request ID supports a paid attempt that failed before admission/binding. The refund payer needs IMD and controller allowance.

Procedure: stop the worker; verify the old job cannot complete or consume an active payment authorization; cancel or await expiration of old payment authorizations as applicable; arrange the budget refund; independently review/sign recovery; review unsigned transactions using `node scripts/prepare-recovery.mjs evidence.json`; sign approval/recovery with the refund payer; wait for finality; restart one worker. The contract cannot cancel external x402 signatures or force IMD refunds. Never approve recovery while an old payment payload remains spendable.

The worker reconciles recovered attempts only after finalized on-chain confirmation, archives previous admissions and scopes fresh request keys/outboxes to the attempt. Archived admissions remain in truthful swarm counters. Stale artifact attempts and admission responses are rejected. Skipped database attempt history halts for manual reconciliation. One worker and coordinated recovery are required.

## Fees and rewards

The 4% eligible trading fee is 3% creation plus 1% protocol. Successful #1000 commit/mint atomically completes the collection and permanently redirects future 3% to NFT rewards. Unspent creation surplus also moves to rewards. One NFT has one equal share; multiple NFTs earn proportionally. Pull accounting preserves seller credits and assigns future rewards to buyers, without 1,000 transfers per trade.

## Verification and remaining deployment inputs

Included: Solidity source, pinned dependencies, ABI/bytecode artifacts, full standard compiler input, source/ABI/bytecode hashes, gas measurements, backend/schema, tests and unsigned deployment tooling. Local tests exercise actual Uniswap v4 PoolManager and canonical V4Quoter, both currency orientations, permanent liquidity lock, historical ranking, recovery, delivery, empty snapshots and the permanent #1000 transition. The transition test seeds #999 state, not 1,000 generated/minted works. Device evidence tests use local keys, not a real paid IMD receipt.

The original IMD audit is complete. The project owner approves v1.2 remediation after local regression testing and declines a second audit. No mainnet contract was deployed during remediation. Attestor address/custody/evidence operations, a fresh deployer nonce and real bounded artwork integration remain separate deployment inputs. The owner explicitly waived legal review as a deployment gate on 8 October 2026; legalReviewApproved remains false and legalReviewWaived is true. Immutable Operator/attestor key loss or an unavailable refund can halt creation. Owner acceptance is not a new independent audit or a mainnet safety certification

## Approved emergency creation migration

The v1.1 policy supersedes the earlier absence of a creation-fund withdrawal path. The admin may pause Phase I, schedule recovery to the immutable established deployer after 48 hours and complete a separately delayed controller/verifier replacement. Token, locked pool, issued NFTs and holder reward balances remain in place. Funding history, allocations, used requests and the current job are preserved. See EMERGENCY_MIGRATION.md for the exact sequence and authority limits. This does not make all contracts upgradeable.
