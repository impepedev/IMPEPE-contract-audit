import fs from 'node:fs';
import {Contract,JsonRpcProvider,AbiCoder,isAddress} from 'ethers';
// Review-only calldata preparation. This script has no wallet/key and cannot broadcast.
const evidence=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const config=JSON.parse(fs.readFileSync(process.argv[3]||'deployment.json','utf8'));
if(!process.env.ETHEREUM_RPC_URL||!isAddress(evidence.controller)||!isAddress(evidence.refundPayer))throw new Error('RPC, deployed controller and refund payer required');
const provider=new JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
try{
 if(Number((await provider.getNetwork()).chainId)!==config.chainId)throw new Error('Wrong chain');
 const controller=new Contract(evidence.controller,['function nextJobId() view returns(uint256)','function attempts(uint256) view returns(uint256)','function jobBudget() view returns(uint256)','function paymentRecipient() view returns(address)','function imd() view returns(address)','function verifier() view returns(address)','function jobs(uint256) view returns(uint64 cutoff,uint64 time,uint256 cursor,uint256 count,address winner,uint256 bestScore,bytes32 requestId,bool selected,bool paid,bool finalized)','function recoverJob(bytes)'],provider);
 const id=await controller.nextJobId(),job=await controller.jobs(id),attempt=await controller.attempts(id),amount=await controller.jobBudget(),recipient=await controller.paymentRecipient();
 if(String(id)!==String(evidence.tokenId)||String(attempt)!==String(evidence.attempt)||job.requestId!==evidence.requestId||!job.selected||!job.paid)throw new Error('Stale or unpaid recovery');
 const proof=AbiCoder.defaultAbiCoder().encode(['uint256','bytes'],[evidence.expiresAt,evidence.signature]);
 const verifier=new Contract(await controller.verifier(),['function verifyRecovery(uint256,bytes32,uint256,uint256,address,bytes) view returns(bool)'],provider);
 if(!await verifier.verifyRecovery(id,job.requestId,attempt,amount,recipient,proof,{from:evidence.controller}))throw new Error('Recovery attestation rejected');
 const imd=new Contract(await controller.imd(),['function approve(address,uint256) returns(bool)'],provider);
 console.log(JSON.stringify({status:'unsigned_review_only',refundPayer:evidence.refundPayer,tokenId:String(id),attempt:String(attempt),recipient:job.winner,refundAmount:String(amount),transactions:[{to:imd.target,data:imd.interface.encodeFunctionData('approve',[controller.target,amount])},{to:controller.target,data:controller.interface.encodeFunctionData('recoverJob',[proof])}]},null,2));
}finally{provider.destroy();}
