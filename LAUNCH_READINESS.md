# IMPEPE launch readiness

Status: v1.2 audit remediation locally verified and accepted by the project owner without a second audit; external deployment inputs and specialist legal review remain outstanding

## Completed preparation

Contracts, compiler artifacts/ABIs, fee and reward integration, checkpoint ranking, base art commitment, locked liquidity support, backend API/schema/indexer, IMD paid-action adapter, encrypted retry outbox, safe default transaction gating, environment template, local PostgreSQL preview, Docker/proxy configuration, unsigned deployment-plan generator, gas/bytecode measurements and tests are included.

## Required before launch

- Verify the derived opening tick against final token addresses and the approved 1,000 IMD target valuation
- Provide a production Ethereum RPC endpoint and database environment
- Verify current deployed Uniswap and IMD addresses/code on the intended chain
- Provide the independent attestor public address for the approved signer model and verify the implemented accepted-job evidence adapter against a real paid artwork job
- Operate the approved independent finalized-block and refund-backed recovery signer policy described in CONTRACT_FINALIZATION.md
- Test the real IMD quote/payment/artifact flow using a bounded approved budget
- Test the canonical quote/router/frontend swap path end to end
- Run realistic holder-count/gas benchmarks and finalize frame/trait progression bounds
- Verify deployed contract source and complete specialist legal/regulatory/IP review. The project owner accepts the existing IMD audit plus locally verified remediation, without a second audit
- Confirm deployment nonces and the complete unsigned plan before the established wallet signs

No contract was deployed, no liquidity was added and no real IMD job or payment was submitted during this preparation.

The approved Phase I emergency recovery and delayed controller migration are implemented. Review EMERGENCY_MIGRATION.md and the public admin trust boundary as part of the independent audit. Existing pool, token, NFTs and holder rewards cannot be drained by this mechanism.

The backend completion pipeline, independent attestor, raw-output validation and encrypted signed-mint outbox are implemented and tested locally. See BACKEND_RUNBOOK.md. Transactions and signing remain disabled by default; live paid artwork and deployment operations have not run.
