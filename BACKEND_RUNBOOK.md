# IMPEPE backend v0.1

The independent attestor must configure its own `IMD_ART_SKILL`, matching the approved worker skill. Both services reconstruct the full creative brief using the fixed genesis base and the last 12 on-chain artwork commitments. Accepted-job evidence must expose that skill and the exact objective; missing evidence stops signing. Verify these fields against a real paid artwork job before enabling live artwork submission

## What runs

One application stack contains the public API/indexer, creation worker, independent attestor service and PostgreSQL. The project requests work from IMD's existing swarm; it does not need to operate an IMD contributor node or run an AI model itself.

The creation worker watches funding, waits for finalized selection, obtains a quote, pays the bounded IMD budget, binds the admitted job and polls its actual `state`. On completion it requests an artifact attestation, retrieves the accepted files, verifies the signature on-chain, signs one mint transaction, saves the signed transaction encrypted before broadcast and reconciles the finalized receipt. Normal accepted work now proceeds to mint without a hand-created evidence file.

## Independent evidence service

The attestor independently reads the configured controller/collection/verifier, current NFT number, attempt, paid request and Operator. It checks its signing address against ReceiptVerifier and rejects overlap with the Operator or established deployer. It independently retrieves the IMD job, accepted result and submissions and checks the payer, objective NFT number, accepted submission, exact declared output paths/types, hashes, byte sizes and metadata. Both output files must belong to the same accepted submission.

The service signs only the validated RGB commitment and animation fields using the contract's EIP-712 domain. It accepts a job identifier and attempt, not an Operator-supplied artifact to approve. `/finality` signs only the current cutoff once the configured Ethereum RPC reports it finalized. `/artifact` and `/finality` require a shared service token; `/health` exposes only configuration status.

This implements the approved independent signer bridge. It trusts official IMD HTTPS responses and the signer's Ethereum RPC. The public result/submission routes identify accepted files and device keys; they do not expose a full signed artifact upload receipt in the inspected responses. This flow therefore does not claim native cryptographic IMD provenance or an Ed25519 receipt verification. The native receipt helper remains available for a future authenticated receipt adapter.

Sources checked on 2026-10-07: [IMD documentation](https://imd.fun/docs/), [public paid API schema](https://api.imd.fun/openapi.json) and read-only public job/result/submission responses. Snapshot examples in artifacts are API references, not IMPEPE jobs. No paid IMD job was created during backend development.

## Required swarm outputs

The configured art skill must produce exactly these named files:

- `art` at `artifacts/impepe.rgb`, `application/octet-stream`: 300 RGB bytes per complete 10x10 frame, at most eight frames
- `manifest` at `artifacts/manifest.json`, `application/json`, at most 16 KiB

The manifest has `v: 1`, numeric `tokenId`, lowercase 64-hex `artifactHash`, integer `durationMs`, integer `effect` and boolean `holyGrail`. Static artwork uses one frame, duration/effect zero. Animation uses 2-8 frames, 2000-20000 ms and effect 1-13. `holyGrail` must be true only for NFT #1000. NFT #1 must match the exact configured base bytes. Artistic quality and progression still depend on the agent/reviewer; metadata is not a proof of visual rarity.

Creative requests include recent minted manifests/hashes, the base grid, NFT number, progression objective and output schema. Agent bytes are submitted unchanged. The collection's existing SVG renderer produces the display image.

## Configuration and key separation

Copy `.env.api.example` to `.env.api`, `.env.worker.example` to `.env.worker` and `.env.attestor.example` to `.env.attestor`. Fill deployed addresses, a production PostgreSQL URL and Ethereum RPC. No secret is present in the templates.

- API/indexer environment: public contract addresses, RPC and database access; no wallet signing key
- Worker environment: Operator key, request token, payment policy, encryption key and attestor service token; no attestor key
- Attestor environment: independent attestor key, allowed addresses, RPC and service token; no Operator key or payment token

Generate unique service/encryption secrets locally; the service token must be at least 32 characters and the outbox key exactly 32 bytes in lowercase hex. Keep the outbox key and database backed up together. Do not upload secrets or share logs containing signed payment payloads. Separate environment files are useful for development; production independence requires a separate attestor host or equivalent custody/security boundary. A host compromise can access keys held on that host.

`LIVE_TRANSACTIONS=false` and `ATTESTOR_SIGNING_ENABLED=false` are the defaults. Supply and verify the deployed independent attestor address and live integration policy before enabling them. The Operator needs ETH for contract calls. Real paid IMD requests are restricted to Ethereum mainnet by the worker.

## Commands

From the protocol directory, install locked dependencies using `npm ci`. Set DATABASE_URL for `npm run migrate`, then run:

```text
npm run api
npm run index
npm run attestor
npm run worker
```

Each service reads its own environment file. Alternatively, the Compose stack uses the same separate files. The default stack runs PostgreSQL, migration, API, indexer and the website proxy. `docker compose --env-file .env up --build` requires POSTGRES_PASSWORD in `.env`; enable the optional automation profile with `docker compose --env-file .env --profile automation up --build` only after configuring the worker and attestor. The profile also provides the private internal attestor endpoint. Replace the co-hosted attestor with the independent service in production. Docker is unavailable on the development host, so the Compose deployment has not been executed here.

Health/status routes: public API `/health`, `/api/runtime`, `/api/swarm`; independent service `http://127.0.0.1:4192/health`. Missing data remains Unavailable; no invented market, mint or swarm records are inserted.

## Restart and failure handling

Production workers acquire a PostgreSQL session advisory lock for the Operator/chain. Another worker returns busy instead of signing concurrently. A lost database lock blocks subsequent wallet signing and broadcasts. Keep the Operator dedicated to this system; do not use its account concurrently outside the worker.

Signed mint transactions are encrypted in the outbox before broadcast. Restarts first look for receipts and rebroadcast the exact same valid transaction if necessary. The backend marks an NFT minted only after a successful canonical finalized receipt contains its expected collection, recipient, NFT number and artifact hash. It never infers a successful mint solely from a job being completed.

Expired, reverted or replaced transactions halt for nonce/receipt reconciliation rather than silently signing a different transaction. A failed mint outbox must be reconciled before continuing; do not delete it or reset a paid job just to clear an error. Failed IMD work uses the approved refund-backed recovery procedure. Lost receipts do not justify paying a new job. Emergency controller migration follows EMERGENCY_MIGRATION.md; preserve the database and all old controller addresses in CONTROLLER_HISTORY, and update both service configurations/domains after finalized handover.

## Verification boundary

Automated tests exercise real local Ethereum contracts, a local independently signed HTTP attestation, accepted-output fixtures, PostgreSQL-compatible storage, mint broadcast and restart reconciliation. Read-only live IMD shapes were inspected. The Docker image was built and deployed successfully on Railway, and live PostgreSQL connectivity, migration and disabled background states were verified. The local Compose stack was not executed. A real paid artwork job, production PostgreSQL advisory-lock behavior, production custody and mainnet integration remain unverified. The backend foundation is hosted, with live creation disabled. See RAILWAY_DEPLOYMENT.md for service URLs and configuration.
