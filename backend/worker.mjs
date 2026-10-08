import {pathToFileURL} from 'node:url';
import {Contract,JsonRpcProvider,Wallet,keccak256,toUtf8Bytes,AbiCoder} from 'ethers';import {createPublicClient,http} from 'viem';import {mainnet} from 'viem/chains';import {privateKeyToAccount} from 'viem/accounts';import {toClientEvmSigner} from '@x402/evm';
import {completeArtwork,reconcileMints} from './submit-art.mjs';
import {loadConfig} from './config.mjs';import {database} from './db.mjs';import {IMDClient} from './imd.mjs';import {creativeBrief,sha} from './art.mjs';import {canonical,preparePayment,submitPrepared} from './payment.mjs';import {reserveJob,recordAdmission,persistOutbox,syncRecoveredJob,encrypt,decrypt} from './jobs.mjs';
const controllerAbi=['function paused() view returns(bool)','function retired() view returns(bool)','function nextJobId() view returns(uint256)','function totalFunded() view returns(uint256)','function jobBudget() view returns(uint256)','function settlementBlocks() view returns(uint256)','function operator() view returns(address)','function paymentRecipient() view returns(address)','function jobs(uint256) view returns(uint64 cutoff,uint64 time,uint256 cursor,uint256 count,address winner,uint256 bestScore,bytes32 requestId,bool selected,bool paid,bool finalized)','function attempts(uint256) view returns(uint256)','function advanceEmptySnapshot()','function openNextJob()','function confirmFinality(bytes)','function scan(uint256)','function payJob()','function bindRequest(bytes32)'];
async function cycleUnlocked({config,db,provider,wallet,paymentSigner,imd,policy,assertLock=()=>{}}) {
 assertLock();
 if(!config.liveTransactions)return {status:'transactions_disabled'};
 if(config.chainId!==1||Number((await provider.getNetwork()).chainId)!==1)throw new Error('Mainnet IMD payment chain required');
 if(!policy.artSkill||!policy.payTo||!policy.spender||!policy.permit2||!policy.encryptionKey)throw new Error('Worker payment policy incomplete');
 const controller=new Contract(config.controllerAddress,controllerAbi,wallet);
 if((await controller.operator()).toLowerCase()!==wallet.address.toLowerCase()||(await controller.paymentRecipient()).toLowerCase()!==wallet.address.toLowerCase())throw new Error('Operator payment wallet mismatch');
 if(await controller.retired())return {status:'controller_retired_migration_required'};if(await controller.paused())return {status:'creation_paused'};
 if(!config.hookAddress)throw new Error('Fee hook required');const fees=new Contract(config.hookAddress,['function pendingCreation() view returns(uint256)','function pendingProtocol() view returns(uint256)','function flushFees()'],wallet);
 if(await fees.pendingCreation()+await fees.pendingProtocol()>0n)await(await fees.flushFees()).wait();
 const minting=await reconcileMints({db,provider,config,wallet,encryptionKey:policy.encryptionKey,assertLock});if(minting)return minting;
 const id=Number(await controller.nextJobId());if(id>1000)return {status:'collection_complete'};
 let job=await controller.jobs(id);const budget=await controller.jobBudget();
 if(!job.cutoff){if(await controller.totalFunded()<BigInt(id)*budget)return {status:'awaiting_funding'};await(await controller.openNextJob()).wait();job=await controller.jobs(id);}
 const finalized=await provider.send('eth_getBlockByNumber',['finalized',false]);if(!finalized||BigInt(finalized.number)<job.cutoff)return {status:'awaiting_finality'};
 const latest=await provider.getBlockNumber();if(BigInt(latest)<=job.cutoff+await controller.settlementBlocks())return {status:'awaiting_settlement'};
 if(!job.finalized){if(!policy.finalityUrl)return{status:'finality_attestation_required'};const response=await fetch(`${policy.finalityUrl}?cutoff=${job.cutoff}`,{redirect:'error',headers:{Authorization:`Bearer ${policy.attestorToken||''}`},signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('Finality attestation unavailable');const evidence=await response.json();const block=await provider.getBlock(Number(job.cutoff));if(String(evidence.cutoff)!==String(job.cutoff)||evidence.blockHash!==block.hash)throw new Error('Finality attestation mismatch');await(await controller.confirmFinality(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','bytes'],[evidence.blockHash,evidence.expiresAt,evidence.signature]))).wait();}
 if(!job.selected){await(await controller.scan(125)).wait();job=await controller.jobs(id);if(!job.selected){if(job.cursor===job.count&&job.winner==='0x'+'0'.repeat(40)){try{await controller.advanceEmptySnapshot.staticCall();}catch{return{status:'awaiting_next_funding_snapshot'};}await(await controller.advanceEmptySnapshot()).wait();return{status:'snapshot_advanced'};}return {status:'selecting'};}}
 const attempt=Number(await controller.attempts(id));const confirmedAttempt=Number(await controller.attempts(id,{blockTag:Number(BigInt(finalized.number))}));if(attempt!==confirmedAttempt)return{status:'awaiting_recovery_finality'};const confirmedJob=await controller.jobs(id,{blockTag:Number(BigInt(finalized.number))});if(!confirmedJob.selected||confirmedJob.cutoff!==job.cutoff||confirmedJob.winner!==job.winner)return{status:'awaiting_selection_finality'};await syncRecoveredJob(db,{id,attempt,cutoff:job.cutoff.toString(),recipient:job.winner});
 let row=await reserveJob(db,{id,attempt,cutoff:job.cutoff.toString(),recipient:job.winner});
 const previous=(await db.query("SELECT token_id,artifact_hash,receipt->'manifest' AS manifest FROM artwork_jobs WHERE status='minted' AND token_id<$1 ORDER BY token_id DESC LIMIT 12",[id])).rows.reverse();const brief=creativeBrief(id,policy.baseGrid,previous);brief.outputManifest={v:1,tokenId:id,artifactHash:'SHA-256 of raw RGB bytes, lowercase 64 hex',durationMs:'0 for static or 2000-20000 for animation',effect:'0 for static or integer 1-13 for animation',holyGrail:id===1000};const input={objective:JSON.stringify(brief),skill:policy.artSkill,github:false,outputs:[{name:'art',path:'artifacts/impepe.rgb',mediaType:'application/octet-stream'},{name:'manifest',path:'artifacts/manifest.json',mediaType:'application/json'}]};
 if(!row.order_id){const quote=await imd.quote(row.request_key,input);const q=quote.order?.quote;if(!q||q.action!=='job.open'||BigInt(q.payment.amount)!==budget||q.payment.asset.toLowerCase()!==config.imdAddress.toLowerCase())throw new Error('IMD quote does not match fixed job budget');await db.query("UPDATE artwork_jobs SET order_id=$2,status='quoted',updated_at=NOW() WHERE token_id=$1",[id,quote.order.id]);row={...row,order_id:quote.order.id};}
 if(!row.admitted_verified){
  const observed=await imd.order(row.order_id);
  if(observed.status==='admitted'){await recordAdmission(db,id,observed,attempt);}
  else {
   if(['expired','payment_failed'].includes(observed.status))throw new Error('IMD_ORDER_REQUIRES_RECOVERY');
   assertLock();if(!job.paid)await(await controller.payJob()).wait();
   let outbox=(await db.query("SELECT * FROM transaction_outbox WHERE token_id=$1 AND operation='imd-payment' AND attempt=$2",[id,attempt])).rows[0];
   if(!outbox){
    const money=new Contract(config.imdAddress,['function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)'],wallet);
    if(await money.allowance(wallet.address,policy.permit2)<budget)await(await money.approve(policy.permit2,budget)).wait();
    const challenge=await imd.challenge(row.order_id);const envelope=await preparePayment(challenge,{orderId:row.order_id,inputHash:sha(Buffer.from(canonical(input))),imdAddress:config.imdAddress,payTo:policy.payTo,spender:policy.spender,maxAmount:budget.toString()},paymentSigner);
    outbox=await persistOutbox(db,id,'imd-payment',encrypt(envelope,policy.encryptionKey),attempt);
   }
   if(Number(await controller.attempts(id))!==attempt)throw new Error('Recovery changed during payment preparation');
   assertLock();await submitPrepared(imd,decrypt(outbox.payload,policy.encryptionKey),{enabled:true});
   const admitted=await imd.order(row.order_id);if(admitted.status!=='admitted')return {status:'awaiting_admission'};await recordAdmission(db,id,admitted,attempt);
  }
  row=(await db.query('SELECT * FROM artwork_jobs WHERE token_id=$1',[id])).rows[0];
 }
 if(job.requestId==='0x'+'0'.repeat(64))await(await controller.bindRequest(keccak256(toUtf8Bytes(row.imd_job_id)))).wait();
 const result=await imd.job(row.imd_job_id);const status=result.state||result.job?.state||result.job?.status||result.status;
 if(status==='completed'){await db.query("UPDATE artwork_jobs SET status='completed',updated_at=NOW() WHERE token_id=$1",[id]);assertLock();return await completeArtwork({db,provider,config,wallet,imd,policy,assertLock});}
 if(['failed','cancelled','blocked'].includes(status)){await db.query("UPDATE artwork_jobs SET status='failed',updated_at=NOW(),error_code='IMD_JOB_FAILED' WHERE token_id=$1",[id]);return{status:'failed'};}
 await db.query("UPDATE artwork_jobs SET status='running',updated_at=NOW() WHERE token_id=$1",[id]);return{status:'running'};
}
export async function workerCycle(context){
 if(!context.config.liveTransactions)return {status:'transactions_disabled'};
 if(!context.db.withAdvisoryLock)throw new Error('POSTGRES_WORKER_LOCK_REQUIRED');
 return context.db.withAdvisoryLock(`impepe-operator-${context.config.chainId}-${context.wallet.address.toLowerCase()}`,async assertLock=>{
  const wallet=new Proxy(context.wallet,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return (...args)=>{if(['sendTransaction','signTransaction','signTypedData'].includes(key))assertLock();return value.apply(target,args);};}});
  try{const result=await cycleUnlocked({...context,wallet,assertLock});await context.db.query("INSERT INTO service_state(name,status) VALUES('worker',$1) ON CONFLICT(name) DO UPDATE SET status=$1,observed_at=NOW(),error_code=NULL",[result.status]);return result;}catch(error){await context.db.query("INSERT INTO service_state(name,status,error_code) VALUES('worker','halted','CYCLE_REJECTED') ON CONFLICT(name) DO UPDATE SET status='halted',observed_at=NOW(),error_code='CYCLE_REJECTED'");throw error;}
 });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=loadConfig();if(!config.liveTransactions){console.log('Worker disabled LIVE_TRANSACTIONS=false');process.exit(0);}
 const key=process.env.OPERATOR_PRIVATE_KEY;if(!key)throw new Error('Local Operator key required');
 const db=database(config.databaseUrl),provider=new JsonRpcProvider(config.rpcUrl),wallet=new Wallet(key,provider);
 const account=privateKeyToAccount(key);const paymentSigner=toClientEvmSigner(account,createPublicClient({chain:mainnet,transport:http(config.rpcUrl)}));const imd=new IMDClient({token:config.imdPaidToken});
 const policy={artSkill:process.env.IMD_ART_SKILL,payTo:process.env.IMD_PAY_TO,spender:process.env.IMD_PAYMENT_SPENDER,permit2:process.env.PERMIT2_ADDRESS,encryptionKey:process.env.OUTBOX_ENCRYPTION_KEY,finalityUrl:process.env.FINALITY_ATTESTATION_URL,artifactUrl:process.env.ARTIFACT_ATTESTATION_URL,attestorToken:process.env.ATTESTOR_SERVICE_TOKEN,baseGrid:['..........','..........','..........','...GGGG...','...W.W....','...GGGG...','...RRRR...','..........','...GGGG...','...GGGG...']};
 let stopped=false;process.on('SIGINT',()=>stopped=true);while(!stopped){try{console.log(await workerCycle({config,db,provider,wallet,paymentSigner,imd,policy}));}catch{console.error('Worker cycle halted Review the job and configuration before retrying');}await new Promise(resolve=>setTimeout(resolve,15000));}await db.close();provider.destroy();
}
