import {randomUUID,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export async function reserveJob(db,{id,cutoff,recipient,attempt=0}) {
 if(!Number.isInteger(id)||id<1||id>1000)throw new Error('Invalid job id');
 await db.query('INSERT INTO artwork_jobs(token_id,request_key,cutoff,recipient,attempt) VALUES($1,$2,$3,$4,$5) ON CONFLICT(token_id) DO NOTHING',[id,randomUUID(),cutoff,recipient.toLowerCase(),attempt]);
 const row=(await db.query('SELECT * FROM artwork_jobs WHERE token_id=$1',[id])).rows[0];if(String(row.cutoff)!==String(cutoff)||row.recipient!==recipient.toLowerCase())throw new Error('Immutable job conflict');if(row.attempt!==attempt)throw new Error('RECOVERY_SYNC_REQUIRED');return row;
}
// Called only after reading the controller attempt at a finalized block. Old orders/outboxes remain archived.
export async function syncRecoveredJob(db,{id,attempt,cutoff,recipient}) {
 return db.transaction(async tx=>{
  const row=(await tx.query('SELECT * FROM artwork_jobs WHERE token_id=$1 FOR UPDATE',[id])).rows[0];if(!row||row.attempt===attempt)return;
  if(attempt!==row.attempt+1||String(row.cutoff)!==String(cutoff)||row.recipient!==recipient.toLowerCase())throw new Error('Recovery history mismatch');
  await tx.query('INSERT INTO artwork_job_attempts(token_id,attempt,record) VALUES($1,$2,$3)',[id,row.attempt,JSON.stringify(row)]);
  await tx.query("UPDATE artwork_jobs SET attempt=$2,request_key=$3,order_id=NULL,imd_job_id=NULL,status='prepared',admitted_verified=FALSE,artifact_hash=NULL,artifact_bytes=NULL,receipt=NULL,error_code=NULL,updated_at=NOW() WHERE token_id=$1",[id,attempt,randomUUID()]);
 });
}
export async function recordAdmission(db,id,order,attempt=0) {
 if(order.status!=='admitted'||order.payment?.paid!==true||order.payment?.status!=='confirmed'||order.admission?.action!=='job.open'||order.admission.result?.kind!=='job'||!order.admission.result.jobId)throw new Error('Unverified IMD admission');
 const updated=await db.query("UPDATE artwork_jobs SET imd_job_id=$2,status='admitted',admitted_verified=TRUE,updated_at=NOW() WHERE token_id=$1 AND (imd_job_id IS NULL OR imd_job_id=$2) AND order_id=$3 AND attempt=$4 RETURNING token_id",[id,order.admission.result.jobId,order.order.id,attempt]);if(!updated.rows.length)throw new Error('Order mismatch');
}
export async function persistOutbox(db,id,operation,payload,attempt=0) {
 await db.query('INSERT INTO transaction_outbox(id,token_id,operation,payload,attempt) VALUES($1,$2,$3,$4,$5) ON CONFLICT(token_id,attempt,operation) DO NOTHING',[randomUUID(),id,operation,JSON.stringify(payload),attempt]);
 const row=(await db.query('SELECT * FROM transaction_outbox WHERE token_id=$1 AND operation=$2 AND attempt=$3',[id,operation,attempt])).rows[0];return row;
}
export function encrypt(payload,key) {if(!/^[0-9a-f]{64}$/.test(key||''))throw new Error('32-byte outbox encryption key required');const nonce=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),nonce);const data=Buffer.concat([cipher.update(JSON.stringify(payload)),cipher.final()]);return{nonce:nonce.toString('hex'),data:data.toString('hex'),tag:cipher.getAuthTag().toString('hex')};}
export function decrypt(payload,key) {const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(payload.nonce,'hex'));decipher.setAuthTag(Buffer.from(payload.tag,'hex'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data,'hex')),decipher.final()]).toString());}
