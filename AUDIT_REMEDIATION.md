# IMPEPE audit remediation and owner acceptance

Original IMD audit: [08bcbaac-7072-4084-a22f-9d810be7b388](https://explorer.imd.fun/jobs/08bcbaac-7072-4084-a22f-9d810be7b388), completed 8 October 2026 against commit `cafc305e764f0300c8ddf9d70feea2113a58b913`

The project owner explicitly instructed: “ok fix it and mark it as audit approved, we don't need another audit”. The owner separately chose a minimum balance of 10,000 IMPEPE for holder selection. Release v1.2 records audit approval on that basis after local remediation tests. IMD has not reviewed or approved the revised source. No second audit is requested, paid for or implied. Legal review remains a separate, incomplete deployment input

| Finding | Disposition in v1.2 |
| --- | --- |
| 1 Medium — external protocol fee halts swaps | Removed the hook's zero protocol-fee restriction; regression tests exercise buys, sells and canonical quotes with nonzero Uniswap protocol fees in both currency orders. The project fee remains 4%, split 3%/1%; Uniswap governance fees are additional external costs |
| 2 Medium — holder spam | Owner-approved 10,000-token minimum for registry admission and cutoff eligibility. Earlier scores still accumulate. Dust transfers do not enter the scan registry. This is mitigation, not a bound on total selection work; qualifying balances can be recycled through addresses and historic entries remain. Keeper cost and liveness remain accepted design risks |
| 3 Medium — bad liquidity setup locks allocation | Validate hook manager, tokens, spacing and liquidity owner; calculate liquidity, per-tick cap and rounding precision before accepting configuration. Configuration can be corrected until seeding; successfully seeded liquidity stays permanently locked |
| 4 Low — allocation to wrong predicted address | Token construction requires a deployed allocation contract whose token getter identifies the token being constructed; nonce/address errors revert before minting the public allocation. Deployment preparation still checks the approved vault and fresh nonce |
| 5 Low — repeated exhausted snapshots | Next job search starts from the previous job's latest funding index; inherited indices resolve through controller predecessors |
| 6 Low — wrong hook seals fee routing | Router configuration requires the hook's reciprocal router link |
| 7 Low — quadratic renderer | Preallocated SVG buffer, forward writes and Cancun memory copy replace repeated concatenation. Maximum-frame tokenURI has a measured gas budget in regression tests |
| 8 Low — duplicated first frame | Discrete SMIL values contain exactly the committed frame count; looping provides the restart |
| 9 Low — unsafe ownership handover | All owned production contracts use two-step ownership acceptance and prohibit renunciation |
| 10 Low — arbitrary Operator creative brief | Worker and attestor reconstruct the same canonical brief from the fixed base and the last 12 on-chain artwork commitments. Evidence requires the complete matching objective and independently configured approved skill. Missing skill evidence fails closed. Actual IMD adapter conformance remains to be verified with a paid artwork job |
| 11 Info — provider cache | All local contract fixtures disable request caching |
| 12 Info — address-based exclusions | Retained approved per-address rules and transferable deployer allocation. A different address can become eligible; there is no proof of distinct people |
| 13 Info — historical-score re-entry | Lifetime scores and end-of-block snapshot semantics retained. Re-entry now requires 10,000 tokens rather than one wei |
| 14 Info — external IMD assumptions | Read-only foundation observation verifies Ethereum, external code and live IMD decimals; unsigned foundation preparation refuses missing or stale verification. Standard, non-rebasing IMD behavior remains an external dependency |
| 15 Info — tiny fee rounding | Retained integer fee rounding; allocation plus protocol always equals collected project fee. Deviations at tiny amounts are at most one smallest unit per trade |
| 16 Info — unused reward remainder | Removed mathematically unused remainder state; SCALE is divisible by the fixed 1,000 shares |
| 17 Info — unused gross routing entry | Removed production route(gross); test fee source uses the live routeAmounts interface |
| 18 Info — release before payment validation | Validate the challenge and generated payment authorization before budget release or allowance transactions; existing retries also revalidate current challenge terms |

Approval is scoped to the compiled source manifest in `artifacts/audit-approval.json`, not to arbitrary future edits. Regression evidence and source hashes accompany the release. Original audit report and original Git commit remain preserved. No live contract transaction is part of this remediation
