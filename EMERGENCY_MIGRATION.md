# Emergency creation recovery and migration

## Approved scope

Keep the original ProjectToken, locked Uniswap pool/hook/bootstrap/swap router, SwarmCollection and RewardsDistributor. Replace CreationController and its evidence service/ReceiptVerifier when necessary. There is no token redeployment, liquidity withdrawal, replacement of issued NFTs or administrator withdrawal of holder rewards.

The original two project wallet roles remain unchanged. Independent attestor replacement requires a new verifier/controller; its address must differ from the established admin and Operator.

## Recovery authority and delay

The creation controller owner can call `emergencyPause()` immediately during Phase I. Opening jobs, scanning holders, confirming finality, paying, binding and minting then stop. Existing NFT transfers and reward claims are unaffected. Creation fee deposits continue while paused. `recoverJob()` still accepts independently approved budget refunds before retirement.

`scheduleWithdrawal(bytes32 reasonHash)` starts a fixed 48-hour delay and emits the fixed recovery recipient, deadline and reason hash. The owner can cancel; creation resumes only after cancellation. After the delay, `withdrawCreationFunds()` transfers the remaining controller IMD to the immutable original deployer address, even if ownership has changed. Withdrawal permanently retires that controller. It cannot resume or spend again. Funds already paid to IMD or the Operator are outside this withdrawal and require separate recovery.

This is an administrator-controlled emergency power. It does not cryptographically prove a failure or guarantee that the administrator will complete a migration. The public delay/events make the decision observable; they do not remove custody risk while funds are in the deployer wallet.

## Replacement preparation

1. Stop the worker and coordinate any active IMD order/payment so migration cannot duplicate payment. Preserve the database, artifacts, accepted-job evidence and encrypted outbox.
2. Deploy a replacement ReceiptVerifier if needed and a fresh CreationController using the same token, collection, IMD, original recovery recipient, Operator, payment recipient, job budget, settlement delay and base hash. The verifier may change. Review the replacement code and deployment addresses.
3. Set the new controller's `configureRouter()` to the existing official FeeRouter. Do not run the initial ten-contract deployment or liquidity-seed plan.
4. Pause the old controller. Call the new controller's `prepareMigration(oldController)`. The replacement remains inert and cannot release budgets or mint before handover.
5. Schedule the old controller's withdrawal with a published reason hash. Schedule `FeeRouter.scheduleControllerMigration(newController)`. Each schedule has a 48-hour delay; both can be cancelled before completion. Changing the proposed controller requires a new full router delay. Publish the new code/address for review.

## Execution after both delays

1. Execute the old controller withdrawal. Read its actual `recoveredAmount()` and approve that exact IMD amount from the established deployer wallet to the replacement controller.
2. Call `FeeRouter.executeControllerMigration()`. This atomically imports state, transfers the complete recovered amount from the fixed deployer address, replaces only the collection's controller, revokes the old controller allowance, activates the replacement and forwards fee escrow. Insufficient allowance/funds or incompatible state reverts the entire handover.
3. Verify the original token, pool, NFT and reward addresses; unchanged NFT owners/art; next NFT number; current selected wallet/cutoff/request/paid flag; inherited funding; previous allocations and used request IDs. Wait for Ethereum finality before restarting.
4. Set backend `CONTROLLER_ADDRESS` to the new controller and retain every predecessor in `CONTROLLER_HISTORY`. Keep scoring indexed from the original token's first mint. Update artifact/finality services to the new controller/verifier EIP-712 domain. Keep the database and old outboxes; do not reset paid attempts or selection history. Restart a single worker.

FeeRouter holds the 3% allocation in `migrationEscrow` between old-controller retirement and handover; the 1% protocol stream continues. The same pool and swap router remain usable. Escrow becomes a creation funding checkpoint when actually deposited into the replacement; it is not credited as an earlier fictitious deposit. An indefinite migration leaves this allocation escrowed.

The current paid job remains paid with the same recipient and request. Migration does not grant an extra budget. Completed old work requires a fresh signature bound to the new controller/verifier. A failed attempt still requires a full refund and independent recovery approval before retrying.

## Preserved history and limits

The replacement references retired predecessors for immutable funding checkpoints, historical jobs, original-allocation reservations and used request IDs. It copies the current job, attempt, funding index, total funding and next NFT number. Token balances and cumulative scores stay in the original token. No large holder-list import or off-chain allocation reset is used.

At most eight controller handovers are supported to bound ancestry lookups. The new controller must be the supplied compatible implementation; the delayed administrator selection is a trust boundary, not a guarantee about arbitrary replacement bytecode. All replacement code requires review.

After NFT #1000, creation recovery/migration is disabled. The irreversible 3% NFT rewards route, original distributor, seller credits and future buyer rewards remain intact. The token, pool/hook, NFT implementation and rewards implementation themselves remain immutable; a bug in one of these is outside this creation-only migration mechanism.

No live migration or deployment was performed while implementing this feature.
