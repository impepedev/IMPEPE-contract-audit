import {Contract,Interface,AbiCoder,verifyTypedData,ZeroAddress,formatEther,formatUnits,keccak256} from 'ethers';
import {signingContext,attestFinality} from './attestor.mjs';
import {replayBalances,selectionPayload,selectionTypes} from './selection.mjs';
import {rank,MINIMUM_HOLDER_BALANCE} from './accounting.mjs';
const abi=['function nextJobId() view returns(uint256)','function totalFunded() view returns(uint256)','function jobBudget() view returns(uint256)','function settlementBlocks() view returns(uint256)','function paused() view returns(bool)','function retired() view returns(bool)','function eligibilitySealed() view returns(bool)','function emptySnapshot(uint256) view returns(bool)','function scoringStartBlock() view returns(uint256)','function selectionNonce() view returns(uint256)','function rulesHash() view returns(bytes32)','function MINIMUM_HOLDER_BALANCE() view returns(uint256)','function cutoffHashes(uint256) view returns(bytes32)','function exclusionList() view returns(address[])','function allocated(address) view returns(bool)','function jobs(uint256) view returns(uint64 cutoff,uint64 time,uint256 cursor,uint256 count,address winner,uint256 bestScore,bytes32 requestId,bool selected,bool paid,bool finalized)','function openNextJob()','function confirmFinality(bytes)','function selectRecipient(address,uint256,uint256,bytes)','function advanceEmptySnapshot()'];
export const creationInterface=new Interface(abi);
export function unsignedSelection(rows,time,excluded,allocated=[]){return rank(rows,time,excluded,allocated)[0]||{address:ZeroAddress,balance:'0',score:'0'};}
export function validateEvidenceSignature(draft,signature,address){if(verifyTypedData(draft.domain,draft.types,draft.message,signature).toLowerCase()!==address.toLowerCase())throw Error('Independent attestor signature required');}
export async function manualStatus(provider,config){
 const c=new Contract(config.controllerAddress,abi,provider);
 const [id,funded,budget,settlement,paused,retired,sealed,latest,finalized,gas]=await Promise.all([c.nextJobId(),c.totalFunded(),c.jobBudget(),c.settlementBlocks(),c.paused(),c.retired(),c.eligibilitySealed(),provider.getBlock('latest'),provider.send('eth_getBlockByNumber',['finalized',false]),provider.getBalance(config.operator)]);
 const job=await c.jobs(id),shortfall=funded<id*budget?id*budget-funded:0n;
 return {tokenId:Number(id),fundedImd:formatUnits(funded,18),budgetImd:formatUnits(budget,18),shortfallImd:formatUnits(shortfall,18),operatorEth:formatEther(gas),paused,retired,sealed,cutoff:Number(job.cutoff),winner:job.winner,selected:job.selected,paid:job.paid,finalityConfirmed:job.finalized,emptySnapshot:await c.emptySnapshot(id),finalizedBlock:Number(BigInt(finalized.number)),latestBlock:latest.number,settlementBlocks:Number(settlement),canOpen:!paused&&!retired&&sealed&&id<=1000n&&!job.cutoff&&!shortfall,canFinalize:!paused&&!retired&&job.cutoff>0n&&!job.finalized&&BigInt(finalized.number)>=job.cutoff&&BigInt(latest.number)>job.cutoff+settlement,canSelect:!paused&&!retired&&job.finalized&&!job.selected&&!await c.emptySnapshot(id)};
}
export async function manualDraft(provider,config,kind){
 let captured;const signer={getAddress:async()=>config.artifactAttestor,signTypedData:async(domain,types,message)=>{captured={domain,types,message};return '0x';}};
 const ctx=await signingContext({provider,signer,config}),c=new Contract(config.controllerAddress,abi,provider),id=await c.nextJobId(),job=await c.jobs(id);
 if(kind==='finality'){await attestFinality({provider,signer,config,cutoff:Number(job.cutoff)});return {kind,tokenId:id.toString(),cutoff:job.cutoff.toString(),...captured};}
 if(kind!=='selection'||!job.finalized||job.selected||await c.emptySnapshot(id)||!await c.eligibilitySealed())throw Error('Selection is not ready');
 const start=Number(await c.scoringStartBlock()),cutoff=Number(job.cutoff),block=await provider.getBlock(cutoff),final=await provider.send('eth_getBlockByNumber',['finalized',false]);
 if(cutoff<start||cutoff-start>100000||BigInt(final.number)<job.cutoff||block.hash!==await c.cutoffHashes(id)||BigInt(block.timestamp)!==job.time||await c.MINIMUM_HOLDER_BALANCE()!==MINIMUM_HOLDER_BALANCE)throw Error('Historical cutoff or eligibility mismatch');
 const transfer=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);const events=[];const timestamps=new Map();
 // Complete range requests fail closed on RPC errors; this trusts the approved Ethereum RPC, not a native ranking proof.
 for(let from=start;from<=cutoff;from+=500){const logs=await provider.getLogs({address:config.tokenAddress,topics:[transfer.getEvent('Transfer').topicHash],fromBlock:from,toBlock:Math.min(cutoff,from+499)});for(const log of logs){if(log.removed||log.blockNumber<from||log.blockNumber>Math.min(cutoff,from+499))throw Error('Unexpected transfer log');if(!timestamps.has(log.blockNumber)){const b=await provider.getBlock(log.blockNumber);if(b.hash!==log.blockHash)throw Error('Transfer block mismatch');timestamps.set(log.blockNumber,b.timestamp);}const e=transfer.parseLog(log);events.push({blockNumber:log.blockNumber,logIndex:log.index,timestamp:timestamps.get(log.blockNumber),data:{from:e.args.from,to:e.args.to,value:e.args.value.toString()}});}}
 events.sort((a,b)=>a.blockNumber-b.blockNumber||a.logIndex-b.logIndex);const rows=replayBalances(events);
 const token=new Contract(config.tokenAddress,['function totalSupply() view returns(uint256)'],provider);
 if(rows.reduce((sum,r)=>sum+BigInt(r.balance),0n)!==10n**27n||await token.totalSupply({blockTag:cutoff})!==10n**27n)throw Error('Incomplete supply replay');
 const blocked=[...await c.exclusionList(),config.controllerAddress,config.tokenAddress,config.imdAddress,config.feeRouterAddress,config.collectionAddress,config.receiptVerifierAddress,config.rewardsAddress];const allocated=[];
 for(const row of rank(rows,block.timestamp,blocked)){if(await c.allocated(row.address))allocated.push(row.address);else break;}
 const winner=unsignedSelection(rows,block.timestamp,blocked,allocated);
 const evidence={token:config.tokenAddress,tokenId:id.toString(),cutoff:job.cutoff.toString(),blockHash:block.hash,timestamp:job.time.toString(),nonce:(await c.selectionNonce()).toString(),rulesHash:await c.rulesHash(),winner:winner.address,balance:winner.balance,score:winner.score};
 if((await provider.getBlock(cutoff)).hash!==block.hash)throw Error('Cutoff changed');
 return {kind,tokenId:id.toString(),cutoff:job.cutoff.toString(),evidence,domain:ctx.domain,types:selectionTypes,message:{payloadHash:selectionPayload(evidence),controller:config.controllerAddress,expiresAt:ctx.expiresAt},replayedTransfers:events.length};
}
export function draftTransaction(config,draft,signature){validateEvidenceSignature(draft,signature,config.artifactAttestor);const coder=AbiCoder.defaultAbiCoder();let data;
 if(draft.kind==='finality')data=creationInterface.encodeFunctionData('confirmFinality',[coder.encode(['bytes32','uint256','bytes'],[draft.message.blockHash,draft.message.expiresAt,signature])]);
 else if(draft.kind==='selection')data=creationInterface.encodeFunctionData('selectRecipient',[draft.evidence.winner,draft.evidence.balance,draft.evidence.score,coder.encode(['uint256','bytes'],[draft.message.expiresAt,signature])]);
 else throw Error('Unknown evidence kind');return {from:config.operator,to:config.controllerAddress,data,value:'0x0',chainId:'0x1'};
}
export async function verifyManualDependencies(provider,config,records){if(Number((await provider.getNetwork()).chainId)!==1)throw Error('Ethereum mainnet required');for(const [key,record] of records){if(record.contractAddress.toLowerCase()!==config[key].toLowerCase()||keccak256(await provider.getCode(config[key]))!==record.runtimeCodeHash)throw Error('Deployed dependency mismatch '+key);}}
