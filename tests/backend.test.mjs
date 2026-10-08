import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';import {generateKeyPairSync,sign} from 'node:crypto';
import {applyTransfer,rank,feeSplit} from '../backend/accounting.mjs';import {validateArt,sha,authenticateArtifact} from '../backend/art.mjs';
import {reserveJob,recordAdmission,persistOutbox,syncRecoveredJob,encrypt,decrypt} from '../backend/jobs.mjs';import {buildServer} from '../backend/server.mjs';
import {preparePayment,validateChallenge,canonical,submitPrepared} from '../backend/payment.mjs';
import {indexBatch} from '../backend/indexer.mjs';import {Interface} from 'ethers';
const alice=`0x${'1'.repeat(40)}`,bob=`0x${'2'.repeat(40)}`,zero=`0x${'0'.repeat(40)}`;
async function database(){const db=new PGlite();await db.exec(await fs.readFile(new URL('../backend/schema.sql',import.meta.url),'utf8'));return db;}

test('recovery archives old admissions and payment outboxes and rejects stale attempt results',async()=>{
 const db=await database();try{
  const first=await reserveJob(db,{id:1,cutoff:100,recipient:alice});await db.query("UPDATE artwork_jobs SET order_id='old-order' WHERE token_id=1");const admitted={status:'admitted',order:{id:'old-order'},payment:{paid:true,status:'confirmed'},admission:{action:'job.open',result:{kind:'job',jobId:'old-imd-job'}}};await recordAdmission(db,1,admitted);await persistOutbox(db,1,'imd-payment',{old:true});
  await assert.rejects(syncRecoveredJob(db,{id:1,attempt:2,cutoff:100,recipient:alice}),/mismatch/);
  await syncRecoveredJob(db,{id:1,attempt:1,cutoff:100,recipient:alice});await syncRecoveredJob(db,{id:1,attempt:1,cutoff:100,recipient:alice});
  const next=await reserveJob(db,{id:1,attempt:1,cutoff:100,recipient:alice});assert.notEqual(next.request_key,first.request_key);assert.equal(next.order_id,null);assert.equal(next.admitted_verified,false);await assert.rejects(recordAdmission(db,1,admitted,0),/mismatch/);await assert.rejects(reserveJob(db,{id:1,cutoff:100,recipient:alice}),/RECOVERY/);
  await persistOutbox(db,1,'imd-payment',{fresh:true},1);assert.equal((await db.query('SELECT COUNT(*)::int n FROM transaction_outbox')).rows[0].n,2);assert.equal((await db.query('SELECT COUNT(*)::int n FROM artwork_job_attempts')).rows[0].n,1);
  const app=buildServer({config:{chainId:1,origin:'http://127.0.0.1:4180'},db,provider:null});const stats=(await app.inject('/api/swarm')).json();assert.equal(stats.requested,1);assert.equal(stats.completed,0);assert.equal(stats.latestJob.id,'old-imd-job');await app.close();
  await db.exec(await fs.readFile(new URL('../backend/schema.sql',import.meta.url),'utf8'));
 }finally{await db.close();}
});
test('PostgreSQL ledger accumulates from day one, keeps seller scores and rolls back invalid transfers',async()=>{
 const db=await database();try{
  await db.transaction(tx=>applyTransfer(tx,{chainId:1,from:zero,to:alice,value:'100',timestamp:0,blockNumber:1}));
  await db.transaction(tx=>applyTransfer(tx,{chainId:1,from:alice,to:bob,value:'50',timestamp:100,blockNumber:2}));
  let rows=(await db.query('SELECT address,balance::text,score::text,last_timestamp FROM holders')).rows;
  const ranking=rank(rows,200);assert.equal(ranking[0].address,alice);assert.equal(ranking[0].score,'15000');assert.equal(ranking[1].score,'5000');
  await assert.rejects(db.transaction(tx=>applyTransfer(tx,{chainId:1,from:bob,to:alice,value:'500',timestamp:300,blockNumber:3})),/incomplete/);
  assert.equal((await db.query('SELECT balance::text FROM holders WHERE address=$1',[bob])).rows[0].balance,'50');
  assert.equal(rank(rows,200,[alice])[0].address,bob);assert.equal(rank(rows,200,[],[alice])[0].address,bob);
 }finally{await db.close();}
});
test('job reservations are idempotent and canonical counters require confirmed admission',async()=>{
 const db=await database();try{
  const one=await reserveJob(db,{id:1,cutoff:100,recipient:alice});const two=await reserveJob(db,{id:1,cutoff:100,recipient:alice});assert.equal(one.request_key,two.request_key);
  await assert.rejects(reserveJob(db,{id:1,cutoff:101,recipient:bob}),/conflict/);await assert.rejects(recordAdmission(db,1,{status:'quoted'}),/Unverified/);
  await db.query("UPDATE artwork_jobs SET order_id='order-1' WHERE token_id=1");
  await recordAdmission(db,1,{status:'admitted',order:{id:'order-1'},payment:{paid:true,status:'confirmed'},admission:{action:'job.open',result:{kind:'job',jobId:'imd-1'}}});
  const config={chainId:1,origin:'http://127.0.0.1:4180',tokenAddress:alice};const app=buildServer({config,db,provider:null});
  const swarm=await app.inject('/api/swarm');assert.equal(swarm.json().requested,1);assert.equal(swarm.json().completed,0);
  assert.equal((await app.inject('/api/collection')).statusCode,503);assert.equal((await app.inject('/api/market')).statusCode,503);
  assert.equal((await app.inject(`/api/quote?chainId=1&tokenAddress=${alice}&side=buy&amount=1&slippageBps=100`)).statusCode,503);
  assert.equal((await app.inject(`/api/quote?chainId=1&tokenAddress=${alice}&side=buy&amount=-1&slippageBps=100`)).statusCode,400);
  await app.close();
 }finally{await db.close();}
});
test('raw grid validation and device signature verification reject mutations and wrong leases',()=>{
 const bytes=Buffer.alloc(300,50);const hash=sha(bytes);validateArt(bytes,{tokenId:1,baseHash:hash});assert.throws(()=>validateArt(bytes,{tokenId:1,baseHash:'bad'}));assert.throws(()=>validateArt(Buffer.alloc(301),{tokenId:2}));
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');const deviceKey=publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');const leaseId='lease-1';
 const signature=sign(null,Buffer.from(`identitymd.v2\nartifact:${leaseId}\n${hash}`),privateKey).toString('hex');const receipt={hash,deviceKey,leaseId,signature},expected={expectedHash:hash,expectedDevice:deviceKey,expectedLease:leaseId};
 assert.equal(authenticateArtifact(bytes,receipt,expected),true);assert.throws(()=>authenticateArtifact(Buffer.alloc(300,51),receipt,expected));assert.throws(()=>authenticateArtifact(bytes,receipt,{...expected,expectedLease:'other'}));
 const a=validateArt(Buffer.alloc(600),{tokenId:1000,effect:13,durationMs:4000});const b=validateArt(Buffer.alloc(600),{tokenId:1000,effect:12,durationMs:4000});assert.notEqual(a.commitmentHash,b.commitmentHash);
});
test('fee conservation includes rounding dust and encrypted outbox detects tampering',()=>{
 for(let gross=0n;gross<1000n;gross++){const fee=feeSplit(gross);assert.equal(fee.creation+fee.protocol,fee.total);}
 const key='ab'.repeat(32),sealed=encrypt({signature:'private'},key);assert.equal(decrypt(sealed,key).signature,'private');assert.throws(()=>decrypt({...sealed,tag:'00'.repeat(16)},key));
});
test('quote-bound payments reject wrong asset, over-budget payments, altered spender and live submission by default',async()=>{
 const now=Math.floor(Date.now()/1000),policy={orderId:'order',inputHash:'a'.repeat(64),imdAddress:alice,payTo:bob,spender:bob,maxAmount:'500',now};
 const quote={id:'order',action:'job.open',inputHash:policy.inputHash,quoteHash:'c'.repeat(64),expiresAt:now+300,payment:{network:'eip155:1',asset:alice,payTo:bob,amount:'500'}};
 const accepted={network:'eip155:1',asset:alice,payTo:bob,amount:'500',scheme:'exact',extra:{assetTransferMethod:'permit2'}};
 const challenge={quote,accepts:[accepted],resourceUrl:'https://api.imd.fun/requests/order/submit',requesterScopeHash:'b'.repeat(64),resource:{url:'https://api.imd.fun/requests/order/submit'}};
 let approvals=0;const signer={address:alice,async signTypedData({message}){approvals++;assert.match(message.paymentHash,/^0x[0-9a-f]{64}$/);return '0x'+'1'.repeat(130);}};
 const client={async createPaymentPayload(){return{x402Version:2,resource:challenge.resource,extensions:{drop:true},payload:{signature:'0x123',permit2Authorization:{from:alice,permitted:{token:alice,amount:'500'},spender:bob,nonce:'1',deadline:now+200,witness:{to:bob,validAfter:now}}}};}};
 const envelope=await preparePayment(challenge,policy,signer,{client});assert.equal(approvals,1);assert.equal(JSON.parse(Buffer.from(envelope.header,'base64')).extensions,undefined);
 assert.throws(()=>validateChallenge(challenge,{...policy,maxAmount:'499'}));assert.throws(()=>validateChallenge(challenge,{...policy,imdAddress:bob}));await assert.rejects(preparePayment(challenge,{...policy,spender:alice},signer,{client}),/Permit2/);await assert.rejects(submitPrepared({},envelope),/disabled/);
 assert.equal(canonical({z:1,a:'x'}),'{"a":"x","z":1}');
});
test('finalized indexing is idempotent and halts on a changed historical block hash',async()=>{
 const db=await database();try{
  const iface=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);const event=iface.encodeEventLog(iface.getEvent('Transfer'),[zero,alice,100n]);const hash='0x'+'a'.repeat(64),parent='0x'+'b'.repeat(64);let changed=false;
  const provider={async getNetwork(){return{chainId:1n};},async send(){return{number:'0x1',timestamp:'0x64',hash:changed?'0x'+'c'.repeat(64):hash,parentHash:parent};},async getLogs(filter){assert.ok(filter.address.includes(bob));return[{address:alice,topics:event.topics,data:event.data,index:0,transactionHash:'0x'+'d'.repeat(64)}];}};
  const config={chainId:1,tokenAddress:alice,controllerHistory:[bob],rpcUrl:'test',startBlock:1};const first=await indexBatch(db,provider,config);assert.equal(first.indexed,1);const second=await indexBatch(db,provider,config);assert.equal(second.indexed,0);assert.equal((await db.query('SELECT balance::text FROM holders WHERE address=$1',[alice])).rows[0].balance,'100');
  changed=true;await assert.rejects(indexBatch(db,provider,config),/HISTORY_MISMATCH/);assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM chain_events')).rows[0].n,1);
 }finally{await db.close();}
});
