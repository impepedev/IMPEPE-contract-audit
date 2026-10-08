# IMPEPE contracts and backend

Local launch preparation implementation. It is not audited, deployed or mainnet ready. Read LAUNCH_READINESS.md before generating transactions. The original DOCX and prior visual assets are preserved.

## Accepted parameters

Ethereum; fixed 1 billion IMPEPE with 18 decimals; 980 million reserved for the official IMPEPE/IMD liquidity position, and 20 million minted to the established deployer. The 1% protocol fee goes to that deployer. The provided separate address is the Swarm Operator. Wallet assignments are recorded in deployment.json; no private keys are included.

Holding-time scoring begins at the token's first mint. A wallet must have a positive balance at the funding-block cutoff. Ties go to the numerically lower address. Original allocation is limited to one per wallet; secondary ownership is unrestricted. Exclusions are set once and irreversibly sealed before fees fund artwork. Include the administrator, Operator, protocol recipient, PoolManager and every protocol contract. This implementation scans the actual holder registry in bounded batches; the Operator cannot submit a recipient.

## Contracts

| Module | Responsibility |
| --- | --- |
| ProjectToken | Fixed 98/2 genesis allocation, balance/score checkpoints, frozen exclusions |
| IMPEPEHook | Official v4 pool, permission-address validation, exact-input buys/sells, 4% IMD fee |
| FeeRouter | 3% creation or rewards plus 1% protocol; rounding dust goes to protocol |
| CreationController | Funding cutoff, paginated selection, one funded job at a time, bounded payment and proof-gated mint |
| SwarmCollection | Direct deployment from established wallet, 1000 cap, exact artifact storage, atomic commit/mint |
| SVGRenderer | Embedded library; fixed 100 square cells, optional frame color animation |
| RewardsDistributor | Equal per-NFT accumulation, pull claims, seller credit settlement on transfers |
| LiquidityBootstrap | Seeds the 98% allocation as single-sided liquidity, atomically initializes the pool, has no withdrawal path |
| IMPEPESwapRouter | IMD/IMPEPE exact-input swaps with minimum output and deadline; flushes fees after settlement |
| ReceiptVerifier | Approved independent EIP-712 artwork, finality and recovery bridge, explicitly distinct from native IMD receipts |
| HookFactory | Administrator-controlled CREATE2 deployment at the required hook permission address |

The original five-module target grows to ten deployed contracts plus an embedded renderer. Rewards, fee isolation, the permanently locked liquidity position, swap router, evidence bridge and hook-address deployment account for the additional support contracts. This is a reviewable implementation choice.

Fees are collected in IMD: 4% of gross IMD input for buys, 4% of gross IMD output for sells. There is no additional LP fee. Exact-output swaps and partial fills deliberately revert. The hook halts if a separate PoolManager protocol fee is enabled. Other pools are outside this fee mechanism. #1000 permanently switches future routing to NFT rewards, and remaining creation funds move to that same distributor. During Phase I, a paused controller supports a publicly scheduled 48-hour recovery to the immutable established deployer address and delayed controller replacement. Holder rewards cannot be withdrawn by the admin. All 1000 NFTs get equal financial weight.

Funding records cumulative IMD receipts. Each sequential job's cutoff is the earliest receipt meeting its cumulative budget; waiting to call openNextJob cannot move the cutoff. Same-block token transfers resolve to the final balance checkpoint for that block. Scores accrue in raw token-seconds, preserving token-hour rank. The backend waits for Ethereum's finalized block; the contract independently requires a configured block delay and a signed cutoff-block finality attestation. Set FINALITY_ATTESTATION_URL only after reviewing the independent signer's policy. This trusted bridge is not a beacon consensus proof.

The Operator can release exactly one fixed job budget to the configured payment wallet, which is the Operator in the proposed deployment. It cannot release a second job's budget until the current NFT mints. IMD's current paid-request flow supports EOA/EIP-7702 wallets rather than Safe payments, so the bounded hot-wallet payment path is explicit. A compromised Operator can lose the currently released budget and stall work. It cannot choose recipients, change exclusions, redraw authenticated bytes, withdraw all creation funds or mint without the independent artifact attestation.

## Running locally

Use Node 22 or newer in this directory.

```text
npm ci
npm run compile
npm test
npm run preview
```

preview starts an embedded PostgreSQL engine on 127.0.0.1:4190 for local API checks. It inserts no market, mint or swarm fixtures. The existing website at 127.0.0.1:4180 is configured to poll it. health is available while unconfigured feeds return 503/available:false. PGlite is a developer/test dependency; production uses PostgreSQL through pg.

For PostgreSQL, copy .env.example to .env, fill public contract/RPC values and a database URL, then run node --env-file=.env backend/migrate.mjs and node --env-file=.env backend/server.mjs. Run the indexer separately with node --env-file=.env backend/indexer.mjs. It derives the scoring start from the token when no explicit start block is provided. Only finalized blocks are ingested. Parent/hash mismatches halt ingestion rather than silently rewriting historical scores.

Docker configuration includes PostgreSQL, migration, API and the website proxy on 127.0.0.1:4181. Copy the separate API, worker and attestor templates as described in BACKEND_RUNBOOK.md. Add POSTGRES_PASSWORD to .env and run docker compose --env-file .env up --build. Docker is not installed on this host, so this deployment configuration has not been executed here. Review image versions and deploy HTTPS separately for public hosting.

## APIs and jobs

GET /api/market, /api/collection, /api/swarm and /api/quote match the website's feed contracts. /api/art/:id.svg serves decoded on-chain images under a restrictive CSP. /api/leaderboard exposes the top 100 eligible indexed holders, refreshed in 100-block buckets. Quotes are indicative, not signed transaction authorizations. The frontend's actual swap execution remains a separate integration.

Market price, circulating market cap and all-time eligible USD volume require a validated market-data adapter at MARKET_DATA_URL. They are not fabricated from fee totals. The current unspent creation IMD balance comes from the controller at an observed finalized block. Source timestamps are preserved. Missing integrations return unavailable.

The worker contains request-key reservations, quote-bound x402/Permit2 payment preparation, encrypted durable payment retries, confirmed admission counting, finalized-cutoff selection and IMD job polling. LIVE_TRANSACTIONS is false by default. Operator gas/IMD allowance, the confirmed API payment recipient/spender and a supported art skill must be configured before it can run. The current fixed budget is 0.5 IMD and must be checked against capabilities before deployment; price changes halt the flow. The source does not transmit any payment during installation or tests.

Completed artwork now proceeds through the independent attestor and accepted-output adapter to a durable mint transaction. The signer independently reads official IMD accepted results/submissions, authenticates the payer/job and validates exact raw bytes and metadata. The Operator verifies the on-chain signature and persists the encrypted signed transaction before broadcast. Canonical finalized receipts determine mint completion. This approved bridge trusts official IMD HTTPS evidence; it does not claim a native signed device receipt. See BACKEND_RUNBOOK.md for configuration, key separation and the live verification boundary.

## Deployment

deployment.json contains public decisions and incomplete launch inputs. npm run plan fails closed and writes artifacts/deployment-readiness.json until those inputs and review gates are satisfied. A complete config generates ordered unsigned deployment/setup transactions and predicted addresses. It never signs or broadcasts. SwarmCollection is deployed directly by the established wallet; this does not transfer OpenSea verification.

The approved liquidity model is single-sided and permanently locked. No initial IMD deposit or unlock date is required. The target opening fully diluted valuation is 1,000 IMD (approximately 998.203 IMD after tick rounding). The planner derives openingTick from this target and the final predicted token addresses, preventing reciprocal-price errors. The vault computes liquidity from the 980 million tokens and initializes/seeds atomically. At most 1e12 raw token units (0.000001 IMPEPE) of rounding dust remain locked in the vault. It has no withdrawal, sweep, negative liquidity modification or upgrade function; the hook also rejects liquidity removals and outside additions. This locks the position, not the token price or the deployer's separate 2% allocation. Read LAUNCH_MODEL.md for reserve and exit limits.

The swap router settles fees in the same transaction after the PoolManager unlock completes. Other v4 routers may leave fees in the hook's ERC-6909 claims; anyone can call flushFees, and the worker does so before opening work. The cutoff is the block where creation funding is deposited, which can differ from the trade block for external routers. Review transaction nonces against the live account before signing. Use Sepolia with a test IMD deployment first; do not reuse Ethereum's IMD or PoolManager addresses on another chain.

Official references: https://imd.fun/docs/ and https://developers.uniswap.org/docs/protocols/v4/deployments

## Contract v1.1 source freeze

The four final policies are approved and implemented: independent signer evidence, refund-backed retries, direct delivery without ERC-721 receiver callbacks, and earliest-later funding snapshot advancement after a complete empty scan. See CONTRACT_FINALIZATION.md for the release inventory, operational procedure and remaining deployment inputs. Source, ABI and bytecode fingerprints are in artifacts/contract-manifest.json; full compiler input is in artifacts/compiler-input.json. The v1.1 release adds delayed creation-only migration; see EMERGENCY_MIGRATION.md. This source freeze is not an independent audit or a mainnet deployment.

Run `node scripts/verify-release.mjs` to independently reproduce all ten bytecodes from the bundled standard compiler input and check the recorded fingerprints. Run `node scripts/contract-manifest.mjs` only when intentionally creating a new release manifest.
