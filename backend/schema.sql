CREATE TABLE IF NOT EXISTS chain_state (
 chain_id BIGINT PRIMARY KEY, next_block BIGINT NOT NULL, last_hash TEXT, observed_at TIMESTAMPTZ
);
ALTER TABLE chain_state ADD COLUMN IF NOT EXISTS token_address TEXT;
ALTER TABLE chain_state ADD COLUMN IF NOT EXISTS scoring_start_block BIGINT;
CREATE TABLE IF NOT EXISTS chain_blocks (
 chain_id BIGINT NOT NULL, number BIGINT NOT NULL, hash TEXT NOT NULL, parent_hash TEXT NOT NULL, timestamp BIGINT NOT NULL,
 PRIMARY KEY(chain_id,number), UNIQUE(chain_id,hash)
);
CREATE TABLE IF NOT EXISTS chain_events (
 chain_id BIGINT NOT NULL, block_number BIGINT NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
 kind TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY(chain_id,tx_hash,log_index),
 FOREIGN KEY(chain_id,block_number) REFERENCES chain_blocks(chain_id,number)
);
CREATE TABLE IF NOT EXISTS holders (
 chain_id BIGINT NOT NULL,address TEXT NOT NULL,balance NUMERIC(100,0) NOT NULL DEFAULT 0,
 score NUMERIC(100,0) NOT NULL DEFAULT 0,last_timestamp BIGINT NOT NULL,first_block BIGINT NOT NULL,
 PRIMARY KEY(chain_id,address),CHECK(balance>=0),CHECK(score>=0)
);
CREATE TABLE IF NOT EXISTS allocations (
 chain_id BIGINT NOT NULL,token_id INTEGER NOT NULL,recipient TEXT NOT NULL,cutoff BIGINT NOT NULL,
 PRIMARY KEY(chain_id,token_id),UNIQUE(chain_id,recipient)
);
CREATE TABLE IF NOT EXISTS artwork_jobs (
 token_id INTEGER PRIMARY KEY CHECK(token_id BETWEEN 1 AND 1000),request_key UUID NOT NULL UNIQUE,
 cutoff BIGINT NOT NULL,recipient TEXT NOT NULL,order_id TEXT UNIQUE,imd_job_id TEXT UNIQUE,
 status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','quoted','admitted','running','completed','validated','minted','failed')),
 admitted_verified BOOLEAN NOT NULL DEFAULT FALSE,artifact_hash TEXT,artifact_bytes BYTEA,
 receipt JSONB,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),error_code TEXT,
 CHECK(NOT admitted_verified OR imd_job_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS transaction_outbox (
 id UUID PRIMARY KEY,token_id INTEGER NOT NULL REFERENCES artwork_jobs(token_id),operation TEXT NOT NULL,
 payload JSONB NOT NULL,state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','broadcast','confirmed','failed')),
 tx_hash TEXT UNIQUE,UNIQUE(token_id,operation)
);
CREATE TABLE IF NOT EXISTS service_leases (
 name TEXT PRIMARY KEY,owner UUID NOT NULL,expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE artwork_jobs ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transaction_outbox ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transaction_outbox DROP CONSTRAINT IF EXISTS transaction_outbox_token_id_operation_key;
CREATE UNIQUE INDEX IF NOT EXISTS outbox_attempt_operation ON transaction_outbox(token_id,attempt,operation);
CREATE TABLE IF NOT EXISTS artwork_job_attempts (
 token_id INTEGER NOT NULL,attempt INTEGER NOT NULL,record JSONB NOT NULL,
 PRIMARY KEY(token_id,attempt)
);
CREATE OR REPLACE VIEW swarm_job_history AS
 SELECT token_id,attempt,imd_job_id,status,admitted_verified,updated_at FROM artwork_jobs
 UNION ALL
 SELECT token_id,attempt,record->>'imd_job_id',record->>'status',
 (record->>'admitted_verified')::boolean,(record->>'updated_at')::timestamptz FROM artwork_job_attempts;
CREATE TABLE IF NOT EXISTS service_state (
 name TEXT PRIMARY KEY,status TEXT NOT NULL,observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),error_code TEXT
);

ALTER TABLE chain_state ADD COLUMN IF NOT EXISTS fee_hook_address TEXT;
ALTER TABLE chain_state ADD COLUMN IF NOT EXISTS fee_index_start BIGINT;
