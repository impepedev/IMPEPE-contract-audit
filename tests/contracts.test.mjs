import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {network} from 'hardhat';import {BrowserProvider,ContractFactory,AbiCoder,parseEther,sha256,keccak256,toUtf8Bytes,getCreate2Address,zeroPadValue,toBeHex,MaxUint256,ZeroHash} from 'ethers';
import {compile} from '../scripts/compile.mjs';
import {openingPrice} from '../scripts/opening-price.mjs';
import {spawnSync} from 'node:child_process';import path from 'node:path';import {randomUUID} from 'node:crypto';
const all=compile({tests:true});
function artifact(name){for(const items of Object.values(all))if(items[name]?.evm.bytecode.object)return items[name];throw new Error(name);}
export const baseArt=Buffer.alloc(300);
const rows=['..........','..........','..........','...GGGG...','...W.W....','...GGGG...','...RRRR...','..........','...GGGG...','...GGGG...'];
const palette={'.':[0,0,0],G:[34,183,0],W:[255,255,255],R:[183,0,0]};rows.join('').split('').forEach((c,i)=>baseArt.set(palette[c],i*3));
const gas={};
test('accepted swarm output is independently signed, durably submitted and minted automatically on a local chain',async()=>{
 const {PGlite}=await import('@electric-sql/pglite'),{buildAttestor}=await import('../backend/attestor.mjs'),{completeArtwork,reconcileMints}=await import('../backend/submit-art.mjs'),{reserveJob,recordAdmission}=await import('../backend/jobs.mjs'),{artFixture}=await import('./fixtures/art-fixture.mjs'),{HDNodeWallet}=await import('ethers');
 const f=await fixture({realVerifier:true}),db=new PGlite();let app;try{
  await db.exec(fs.readFileSync('backend/schema.sql','utf8'));const config={liveTransactions:true,chainId:31337,controllerAddress:f.controller.target,collectionAddress:f.nft.target,tokenAddress:f.token.target,signingEnabled:true};const serviceToken='test-service-token-'.repeat(3),data=artFixture({tokenId:1,bytes:baseArt,payer:await f.operator.getAddress()});
  app=buildAttestor({provider:f.provider,signer:f.accounts[5],config,imd:data.imd,serviceToken});const origin=await app.listen({host:'127.0.0.1',port:0});assert.equal((await app.inject({method:'POST',url:'/artifact',payload:{tokenId:1,attempt:0,imdJobId:data.imdJobId}})).statusCode,401);
  await(await f.source.route(f.router.target,parseEther('20'))).wait();await(await f.controller.openNextJob()).wait();for(let i=0;i<4;i++)await f.rpc.request({method:'evm_mine',params:[]});const opened=await f.controller.jobs(1);
  const finality=(await app.inject({url:`/finality?cutoff=${opened.cutoff}`,headers:{authorization:`Bearer ${serviceToken}`}})).json();assert.ok(finality.signature);await(await f.controller.confirmFinality(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','bytes'],[finality.blockHash,finality.expiresAt,finality.signature]))).wait();await(await f.controller.scan(250)).wait();await(await f.controller.connect(f.operator).payJob()).wait();await(await f.controller.connect(f.operator).bindRequest(keccak256(toUtf8Bytes(data.imdJobId)))).wait();const selected=await f.controller.jobs(1);
  await reserveJob(db,{id:1,cutoff:selected.cutoff.toString(),recipient:selected.winner});await db.query("UPDATE artwork_jobs SET order_id='local-confirmed-order' WHERE token_id=1");await recordAdmission(db,1,{status:'admitted',order:{id:'local-confirmed-order'},payment:{paid:true,status:'confirmed'},admission:{action:'job.open',result:{kind:'job',jobId:data.imdJobId}}});await db.query("UPDATE artwork_jobs SET status='completed' WHERE token_id=1");
  const wallet=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,"m/44'/60'/0'/0/4").connect(f.provider);assert.equal(wallet.address.toLowerCase(),(await f.operator.getAddress()).toLowerCase());const nonce=await wallet.getNonce('latest');const policy={artifactUrl:`${origin}/artifact`,attestorToken:serviceToken,encryptionKey:'ab'.repeat(32)};
  assert.equal((await completeArtwork({db,provider:f.provider,config:{...config,liveTransactions:false},wallet,imd:data.imd,policy})).status,'transactions_disabled');assert.equal((await db.query('SELECT count(*)::int n FROM transaction_outbox')).rows[0].n,0);
  const submitted=await completeArtwork({db,provider:f.provider,config,wallet,imd:data.imd,policy});assert.equal(submitted.status,'awaiting_mint_confirmation');assert.ok(submitted.txHash);assert.equal(await f.nft.ownerOf(1),selected.winner);assert.deepEqual(Buffer.from((await f.nft.artwork(1)).slice(2),'hex'),baseArt);
  // Simulate a crash after broadcast but before recording confirmation; the chain receipt is authoritative.
  await db.query("UPDATE transaction_outbox SET state='prepared',tx_hash=NULL WHERE operation LIKE 'mint:%'");await reconcileMints({db,provider:f.provider,config,wallet,encryptionKey:policy.encryptionKey});assert.equal((await db.query('SELECT status FROM artwork_jobs')).rows[0].status,'minted');assert.equal((await db.query('SELECT state FROM transaction_outbox')).rows[0].state,'confirmed');assert.equal(await wallet.getNonce('latest'),nonce+1);assert.equal(await f.nft.totalSupply(),1n);await reconcileMints({db,provider:f.provider,config,wallet,encryptionKey:policy.encryptionKey});assert.equal(await wallet.getNonce('latest'),nonce+1);assert.equal(await f.controller.nextJobId(),2n);
 }finally{await app?.close();await db.close();await f.connection.close();}
});
async function fixture({seeded=false,v4=false,reverse=false,realVerifier=false}={}) {
 const connection=await network.connect('default');const rpc=connection.provider;const provider=new BrowserProvider(rpc,undefined,realVerifier?{cacheTimeout:-1}:{});provider.pollingInterval=10;
 const accounts=await Promise.all(Array.from({length:8},(_,i)=>provider.getSigner(i)));const [admin,publicWallet,alice,bob,operator]=accounts;
 const addr=async x=>x.getAddress();
 async function deploy(name,args=[]){const a=artifact(name);const contract=await new ContractFactory(a.abi,a.evm.bytecode.object,admin).deploy(...args);await contract.waitForDeployment();return contract;}
 let token,imd;if(reverse){imd=await deploy('TestIMD');token=await deploy('ProjectToken',[await addr(admin),await addr(publicWallet)]);}else{token=await deploy('ProjectToken',[await addr(admin),await addr(publicWallet)]);imd=await deploy('TestIMD');}const verifier=realVerifier?await deploy('ReceiptVerifier',[await accounts[5].getAddress()]):await deploy('TestVerifier');
 const nft=await deploy(seeded?'SeededCollection':'SwarmCollection',[await addr(admin)]);const rewards=await deploy('RewardsDistributor',[imd.target,nft.target]);
 const controller=await deploy('CreationController',[await addr(admin),imd.target,token.target,nft.target,verifier.target,await addr(operator),await addr(operator),parseEther('0.5'),2,sha256(baseArt)]);
 const router=await deploy('FeeRouter',[await addr(admin),imd.target,controller.target,rewards.target,await addr(admin)]);
 const source=await deploy('TestFeeSource');await(await controller.configureRouter(router.target)).wait();await(await nft.configure(controller.target,rewards.target)).wait();
 let manager,swap,liquidity,hook,key,vault,trade;
 if(v4){
  manager=await deploy('PoolManager',[await addr(admin)]);swap=await deploy('PoolSwapTest',[manager.target]);liquidity=await deploy('PoolModifyLiquidityTest',[manager.target]);const factory=await deploy('TestCreate2');
  vault=await deploy('LiquidityBootstrap',[await addr(admin),manager.target,token.target,imd.target]);
  const a=artifact('IMPEPEHook');const init=(await new ContractFactory(a.abi,a.evm.bytecode.object,admin).getDeployTransaction(manager.target,imd.target,token.target,router.target,60,vault.target)).data;
  const initHash=keccak256(init);let salt,target;for(let i=0;;i++){salt=zeroPadValue(toBeHex(i),32);target=getCreate2Address(factory.target,salt,initHash);if((BigInt(target)&0x3fffn)===0x2accn)break;}
  await(await factory.deploy(salt,init)).wait();hook=new (await import('ethers')).Contract(target,a.abi,admin);
  trade=await deploy('IMPEPESwapRouter',[manager.target,hook.target]);
  key={currency0:BigInt(imd.target)<BigInt(token.target)?imd.target:token.target,currency1:BigInt(imd.target)<BigInt(token.target)?token.target:imd.target,fee:0,tickSpacing:60,hooks:hook.target};
  await(await router.configureHook(hook.target)).wait();
 }else{await(await router.configureHook(source.target)).wait();await(await source.approve(imd.target,router.target)).wait();await(await imd.transfer(source.target,parseEther('100000'))).wait();}
 for(const value of [await addr(admin),await addr(publicWallet),await addr(operator),router.target,controller.target,rewards.target,source.target,...(v4?[manager.target,swap.target,liquidity.target,hook.target]:[])])await(await token.setExcluded(value,true)).wait();
 await(await token.sealEligibility()).wait();
 await(await token.connect(publicWallet).transfer(await addr(alice),parseEther('100'))).wait();await rpc.request({method:'evm_increaseTime',params:[100]});await rpc.request({method:'evm_mine',params:[]});
 await(await token.connect(publicWallet).transfer(await addr(bob),parseEther('100'))).wait();await rpc.request({method:'evm_increaseTime',params:[20]});await rpc.request({method:'evm_mine',params:[]});
 return {connection,rpc,provider,accounts,admin,publicWallet,alice,bob,operator,token,imd,verifier,nft,rewards,controller,router,source,manager,swap,liquidity,hook,key,vault,trade,deploy};
}
async function seedPool(f,{donation=0n,openingTick=0}={}){
 for(const holder of [f.alice,f.bob])await(await f.token.connect(holder).transfer(await f.publicWallet.getAddress(),await f.token.balanceOf(await holder.getAddress()))).wait();
 await(await f.token.connect(f.publicWallet).transfer(f.vault.target,parseEther('980000000'))).wait();if(donation)await(await f.token.transfer(f.vault.target,donation)).wait();await(await f.vault.configure(f.key,openingTick)).wait();
 gas.seedLiquidity=String((await(await f.vault.seed()).wait()).gasUsed);
 assert.equal(await f.imd.balanceOf(f.manager.target),0n);assert.ok(await f.token.balanceOf(f.vault.target)<=donation+1000000000000n);assert.ok(await f.vault.positionLiquidity()>0n);
 for(const asset of [f.token,f.imd]){await(await asset.connect(f.publicWallet).approve(f.swap.target,MaxUint256)).wait();await(await asset.connect(f.publicWallet).approve(f.trade.target,MaxUint256)).wait();}
 await(await f.imd.transfer(await f.publicWallet.getAddress(),parseEther('2000000'))).wait();
}
async function ready(f){await(await f.controller.openNextJob()).wait();for(let i=0;i<4;i++)await f.rpc.request({method:'evm_mine',params:[]});await assert.rejects(f.controller.scan(250));await(await f.controller.confirmFinality('0x')).wait();await(await f.controller.scan(250,{gasLimit:3000000})).wait();}
async function mint(f,art=baseArt){await(await f.controller.connect(f.operator).payJob()).wait();await(await f.controller.connect(f.operator).bindRequest(keccak256(toUtf8Bytes(`job-${await f.controller.nextJobId()}`)))).wait();return(await(await f.controller.connect(f.operator).submit(art,art.length>300?4000:0,art.length>300?13:0,'0x')).wait());}

async function replacement(f,previous=f.controller){
 const verifier=await f.deploy('TestVerifier');const next=await f.deploy('CreationController',[await f.admin.getAddress(),f.imd.target,f.token.target,f.nft.target,verifier.target,await f.operator.getAddress(),await f.operator.getAddress(),parseEther('0.5'),2,sha256(baseArt)]);
 await(await next.configureRouter(f.router.target)).wait();await(await next.prepareMigration(previous.target)).wait();return next;
}

test('emergency recovery is admin-only, delayed, cancellable and permanently retires the old controller',async()=>{
 const f=await fixture();try{
  await(await f.source.route(f.router.target,parseEther('20'))).wait();await ready(f);const reason=keccak256(toUtf8Bytes('migration review'));
  await assert.rejects(f.controller.connect(f.operator).emergencyPause());await assert.rejects(f.controller.scheduleWithdrawal(reason));await(await f.controller.emergencyPause()).wait();
  for(const call of [()=>f.controller.openNextJob(),()=>f.controller.scan(1),()=>f.controller.connect(f.operator).payJob(),()=>f.controller.connect(f.operator).bindRequest(reason),()=>f.controller.connect(f.operator).submit(baseArt,0,0,'0x')])await assert.rejects(call());
  await(await f.controller.scheduleWithdrawal(reason,{gasLimit:1000000})).wait();await assert.rejects(f.controller.resumeCreation());await assert.rejects(f.controller.withdrawCreationFunds());await assert.rejects(f.controller.connect(f.bob).cancelWithdrawal());
  await(await f.controller.cancelWithdrawal()).wait();await(await f.controller.resumeCreation({gasLimit:1000000})).wait();await(await f.controller.emergencyPause({gasLimit:1000000})).wait();await(await f.controller.scheduleWithdrawal(reason,{gasLimit:1000000})).wait();
  await(await f.source.route(f.router.target,parseEther('10'))).wait();await f.rpc.request({method:'evm_increaseTime',params:[172800]});await f.rpc.request({method:'evm_mine',params:[]});const balance=await f.imd.balanceOf(await f.admin.getAddress());
  await(await f.controller.transferOwnership(await f.bob.getAddress())).wait();await(await f.controller.connect(f.bob).withdrawCreationFunds({gasLimit:1000000})).wait();assert.equal((await f.imd.balanceOf(await f.admin.getAddress()))-balance,parseEther('0.9'));assert.equal(await f.controller.recoveryRecipient(),await f.admin.getAddress());assert.equal(await f.controller.retired(),true);assert.equal(await f.imd.balanceOf(f.controller.target),0n);await assert.rejects(f.controller.connect(f.bob).resumeCreation());await assert.rejects(f.controller.connect(f.bob).withdrawCreationFunds());
 }finally{await f.connection.close();}
});

test('delayed atomic controller migration preserves the token, NFTs, scores, requests and pending job',async()=>{
 const f=await fixture();try{
  await(await f.source.route(f.router.target,parseEther('40'))).wait();await ready(f);await mint(f);await ready(f);await(await f.controller.connect(f.operator).payJob()).wait();const pendingRequest=keccak256(toUtf8Bytes('pending-2'));await(await f.controller.connect(f.operator).bindRequest(pendingRequest)).wait();const pending=await f.controller.jobs(2),firstUri=await f.nft.tokenURI(1),firstOwner=await f.nft.ownerOf(1),score=await f.token.scoreAt(firstOwner,pending.cutoff,pending.time);
  await(await f.controller.emergencyPause()).wait();await(await f.controller.scheduleWithdrawal(keccak256(toUtf8Bytes('controller replacement')))).wait();const next=await replacement(f);await assert.rejects(next.resumeCreation());await assert.rejects(next.connect(f.operator).payJob());await assert.rejects(f.nft.replaceController(next.target));await assert.rejects(f.router.connect(f.operator).scheduleControllerMigration(next.target));
  await(await f.router.scheduleControllerMigration(next.target)).wait();await assert.rejects(f.router.executeControllerMigration());await f.rpc.request({method:'evm_increaseTime',params:[172800]});await f.rpc.request({method:'evm_mine',params:[]});await(await f.controller.withdrawCreationFunds()).wait();
  // Trading continues during migration; creation fees are escrowed instead of sent to a retired controller.
  await(await f.source.route(f.router.target,parseEther('10'))).wait();assert.equal(await f.router.migrationEscrow(),parseEther('0.3'));await assert.rejects(f.router.executeControllerMigration());await assert.rejects(f.router.connect(f.operator).executeControllerMigration());
  await(await f.imd.approve(next.target,await f.controller.recoveredAmount())).wait();await(await f.router.executeControllerMigration({gasLimit:5000000})).wait();
  assert.equal(await f.router.creation(),next.target);assert.equal(await f.nft.controller(),next.target);assert.equal(await f.nft.ownerOf(1),firstOwner);assert.equal(await f.nft.tokenURI(1),firstUri);assert.equal(await next.token(),f.token.target);assert.equal(await next.verifier()===await f.controller.verifier(),false);assert.equal(await next.nextJobId(),2n);assert.equal(await next.totalFunded(),parseEther('1.5'));assert.equal(await next.allocated(firstOwner),true);assert.equal(await next.usedRequests(pendingRequest),true);assert.equal(await next.usedRequests(keccak256(toUtf8Bytes('job-1'))),true);assert.equal(await next.fundingLength(),2n);assert.deepEqual(Array.from(await next.funding(0)),Array.from(await f.controller.funding(0)));assert.deepEqual(Array.from(await f.token.scoreAt(firstOwner,pending.cutoff,pending.time)),Array.from(score));
  assert.equal((await next.jobs(2)).winner,pending.winner);assert.equal((await next.jobs(2)).requestId,pendingRequest);assert.equal((await next.jobs(2)).paid,true);assert.equal(await next.paused(),false);assert.equal(await f.router.migrationEscrow(),0n);assert.equal(await f.imd.allowance(f.router.target,f.controller.target),0n);
  await assert.rejects(next.connect(f.operator).payJob());await(await next.connect(f.operator).submit(Buffer.alloc(300,42),0,0,'0x')).wait();assert.equal(await f.nft.ownerOf(2),pending.winner);assert.equal(await next.nextJobId(),3n);assert.equal(await next.allocated(pending.winner),true);assert.deepEqual(Array.from(await next.jobs(1)),Array.from(await f.controller.jobs(1)));await assert.rejects(f.controller.connect(f.operator).submit(baseArt,0,0,'0x'));
  await(await next.emergencyPause()).wait();await(await next.scheduleWithdrawal(keccak256(toUtf8Bytes('second replacement')))).wait();const third=await replacement(f,next);await(await f.router.scheduleControllerMigration(third.target)).wait();await f.rpc.request({method:'evm_increaseTime',params:[172800]});await f.rpc.request({method:'evm_mine',params:[]});await(await next.withdrawCreationFunds()).wait();await(await f.imd.approve(third.target,await next.recoveredAmount())).wait();await(await f.router.executeControllerMigration({gasLimit:5000000})).wait();assert.equal(await third.migrationDepth(),2n);assert.equal(await third.allocated(firstOwner),true);assert.equal(await third.allocated(pending.winner),true);assert.equal(await third.usedRequests(pendingRequest),true);assert.deepEqual(Array.from(await third.jobs(1)),Array.from(await f.controller.jobs(1)));assert.deepEqual(Array.from(await third.funding(0)),Array.from(await f.controller.funding(0)));assert.equal(await third.nextJobId(),3n);
 }finally{await f.connection.close();}
});

test('creation emergency recovery cannot withdraw phase II holder rewards',async()=>{
 const f=await fixture({seeded:true});try{
  await(await f.nft.seedNearCompletion(await f.alice.getAddress(),await f.bob.getAddress())).wait();const layout=artifact('CreationController').storageLayout.storage.find(row=>row.label==='nextJobId');await f.rpc.request({method:'hardhat_setStorageAt',params:[f.controller.target,toBeHex(BigInt(layout.slot)),zeroPadValue(toBeHex(1000),32)]});await(await f.source.route(f.router.target,parseEther('20000'))).wait();await ready(f);await mint(f,Buffer.alloc(600,61));const balance=await f.imd.balanceOf(f.rewards.target);assert.ok(balance>0n);await assert.rejects(f.controller.emergencyPause());await assert.rejects(f.controller.scheduleWithdrawal(keccak256(toUtf8Bytes('no reward withdrawal'))));await assert.rejects(f.controller.withdrawCreationFunds());assert.equal(await f.imd.balanceOf(f.rewards.target),balance);await(await f.rewards.connect(f.alice).claim([1,1000])).wait();
 }finally{await f.connection.close();}
});

test('the unchanged v4 pool and swap router keep trading across controller replacement',async()=>{
 const f=await fixture({v4:true});try{
  await seedPool(f);const buying=f.key.currency0===f.imd.target,deadline=(await f.provider.getBlock('latest')).timestamp+400000,liquidity=await f.vault.positionLiquidity();
  await(await f.trade.connect(f.publicWallet).swapExactInput(f.key,buying,parseEther('100'),1,deadline,{gasLimit:1500000})).wait();await(await f.controller.emergencyPause()).wait();await(await f.controller.scheduleWithdrawal(keccak256(toUtf8Bytes('pool retained')))).wait();const next=await replacement(f);await(await f.router.scheduleControllerMigration(next.target)).wait();await f.rpc.request({method:'evm_increaseTime',params:[172800]});await f.rpc.request({method:'evm_mine',params:[]});await(await f.controller.withdrawCreationFunds()).wait();
  await(await f.trade.connect(f.publicWallet).swapExactInput(f.key,buying,parseEther('10'),1,deadline,{gasLimit:1500000})).wait();assert.equal(await f.router.migrationEscrow(),parseEther('0.3'));await(await f.imd.approve(next.target,await f.controller.recoveredAmount())).wait();await(await f.router.executeControllerMigration({gasLimit:5000000})).wait();const funded=await next.totalFunded();await(await f.trade.connect(f.publicWallet).swapExactInput(f.key,buying,parseEther('10'),1,deadline,{gasLimit:1500000})).wait();assert.equal(await next.totalFunded()-funded,parseEther('0.3'));assert.equal(await f.vault.positionLiquidity(),liquidity);assert.equal(await f.hook.router(),f.router.target);assert.equal(await f.hook.project(),f.token.target);assert.equal(await f.imd.balanceOf(f.controller.target),0n);assert.equal(await f.vault.permanentlyLocked(),true);
 }finally{await f.connection.close();}
});

test('migration before NFT #1000 preserves the irreversible fee switch and original rewards distributor',async()=>{
 const f=await fixture({seeded:true});try{
  await(await f.nft.seedNearCompletion(await f.alice.getAddress(),await f.bob.getAddress())).wait();const layout=artifact('CreationController').storageLayout.storage.find(row=>row.label==='nextJobId');await f.rpc.request({method:'hardhat_setStorageAt',params:[f.controller.target,toBeHex(BigInt(layout.slot)),zeroPadValue(toBeHex(1000),32)]});await(await f.source.route(f.router.target,parseEther('20000'))).wait();await ready(f);await(await f.controller.emergencyPause()).wait();await(await f.controller.scheduleWithdrawal(keccak256(toUtf8Bytes('final job replacement')))).wait();const next=await replacement(f);await(await f.router.scheduleControllerMigration(next.target)).wait();await f.rpc.request({method:'evm_increaseTime',params:[172800]});await f.rpc.request({method:'evm_mine',params:[]});await(await f.controller.withdrawCreationFunds()).wait();await(await f.imd.approve(next.target,await f.controller.recoveredAmount())).wait();await(await f.router.executeControllerMigration({gasLimit:5000000})).wait();await mint({...f,controller:next},Buffer.alloc(600,62));assert.equal(await f.nft.totalSupply(),1000n);assert.equal(await f.nft.rewards(),f.rewards.target);assert.equal(await f.imd.balanceOf(next.target),0n);const before=await f.imd.balanceOf(f.rewards.target);await(await f.source.route(f.router.target,parseEther('10'))).wait();assert.equal(await f.imd.balanceOf(f.rewards.target)-before,parseEther('0.3'));await assert.rejects(next.emergencyPause());await assert.rejects(f.router.scheduleControllerMigration(f.controller.target));
 }finally{await f.connection.close();}
});

test('refund-backed recovery preserves recipient and NFT number and rejects reused requests',async()=>{
 const f=await fixture();try{
  await(await f.source.route(f.router.target,parseEther('20'))).wait();await ready(f);const original=await f.controller.jobs(1),funded=await f.controller.totalFunded();
  const oldRequest=keccak256(toUtf8Bytes('failed-job'));await(await f.controller.connect(f.operator).payJob()).wait();await(await f.controller.connect(f.operator).bindRequest(oldRequest)).wait();
  await(await f.verifier.setAccepted(false)).wait();await assert.rejects(f.controller.recoverJob('0x'));await(await f.verifier.setAccepted(true)).wait();await assert.rejects(f.controller.recoverJob('0x'));
  await(await f.imd.approve(f.controller.target,parseEther('0.5'))).wait();await(await f.controller.recoverJob('0x',{gasLimit:1000000})).wait();
  const recovered=await f.controller.jobs(1);assert.equal(recovered.winner,original.winner);assert.equal(recovered.cutoff,original.cutoff);assert.equal(recovered.selected,true);assert.equal(recovered.paid,false);assert.equal(recovered.requestId,ZeroHash);assert.equal(await f.controller.attempts(1),1n);assert.equal(await f.controller.totalFunded(),funded);assert.equal(await f.controller.nextJobId(),1n);assert.equal(await f.imd.balanceOf(f.controller.target),parseEther('0.6'));
  await assert.rejects(f.controller.recoverJob('0x'));await(await f.controller.connect(f.operator).payJob()).wait();await assert.rejects(f.controller.connect(f.operator).bindRequest(oldRequest));
  await(await f.controller.connect(f.operator).bindRequest(keccak256(toUtf8Bytes('replacement-job')))).wait();await(await f.controller.connect(f.operator).submit(baseArt,0,0,'0x')).wait();assert.equal(await f.nft.ownerOf(1),original.winner);
 }finally{await f.connection.close();}
});

test('fully scanned empty snapshots advance only to the earliest later funding block',async()=>{
 const f=await fixture();try{
  for(const holder of [f.alice,f.bob])await(await f.token.connect(holder).transfer(await f.publicWallet.getAddress(),parseEther('100'))).wait();
  await(await f.source.route(f.router.target,parseEther('20'))).wait();await(await f.controller.openNextJob()).wait();for(let i=0;i<4;i++)await f.rpc.request({method:'evm_mine',params:[]});await(await f.controller.confirmFinality('0x')).wait();
  await assert.rejects(f.controller.advanceEmptySnapshot());await(await f.controller.scan(1)).wait();await assert.rejects(f.controller.advanceEmptySnapshot());await(await f.controller.scan(250,{gasLimit:3000000})).wait();await assert.rejects(f.controller.advanceEmptySnapshot());
  await(await f.token.connect(f.publicWallet).transfer(await f.alice.getAddress(),parseEther('100'))).wait();const first=(await(await f.source.route(f.router.target,parseEther('1'))).wait()).blockNumber;await(await f.source.route(f.router.target,parseEther('1'))).wait();
  await(await f.controller.advanceEmptySnapshot({gasLimit:1000000})).wait();const advanced=await f.controller.jobs(1);assert.equal(advanced.cutoff,BigInt(first));assert.equal(advanced.finalized,false);assert.equal(await f.controller.nextJobId(),1n);await assert.rejects(f.controller.scan(250));
  for(let i=0;i<4;i++)await f.rpc.request({method:'evm_mine',params:[]});await(await f.controller.confirmFinality('0x')).wait();await(await f.controller.scan(250,{gasLimit:3000000})).wait();assert.equal((await f.controller.jobs(1)).winner,await f.alice.getAddress());await assert.rejects(f.controller.advanceEmptySnapshot());
 }finally{await f.connection.close();}
});

test('selected contract wallets receive their NFT even when receiver callbacks reject',async()=>{
 const f=await fixture();try{
  for(const holder of [f.alice,f.bob])await(await f.token.connect(holder).transfer(await f.publicWallet.getAddress(),parseEther('100'))).wait();const rejecting=await f.deploy('RejectingNFTHolder');await(await f.token.connect(f.publicWallet).transfer(rejecting.target,parseEther('100'))).wait();
  await(await f.source.route(f.router.target,parseEther('20'))).wait();await ready(f);assert.equal((await f.controller.jobs(1)).winner,rejecting.target);await mint(f);assert.equal(await f.nft.ownerOf(1),rejecting.target);assert.equal(await f.controller.nextJobId(),2n);
 }finally{await f.connection.close();}
});
test('fixed supply, cutoff scores, exclusions, operator restrictions and exact base NFT',async()=>{
 const f=await fixture();try{
  assert.equal(await f.token.totalSupply(),parseEther('1000000000'));assert.equal(await f.token.balanceOf(await f.admin.getAddress()),parseEther('20000000'));
  await assert.rejects(f.token.setExcluded(await f.alice.getAddress(),true));
  const before=await f.imd.balanceOf(await f.admin.getAddress());await(await f.source.route(f.router.target,parseEther('20'))).wait();assert.equal((await f.imd.balanceOf(await f.admin.getAddress()))-before,parseEther('0.2'));
  assert.equal(await f.imd.balanceOf(f.controller.target),parseEther('0.6'));
  await(await f.token.connect(f.alice).transfer(await f.bob.getAddress(),parseEther('100'))).wait();await ready(f);
  const job=await f.controller.jobs(1);assert.equal(job.winner.toLowerCase(),(await f.alice.getAddress()).toLowerCase());
  await assert.rejects(f.controller.payJob());await assert.rejects(f.controller.connect(f.operator).submit(baseArt,0,0,'0x'));
  await(await f.verifier.setAccepted(false)).wait();await(await f.controller.connect(f.operator).payJob()).wait();await(await f.controller.connect(f.operator).bindRequest(ZeroHash.replace(/0$/,'1'))).wait();
  await assert.rejects(f.controller.connect(f.operator).submit(baseArt,0,0,'0x'));assert.equal(await f.nft.totalSupply(),0n);
  await(await f.verifier.setAccepted(true)).wait();gas.firstMint=String((await(await f.controller.connect(f.operator).submit(baseArt,0,0,'0x')).wait()).gasUsed);
  assert.equal(await f.nft.ownerOf(1),await f.alice.getAddress());
  const uri=await f.nft.tokenURI(1);const metadata=JSON.parse(Buffer.from(uri.split(',')[1],'base64'));assert.equal(metadata.name,'IMPEPE #1');const svg=Buffer.from(metadata.image.split(',')[1],'base64').toString();assert.equal((svg.match(/<rect /g)||[]).length,100);assert.match(svg,/viewBox="0 0 10 10"/);
  await assert.rejects(f.nft.commitAndMint(await f.bob.getAddress(),baseArt,0,0));
 }finally{await f.connection.close();}
});
test('seeded #999 state tests atomic #1000, permanent routing, proportional rewards and seller credits',async()=>{
 const f=await fixture({seeded:true});try{
  await(await f.nft.seedNearCompletion(await f.alice.getAddress(),await f.bob.getAddress())).wait();
  const layout=artifact('CreationController').storageLayout.storage.find(row=>row.label==='nextJobId');await f.rpc.request({method:'hardhat_setStorageAt',params:[f.controller.target,toBeHex(BigInt(layout.slot)),zeroPadValue(toBeHex(1000),32)]});
  await(await f.source.route(f.router.target,parseEther('20000'))).wait();await ready(f);gas.finaleMint=String((await mint(f,Buffer.alloc(2400,70))).gasUsed);
  assert.equal(await f.nft.totalSupply(),1000n);assert.equal(await f.controller.nextJobId(),1001n);await assert.rejects(f.controller.openNextJob());
  assert.equal(await f.imd.balanceOf(f.controller.target),0n);await(await f.rewards.connect(f.alice).claim([1,1000])).wait();await(await f.rewards.connect(f.bob).claim([2])).wait();
  const creationBalance=await f.imd.balanceOf(f.controller.target);await(await f.source.route(f.router.target,parseEther('1000'))).wait();assert.equal(await f.imd.balanceOf(f.controller.target),creationBalance);
  assert.equal(await f.rewards.claimable(await f.alice.getAddress(),[1,1000]),parseEther('0.06'));
  await(await f.nft.connect(f.alice).transferFrom(await f.alice.getAddress(),await f.bob.getAddress(),1)).wait();
  assert.equal(await f.rewards.claimable(await f.alice.getAddress(),[1000]),parseEther('0.06'));
  await(await f.source.route(f.router.target,parseEther('1000'))).wait();
  assert.equal(await f.rewards.claimable(await f.bob.getAddress(),[1,2]),parseEther('0.09'));
  const balance=await f.imd.balanceOf(await f.alice.getAddress());await(await f.rewards.connect(f.alice).claim([1000])).wait();assert.equal((await f.imd.balanceOf(await f.alice.getAddress()))-balance,parseEther('0.09'));
  await(await f.rewards.connect(f.alice).claim([])).wait();assert.equal(await f.rewards.claimable(await f.alice.getAddress(),[1000]),0n);
  await assert.rejects(f.rewards.connect(f.alice).claim([1]));
 }finally{await f.connection.close();}
});
test('real Uniswap v4 PoolManager hook buys and sells charge only the configured 4% in IMD',async()=>{
 const f=await fixture({v4:true});try{
  await seedPool(f);
  const buyDirection=f.key.currency0.toLowerCase()===f.imd.target.toLowerCase();let protocolBefore=await f.imd.balanceOf(await f.admin.getAddress());
  const swapParams={zeroForOne:buyDirection,amountSpecified:-parseEther('10'),sqrtPriceLimitX96:buyDirection?4295128740n:1461446703485210103287273052203988822378723970341n};
  const receipt=await(await f.swap.connect(f.publicWallet).swap(f.key,swapParams,{takeClaims:false,settleUsingBurn:false},'0x')).wait();gas.buy=String(receipt.gasUsed);
  assert.equal(await f.hook.pendingCreation(),parseEther('0.3'));await(await f.hook.connect(f.bob).flushFees({gasLimit:1000000})).wait();assert.equal(await f.hook.pendingCreation(),0n);await(await f.hook.flushFees({gasLimit:1000000})).wait();
  assert.equal((await f.imd.balanceOf(await f.admin.getAddress()))-protocolBefore,parseEther('0.1'));assert.equal(await f.imd.balanceOf(f.controller.target),parseEther('0.3'));
  protocolBefore=await f.imd.balanceOf(await f.admin.getAddress());const sellDirection=!buyDirection;
  await(await f.swap.connect(f.publicWallet).swap(f.key,{zeroForOne:sellDirection,amountSpecified:-parseEther('5'),sqrtPriceLimitX96:sellDirection?4295128740n:1461446703485210103287273052203988822378723970341n},{takeClaims:false,settleUsingBurn:false},'0x')).wait();await(await f.hook.flushFees({gasLimit:1000000})).wait();assert.ok((await f.imd.balanceOf(await f.admin.getAddress()))>protocolBefore);
  await assert.rejects(f.swap.connect(f.publicWallet).swap(f.key,{...swapParams,amountSpecified:parseEther('10')},{takeClaims:false,settleUsingBurn:false},'0x'));
 }finally{await f.connection.close();fs.writeFileSync('artifacts/gas-benchmarks.json',JSON.stringify(gas,null,2));}
});
test('single-sided launch works in both currency orientations and liquidity stays permanently locked',async()=>{
 const orientations=[];
 for(const reverse of [false,true]){const f=await fixture({v4:true,reverse});try{
  orientations.push(f.key.currency0===f.token.target);await assert.rejects(f.manager.initialize(f.key,2n**96n));await assert.rejects(f.vault.configure(f.key,1));await seedPool(f,{donation:parseEther('1')});
  assert.equal(await f.vault.permanentlyLocked(),true);await assert.rejects(f.vault.seed());await assert.rejects(f.vault.configure(f.key,0));await assert.rejects(f.vault.connect(f.operator).seed());
  const withdrawData=new (await import('ethers')).Interface(['function withdraw()']).encodeFunctionData('withdraw');
  await assert.rejects(f.admin.sendTransaction({to:f.vault.target,data:withdrawData}));await f.rpc.request({method:'evm_increaseTime',params:[10*365*86400]});await f.rpc.request({method:'evm_mine',params:[]});await assert.rejects(f.admin.sendTransaction({to:f.vault.target,data:withdrawData}));
  await assert.rejects(f.vault.unlockCallback('0x'));const params={tickLower:await f.vault.lower(),tickUpper:await f.vault.upper(),liquidityDelta:1n,salt:ZeroHash};await assert.rejects(f.liquidity['modifyLiquidity((address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes)'](f.key,params,'0x'));await assert.rejects(f.liquidity['modifyLiquidity((address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes)'](f.key,{...params,liquidityDelta:-1n},'0x'));
  const buying=f.key.currency0===f.imd.target;const limit=direction=>direction?4295128740n:1461446703485210103287273052203988822378723970341n;
  const deadline=(await f.provider.getBlock('latest')).timestamp+1000;await(await f.token.approve(f.trade.target,MaxUint256)).wait();await assert.rejects(f.trade.swapExactInput(f.key,!buying,parseEther('1'),1,deadline));await assert.rejects(f.trade.unlockCallback('0x'));await assert.rejects(f.hook.unlockCallback('0x'));
  await assert.rejects(f.trade.connect(f.publicWallet).swapExactInput(f.key,buying,parseEther('1'),1,1));
  const imdBefore=await f.imd.balanceOf(await f.publicWallet.getAddress());const tokensBefore=await f.token.balanceOf(await f.publicWallet.getAddress());
  await assert.rejects(f.trade.connect(f.publicWallet).swapExactInput(f.key,buying,parseEther('100'),parseEther('1000'),deadline));
  await(await f.trade.connect(f.publicWallet).swapExactInput(f.key,buying,parseEther('100'),1,deadline)).wait();
  const purchased=(await f.token.balanceOf(await f.publicWallet.getAddress()))-tokensBefore;assert.ok(purchased>0n);assert.equal(await f.imd.balanceOf(f.manager.target),parseEther('96'));
  assert.equal(await f.imd.balanceOf(f.controller.target),parseEther('3'));
  await(await f.trade.connect(f.publicWallet).swapExactInput(f.key,!buying,purchased/2n,1,deadline)).wait();assert.ok(await f.imd.balanceOf(await f.publicWallet.getAddress())>imdBefore-parseEther('100'));assert.equal(await f.hook.pendingCreation(),0n);assert.equal(await f.hook.pendingProtocol(),0n);
  // The retained deployer tokens cannot be sold into an empty-IMD launch pool.
 }finally{await f.connection.close();}}
 assert.notEqual(orientations[0],orientations[1]);fs.writeFileSync('artifacts/gas-benchmarks.json',JSON.stringify(gas,null,2));
});
test('artifact signatures bind chain, controller, request, art and expiration',async()=>{
 const f=await fixture();try{
  const signer=f.accounts[5],verifier=await f.deploy('ReceiptVerifier',[await signer.getAddress()]);const block=await f.provider.getBlock('latest');const expiresAt=block.timestamp+1000;
  const domain={name:'IMPEPE Artifact',version:'1',chainId:31337,verifyingContract:verifier.target};const types={Artifact:[{name:'tokenId',type:'uint256'},{name:'requestId',type:'bytes32'},{name:'artifactHash',type:'bytes32'},{name:'controller',type:'address'},{name:'expiresAt',type:'uint256'}]};
  const requestId=keccak256(toUtf8Bytes('job'));const hash=sha256(baseArt);const controller=await f.admin.getAddress();const signature=await signer.signTypedData(domain,types,{tokenId:1,requestId,artifactHash:hash,controller,expiresAt});const proof=AbiCoder.defaultAbiCoder().encode(['uint256','bytes'],[expiresAt,signature]);
  assert.equal(await verifier.verify(1,requestId,hash,proof),true);assert.equal(await verifier.verify(2,requestId,hash,proof),false);assert.equal(await verifier.connect(f.operator).verify(1,requestId,hash,proof),false);
  const finalTypes={Finalized:[{name:'blockNumber',type:'uint256'},{name:'blockHash',type:'bytes32'},{name:'controller',type:'address'},{name:'expiresAt',type:'uint256'}]};
  const finalSig=await signer.signTypedData(domain,finalTypes,{blockNumber:block.number,blockHash:block.hash,controller,expiresAt});const finalProof=AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','bytes'],[block.hash,expiresAt,finalSig]);
  await f.rpc.request({method:'evm_mine',params:[]});assert.equal(await verifier.verifyFinality(block.number,finalProof),true);assert.equal(await verifier.connect(f.operator).verifyFinality(block.number,finalProof),false);assert.equal(await verifier.verifyFinality(block.number+1,finalProof),false);
  const wrongHashProof=AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','bytes'],[hash,expiresAt,finalSig]);assert.equal(await verifier.verifyFinality(block.number,wrongHashProof),false);
  const recoveryTypes={Recovery:[{name:'tokenId',type:'uint256'},{name:'requestId',type:'bytes32'},{name:'attempt',type:'uint256'},{name:'amount',type:'uint256'},{name:'paymentRecipient',type:'address'},{name:'controller',type:'address'},{name:'expiresAt',type:'uint256'}]};
  const paymentRecipient=await f.operator.getAddress(),amount=parseEther('0.5');const recoverySig=await signer.signTypedData(domain,recoveryTypes,{tokenId:1,requestId,attempt:0,amount,paymentRecipient,controller,expiresAt});const recoveryProof=AbiCoder.defaultAbiCoder().encode(['uint256','bytes'],[expiresAt,recoverySig]);
  assert.equal(await verifier.verifyRecovery(1,requestId,0,amount,paymentRecipient,recoveryProof),true);
  for(const args of [[2,requestId,0,amount,paymentRecipient],[1,hash,0,amount,paymentRecipient],[1,requestId,1,amount,paymentRecipient],[1,requestId,0,amount+1n,paymentRecipient],[1,requestId,0,amount,controller]])assert.equal(await verifier.verifyRecovery(...args,recoveryProof),false);
  assert.equal(await verifier.connect(f.operator).verifyRecovery(1,requestId,0,amount,paymentRecipient,recoveryProof),false);
  await f.rpc.request({method:'evm_increaseTime',params:[1001]});await f.rpc.request({method:'evm_mine',params:[]});assert.equal(await verifier.verify(1,requestId,hash,proof),false);assert.equal(await verifier.verifyFinality(block.number,finalProof),false);
  assert.equal(await verifier.verifyRecovery(1,requestId,0,amount,paymentRecipient,recoveryProof),false);
 }finally{await f.connection.close();}
});

test('canonical v4 Quoter matches atomic router trades at the approved price without persisting quote fees',async()=>{
 const f=await fixture({v4:true});try{
  const price=openingPrice({targetOpeningFdvImd:'1000',fixedSupply:'1000000000',tickSpacing:60,tokenAddress:f.token.target,imdAddress:f.imd.target});
  await seedPool(f,{openingTick:price.openingTick});const quoter=await f.deploy('V4Quoter',[f.manager.target]);
  const buy=f.key.currency0===f.imd.target;const deadline=(await f.provider.getBlock('latest')).timestamp+1000;
  const quote=await quoter.quoteExactInputSingle.staticCall({poolKey:f.key,zeroForOne:buy,exactAmount:parseEther('10'),hookData:'0x'});
  assert.ok(quote.amountOut>0n);assert.equal(await f.hook.pendingCreation(),0n);assert.equal(await f.imd.balanceOf(f.manager.target),0n);
  const before=await f.token.balanceOf(await f.publicWallet.getAddress());await(await f.trade.connect(f.publicWallet).swapExactInput(f.key,buy,parseEther('10'),quote.amountOut,deadline)).wait();assert.equal((await f.token.balanceOf(await f.publicWallet.getAddress()))-before,quote.amountOut);
  const sold=quote.amountOut/2n;const sellQuote=await quoter.quoteExactInputSingle.staticCall({poolKey:f.key,zeroForOne:!buy,exactAmount:sold,hookData:'0x'});const imdBefore=await f.imd.balanceOf(await f.publicWallet.getAddress());
  await(await f.trade.connect(f.publicWallet).swapExactInput(f.key,!buy,sold,sellQuote.amountOut,deadline)).wait();assert.equal((await f.imd.balanceOf(await f.publicWallet.getAddress()))-imdBefore,sellQuote.amountOut);assert.equal(await f.hook.pendingProtocol(),0n);
 }finally{await f.connection.close();}
});

test('the generated ten-contract unsigned deployment plan executes locally and seeds the approved locked pool',async()=>{
 const connection=await network.connect('default');const provider=new BrowserProvider(connection.provider);provider.pollingInterval=10;const admin=await provider.getSigner(0);
 const tempRoot=path.resolve('tests');const temp=path.join(tempRoot,`.plan-${randomUUID()}`);fs.mkdirSync(temp);
 try{
  const a=artifact('PoolManager');const manager=await new ContractFactory(a.abi,a.evm.bytecode.object,admin).deploy(await admin.getAddress());await manager.waitForDeployment();const imdArtifact=artifact('TestIMD');const imd=await new ContractFactory(imdArtifact.abi,imdArtifact.evm.bytecode.object,admin).deploy();await imd.waitForDeployment();
  const cfg={...JSON.parse(fs.readFileSync('deployment.json')),chainId:31337,deployer:await admin.getAddress(),operator:await(await provider.getSigner(4)).getAddress(),protocolRecipient:await admin.getAddress(),artifactAttestor:await(await provider.getSigner(5)).getAddress(),deployerNonce:await provider.getTransactionCount(await admin.getAddress(),'pending'),poolManager:manager.target,imdAddress:imd.target,artifactTrustApproved:true};
  const configFile=path.join(temp,'config.json');fs.writeFileSync(configFile,JSON.stringify(cfg));const result=spawnSync(process.execPath,['scripts/deployment-plan.mjs',configFile,temp],{encoding:'utf8',timeout:120000});assert.equal(result.status,0,result.stderr||result.stdout);
  const plan=JSON.parse(fs.readFileSync(path.join(temp,'unsigned-deployment-plan.json')));assert.equal(Object.keys(plan.predicted).length,10);
  for(const tx of plan.transactions){await(await admin.sendTransaction({...(tx.to?{to:tx.to}:{}),data:tx.data,value:BigInt(tx.value),nonce:tx.nonce,gasLimit:10000000})).wait();}
  const Contract=(await import('ethers')).Contract;const token=new Contract(plan.predicted.ProjectToken,artifact('ProjectToken').abi,admin);const vault=new Contract(plan.predicted.LiquidityBootstrap,artifact('LiquidityBootstrap').abi,admin);const nft=new Contract(plan.predicted.SwarmCollection,artifact('SwarmCollection').abi,admin);
  assert.equal(await token.totalSupply(),parseEther('1000000000'));assert.equal(await token.balanceOf(await admin.getAddress()),parseEther('20000000'));assert.equal(await token.eligibilitySealed(),true);assert.equal(await vault.permanentlyLocked(),true);assert.ok(await vault.positionLiquidity()>0n);assert.equal(await imd.balanceOf(manager.target),0n);assert.equal(await vault.openingTick(),BigInt(plan.openingTick));assert.equal(await nft.controller(),plan.predicted.CreationController);
  fs.writeFileSync('artifacts/local-deployment-rehearsal.json',JSON.stringify({chainId:31337,simulated:true,contracts:10,setupTransactions:plan.transactions.length,openingTick:plan.openingTick,approximateOpeningFdvImd:plan.approximateOpeningFdvImd,initialRealImdReserve:'0',mainnetTransactions:0},null,2));
 }finally{await connection.close();const target=path.resolve(temp);if(!target.startsWith(tempRoot+path.sep))throw new Error('Unsafe temporary cleanup');fs.rmSync(target,{recursive:true,force:true});}
});

test('holder snapshots preserve scores, require cutoff balances and break exact ties by address',async()=>{
 const f=await fixture();try{
  const smaller='0x0000000000000000000000000000000000000011',larger='0x0000000000000000000000000000000000000022';
  await(await f.token.connect(f.alice).transfer(await f.publicWallet.getAddress(),await f.token.balanceOf(await f.alice.getAddress()))).wait();await(await f.token.connect(f.bob).transfer(await f.publicWallet.getAddress(),await f.token.balanceOf(await f.bob.getAddress()))).wait();
  await f.rpc.request({method:'evm_setAutomine',params:[false]});
  const nonce=await f.provider.getTransactionCount(await f.publicWallet.getAddress(),'pending');
  const t1=await f.token.connect(f.publicWallet).transfer(larger,parseEther('100'),{nonce,gasLimit:500000});const t2=await f.token.connect(f.publicWallet).transfer(smaller,parseEther('100'),{nonce:nonce+1,gasLimit:500000});
  await f.rpc.request({method:'evm_mine',params:[]});await f.rpc.request({method:'evm_setAutomine',params:[true]});await t1.wait();await t2.wait();
  await f.rpc.request({method:'evm_increaseTime',params:[100]});await(await f.source.route(f.router.target,parseEther('20'))).wait();
  const cutoff=await f.provider.getBlock('latest');const smallScore=await f.token.scoreAt(smaller,cutoff.number,cutoff.timestamp);const largeScore=await f.token.scoreAt(larger,cutoff.number,cutoff.timestamp);assert.equal(smallScore.score,largeScore.score);
  await ready(f);assert.equal((await f.controller.jobs(1)).winner.toLowerCase(),smaller);
  assert.equal((await f.token.scoreAt(await f.alice.getAddress(),cutoff.number,cutoff.timestamp)).balance,0n);assert.ok((await f.token.scoreAt(await f.alice.getAddress(),cutoff.number,cutoff.timestamp)).score>0n);
 }finally{await f.rpc.request({method:'evm_setAutomine',params:[true]});await f.connection.close();}
});

test('mismatched immutable fee and collection links cannot be sealed into the deployment',async()=>{
 const f=await fixture();try{
  const other=await f.deploy('SwarmCollection',[await f.admin.getAddress()]);const mismatched=await f.deploy('RewardsDistributor',[f.imd.target,other.target]);
  await assert.rejects(other.configure(f.controller.target,mismatched.target));await assert.rejects(f.deploy('FeeRouter',[await f.admin.getAddress(),f.imd.target,f.controller.target,mismatched.target,await f.admin.getAddress()]));
 }finally{await f.connection.close();}
});
