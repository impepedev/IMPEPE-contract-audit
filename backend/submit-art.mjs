import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import {Contract,JsonRpcProvider,Wallet,AbiCoder,keccak256,toUtf8Bytes,Transaction,Interface} from 'ethers';
import {loadConfig} from './config.mjs';import {database} from './db.mjs';import {IMDClient} from './imd.mjs';
import {acceptedArtwork} from './evidence.mjs';import {encrypt,decrypt,persistOutbox} from './jobs.mjs';
const controllerAbi=['function paused() view returns(bool)','function retired() view returns(bool)','function baseHash() view returns(bytes32)','function operator() view returns(address)','function jobs(uint256) view returns(uint64 cutoff,uint64 time,uint256 cursor,uint256 count,address winner,uint256 bestScore,bytes32 requestId,bool selected,bool paid,bool finalized)','function attempts(uint256) view returns(uint256)','function nextJobId() view returns(uint256)','function verifier() view returns(address)','function submit(bytes,uint16,uint8,bytes)'];
const mintEvents=new Interface(['event ArtworkCommitted(uint256 indexed id,address indexed recipient,bytes32 artifactHash)']);
export async function prepareSubmission({db,provider,config,evidence,imd=new IMDClient({})}){
 const row=(await db.query('SELECT * FROM artwork_jobs WHERE token_id=$1',[evidence.tokenId])).rows[0];
 if(!row||!row.admitted_verified||!['completed','validated'].includes(row.status)||row.imd_job_id!==evidence.imdJobId||row.attempt!==evidence.attempt||evidence.controller?.toLowerCase()!==config.controllerAddress.toLowerCase())throw new Error('COMPLETED_CURRENT_JOB_REQUIRED');
 const controller=new Contract(config.controllerAddress,controllerAbi,provider);
 if(await controller.paused()||await controller.retired()||Number(await controller.attempts(evidence.tokenId))!==row.attempt||Number(await controller.nextJobId())!==evidence.tokenId)throw new Error('STALE_OR_INACTIVE_CREATION');
 const bound=await controller.jobs(evidence.tokenId),requestId=keccak256(toUtf8Bytes(row.imd_job_id));
 if(!bound.selected||!bound.paid||bound.requestId!==requestId||bound.winner.toLowerCase()!==row.recipient)throw new Error('BOUND_JOB_MISMATCH');
 const result=await acceptedArtwork({imd,imdJobId:row.imd_job_id,tokenId:evidence.tokenId,baseHash:(await controller.baseHash()).slice(2),payer:await controller.operator()});
 if(result.artifactHash!==evidence.artifactHash||result.commitmentHash!==evidence.commitmentHash||result.manifest.effect!==evidence.effect||result.manifest.durationMs!==evidence.durationMs)throw new Error('SIGNED_ART_MISMATCH');
 const verifier=new Contract(await controller.verifier(),['function verify(uint256,bytes32,bytes32,bytes) view returns(bool)'],provider);
 if(verifier.target.toLowerCase()!==evidence.verifier?.toLowerCase())throw new Error('VERIFIER_MISMATCH');
 const proof=AbiCoder.defaultAbiCoder().encode(['uint256','bytes'],[evidence.expiresAt,evidence.attestorSignature]);
 if(!await verifier.verify(evidence.tokenId,requestId,result.commitmentHash,proof,{from:config.controllerAddress}))throw new Error('ONCHAIN_ATTESTATION_REJECTED');
 return {to:config.controllerAddress,data:controller.interface.encodeFunctionData('submit',[result.bytes,evidence.durationMs,evidence.effect,proof]),tokenId:evidence.tokenId,artifactHash:result.artifactHash,bytes:result.bytes,evidence,row};
}
export async function reconcileMints({db,provider,config,wallet,encryptionKey,assertLock=()=>{}}){
 assertLock();
 if((await db.query("SELECT id FROM transaction_outbox WHERE operation LIKE 'mint:%' AND state='failed' LIMIT 1")).rows.length)throw new Error('FAILED_MINT_REQUIRES_RECONCILIATION');
 const rows=(await db.query("SELECT * FROM transaction_outbox WHERE operation LIKE 'mint:%' AND state IN ('prepared','broadcast') ORDER BY token_id")).rows;
 for(const box of rows){
  const saved=decrypt(box.payload,encryptionKey),tx=Transaction.from(saved.rawTransaction);
  if(tx.hash!==saved.txHash||tx.from.toLowerCase()!==wallet.address.toLowerCase()||Number(tx.chainId)!==config.chainId||saved.collection.toLowerCase()!==config.collectionAddress.toLowerCase()||box.operation!==`mint:${tx.to.toLowerCase()}`)throw new Error('INVALID_MINT_OUTBOX');
  const receipt=await provider.getTransactionReceipt(tx.hash);
  if(!receipt){
   if(saved.controller.toLowerCase()!==config.controllerAddress.toLowerCase())throw new Error('OLD_CONTROLLER_TRANSACTION_REQUIRES_RECONCILIATION');
   const controller=new Contract(saved.controller,controllerAbi,provider);if(await controller.paused()||await controller.retired()||Number(await controller.attempts(saved.tokenId))!==saved.attempt)throw new Error('MINT_ATTEMPT_CHANGED');
   const latest=await provider.getBlock('latest');if(latest.timestamp>=saved.expiresAt)throw new Error('MINT_TRANSACTION_EXPIRED_RECONCILE_NONCE');
   assertLock();try{const response=await provider.broadcastTransaction(saved.rawTransaction);if(response.hash!==tx.hash)throw new Error('TRANSACTION_HASH_MISMATCH');}catch(error){if(!await provider.getTransaction(tx.hash))throw error;}
   await db.query("UPDATE transaction_outbox SET state='broadcast',tx_hash=$2 WHERE id=$1",[box.id,tx.hash]);return {status:'awaiting_mint_confirmation',tokenId:saved.tokenId,txHash:tx.hash};
  }
  if(receipt.status!==1){await db.query("UPDATE transaction_outbox SET state='failed',tx_hash=$2 WHERE id=$1",[box.id,tx.hash]);throw new Error('MINT_TRANSACTION_REVERTED');}
  const final=await provider.send('eth_getBlockByNumber',['finalized',false]);if(!final||BigInt(final.number)<BigInt(receipt.blockNumber))return {status:'awaiting_mint_finality',tokenId:saved.tokenId,txHash:tx.hash};
  const block=await provider.getBlock(receipt.blockNumber);if(block.hash!==receipt.blockHash)throw new Error('MINT_HISTORY_MISMATCH');
  const matched=receipt.logs.some(log=>{if(log.address.toLowerCase()!==saved.collection.toLowerCase())return false;try{const event=mintEvents.parseLog(log);return event.name==='ArtworkCommitted'&&Number(event.args.id)===saved.tokenId&&event.args.recipient.toLowerCase()===saved.recipient&&event.args.artifactHash===`0x${saved.artifactHash}`;}catch{return false;}});
  if(!matched)throw new Error('EXPECTED_MINT_EVENT_MISSING');
  await db.transaction(async q=>{const updated=await q.query("UPDATE artwork_jobs SET status='minted',updated_at=NOW(),error_code=NULL WHERE token_id=$1 AND attempt=$2 AND request_key=$3 RETURNING token_id",[saved.tokenId,saved.attempt,saved.requestKey]);if(!updated.rows.length)throw new Error('STALE_MINT_DATABASE_RECORD');await q.query("UPDATE transaction_outbox SET state='confirmed',tx_hash=$2 WHERE id=$1",[box.id,tx.hash]);});
 }
 return null;
}
export async function completeArtwork({db,provider,config,wallet,imd,policy,assertLock=()=>{}}){
 if(!config.liveTransactions)return {status:'transactions_disabled'};
 assertLock();const pending=await reconcileMints({db,provider,config,wallet,encryptionKey:policy.encryptionKey,assertLock});if(pending)return pending;
 const row=(await db.query("SELECT * FROM artwork_jobs WHERE status IN ('completed','validated') AND admitted_verified ORDER BY token_id LIMIT 1")).rows[0];if(!row)return {status:'awaiting_completed_artwork'};
 if(!policy.artifactUrl||!policy.attestorToken)return {status:'attestor_configuration_required'};
 const response=await fetch(policy.artifactUrl,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${policy.attestorToken}`},body:JSON.stringify({tokenId:row.token_id,attempt:row.attempt,imdJobId:row.imd_job_id}),signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('ART_ATTESTATION_UNAVAILABLE');
 const raw=await response.text();if(raw.length>65536)throw new Error('ATTESTATION_RESPONSE_TOO_LARGE');const evidence=JSON.parse(raw);
 const prepared=await prepareSubmission({db,provider,config,evidence,imd});
 if((await wallet.getAddress()).toLowerCase()!==(await new Contract(config.controllerAddress,controllerAbi,provider).operator()).toLowerCase())throw new Error('WRONG_OPERATOR');
 await db.query("UPDATE artwork_jobs SET status='validated',artifact_bytes=$2,artifact_hash=$3,receipt=$4,updated_at=NOW() WHERE token_id=$1 AND attempt=$5",[row.token_id,prepared.bytes,prepared.artifactHash,JSON.stringify(evidence),row.attempt]);
 const operation=`mint:${config.controllerAddress.toLowerCase()}`;let box=(await db.query('SELECT * FROM transaction_outbox WHERE token_id=$1 AND attempt=$2 AND operation=$3',[row.token_id,row.attempt,operation])).rows[0];
 if(!box){const estimate=await provider.estimateGas({from:wallet.address,to:prepared.to,data:prepared.data});const gasLimit=estimate*12n/10n+50000n;if(gasLimit>8000000n)throw new Error('MINT_GAS_BOUND_EXCEEDED');const populated=await wallet.populateTransaction({to:prepared.to,data:prepared.data,gasLimit});assertLock();const rawTransaction=await wallet.signTransaction(populated);const txHash=Transaction.from(rawTransaction).hash;
  const saved={rawTransaction,txHash,controller:config.controllerAddress,collection:config.collectionAddress,tokenId:row.token_id,attempt:row.attempt,requestKey:row.request_key,recipient:row.recipient,artifactHash:prepared.artifactHash,expiresAt:evidence.expiresAt};
  box=await persistOutbox(db,row.token_id,operation,encrypt(saved,policy.encryptionKey),row.attempt);
 }
 return await reconcileMints({db,provider,config,wallet,encryptionKey:policy.encryptionKey,assertLock})||{status:'minted',tokenId:row.token_id};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){const config=loadConfig(),db=database(config.databaseUrl),provider=new JsonRpcProvider(config.rpcUrl);try{const evidence=JSON.parse(await fs.readFile(process.argv[2],'utf8'));const prepared=await prepareSubmission({db,provider,config,evidence});console.log(JSON.stringify({status:'unsigned_review_only',to:prepared.to,data:prepared.data,tokenId:prepared.tokenId,artifactHash:prepared.artifactHash}));}finally{await db.close();provider.destroy();}}
