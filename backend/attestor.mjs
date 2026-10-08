import {pathToFileURL} from 'node:url';
import Fastify from 'fastify';
import {timingSafeEqual} from 'node:crypto';
import {Contract,JsonRpcProvider,Wallet,keccak256,toUtf8Bytes,isAddress} from 'ethers';
import {expectedCreationInput} from './creation-input.mjs';
import {acceptedArtwork} from './evidence.mjs';
import {IMDClient} from './imd.mjs';
const types={Artifact:[{name:'tokenId',type:'uint256'},{name:'requestId',type:'bytes32'},{name:'artifactHash',type:'bytes32'},{name:'controller',type:'address'},{name:'expiresAt',type:'uint256'}],Finalized:[{name:'blockNumber',type:'uint256'},{name:'blockHash',type:'bytes32'},{name:'controller',type:'address'},{name:'expiresAt',type:'uint256'}]};
export async function signingContext({provider,signer,config}){
 if(Number((await provider.getNetwork()).chainId)!==config.chainId)throw new Error('WRONG_CHAIN');
 const collection=new Contract(config.collectionAddress,['function controller() view returns(address)','function usedArtifact(bytes32) view returns(bool)'],provider);
 if((await collection.controller()).toLowerCase()!==config.controllerAddress.toLowerCase())throw new Error('CONTROLLER_MIGRATED');
 const controller=new Contract(config.controllerAddress,['function nextJobId() view returns(uint256)','function paused() view returns(bool)','function retired() view returns(bool)','function operator() view returns(address)','function recoveryRecipient() view returns(address)','function collection() view returns(address)','function token() view returns(address)','function baseHash() view returns(bytes32)','function verifier() view returns(address)','function attempts(uint256) view returns(uint256)','function jobs(uint256) view returns(uint64 cutoff,uint64 time,uint256 cursor,uint256 count,address winner,uint256 bestScore,bytes32 requestId,bool selected,bool paid,bool finalized)'],provider);
 if(await controller.paused()||await controller.retired()||(await controller.collection()).toLowerCase()!==config.collectionAddress.toLowerCase()||(await controller.token()).toLowerCase()!==config.tokenAddress.toLowerCase())throw new Error('CREATION_INACTIVE');
 const verifier=new Contract(await controller.verifier(),['function attestor() view returns(address)'],provider),attestor=(await signer.getAddress()).toLowerCase(),operator=await controller.operator();
 if((await verifier.attestor()).toLowerCase()!==attestor||operator.toLowerCase()===attestor||(await controller.recoveryRecipient()).toLowerCase()===attestor)throw new Error('INDEPENDENT_SIGNER_MISMATCH');
 const latest=await provider.getBlock('latest');return {controller,collection,operator,domain:{name:'IMPEPE Artifact',version:'1',chainId:config.chainId,verifyingContract:verifier.target},expiresAt:latest.timestamp+900};
}
export async function attestArtwork({provider,signer,config,imd,tokenId,attempt,imdJobId}){
 const ctx=await signingContext({provider,signer,config});if(Number(await ctx.controller.nextJobId())!==tokenId||Number(await ctx.controller.attempts(tokenId))!==attempt)throw new Error('STALE_ART_ATTEMPT');
 const job=await ctx.controller.jobs(tokenId),requestId=keccak256(toUtf8Bytes(imdJobId));if(!job.selected||!job.paid||!job.finalized||job.requestId!==requestId)throw new Error('BOUND_PAID_JOB_REQUIRED');
 const art=await acceptedArtwork({imd,imdJobId,tokenId,baseHash:(await ctx.controller.baseHash()).slice(2),payer:ctx.operator,expectedInput:await expectedCreationInput(provider,config.collectionAddress,tokenId,config.artSkill)});
 if(await ctx.collection.usedArtifact(`0x${art.artifactHash}`))throw new Error('DUPLICATE_ART');
 const message={tokenId,requestId,artifactHash:art.commitmentHash,controller:config.controllerAddress,expiresAt:ctx.expiresAt};const signature=await signer.signTypedData(ctx.domain,{Artifact:types.Artifact},message);
 return {tokenId,attempt,imdJobId,controller:config.controllerAddress,verifier:ctx.domain.verifyingContract,artifactHash:art.artifactHash,commitmentHash:art.commitmentHash,durationMs:art.manifest.durationMs,effect:art.manifest.effect,manifest:art.manifest,provenance:art.provenance,expiresAt:ctx.expiresAt,attestorSignature:signature};
}
export async function attestFinality({provider,signer,config,cutoff}){
 const ctx=await signingContext({provider,signer,config});const id=await ctx.controller.nextJobId(),job=await ctx.controller.jobs(id);if(String(job.cutoff)!==String(cutoff)||job.finalized||cutoff<=0)throw new Error('CURRENT_CUTOFF_REQUIRED');
 const final=await provider.send('eth_getBlockByNumber',['finalized',false]);if(!final||BigInt(final.number)<BigInt(cutoff))throw new Error('NOT_FINALIZED');const block=await provider.getBlock(cutoff);if(!block?.hash)throw new Error('BLOCK_UNAVAILABLE');
 const signature=await signer.signTypedData(ctx.domain,{Finalized:types.Finalized},{blockNumber:cutoff,blockHash:block.hash,controller:config.controllerAddress,expiresAt:ctx.expiresAt});return {cutoff,blockHash:block.hash,expiresAt:ctx.expiresAt,signature};
}
export function buildAttestor({provider,signer,config,imd=new IMDClient({}),serviceToken}){
 const app=Fastify({logger:false,bodyLimit:2048});const ready=Boolean(config.signingEnabled&&provider&&signer&&serviceToken?.length>=32&&[config.controllerAddress,config.collectionAddress,config.tokenAddress].every(isAddress));
 app.get('/health',async()=>({status:ready?'configured':'unavailable',signingEnabled:ready}));
 app.addHook('preHandler',async(request,reply)=>{if(request.url==='/health')return;if(!ready)return reply.code(503).send({error:'ATTESTOR_NOT_CONFIGURED'});const supplied=Buffer.from(request.headers.authorization||''),expected=Buffer.from(`Bearer ${serviceToken}`);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return reply.code(401).send({error:'UNAUTHORIZED'});});
 app.post('/artifact',async(request,reply)=>{try{const {tokenId,attempt,imdJobId}=request.body||{};if(!Number.isInteger(tokenId)||!Number.isInteger(attempt)||attempt<0||typeof imdJobId!=='string'||imdJobId.length!==36)throw new Error('INVALID_REQUEST');return await attestArtwork({provider,signer,config,imd,tokenId,attempt,imdJobId});}catch{return reply.code(422).send({error:'ART_ATTESTATION_REJECTED'});}});
 app.get('/finality',async(request,reply)=>{try{const cutoff=Number(request.query.cutoff);if(!Number.isSafeInteger(cutoff))throw new Error('INVALID_REQUEST');return await attestFinality({provider,signer,config,cutoff});}catch{return reply.code(422).send({error:'FINALITY_ATTESTATION_REJECTED'});}});
 return app;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 const config={artSkill:process.env.IMD_ART_SKILL,signingEnabled:process.env.ATTESTOR_SIGNING_ENABLED==='true',chainId:Number(process.env.CHAIN_ID||1),controllerAddress:process.env.CONTROLLER_ADDRESS,collectionAddress:process.env.COLLECTION_ADDRESS,tokenAddress:process.env.TOKEN_ADDRESS};const provider=process.env.ETH_RPC_URL?new JsonRpcProvider(process.env.ETH_RPC_URL):null;const signer=process.env.ATTESTOR_PRIVATE_KEY?new Wallet(process.env.ATTESTOR_PRIVATE_KEY,provider):null;
 const app=buildAttestor({provider,signer,config,serviceToken:process.env.ATTESTOR_SERVICE_TOKEN});await app.listen({host:process.env.ATTESTOR_HOST||'127.0.0.1',port:Number(process.env.ATTESTOR_PORT||4192)});console.log('Independent attestor on localhost; configure its separate signer before use');for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{await app.close();provider?.destroy();process.exit(0);});
}
