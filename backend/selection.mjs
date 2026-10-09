import {AbiCoder,Contract,keccak256,ZeroAddress} from 'ethers';
import {rank} from './accounting.mjs';

export const selectionTypes={Selection:[{name:'payloadHash',type:'bytes32'},{name:'controller',type:'address'},{name:'expiresAt',type:'uint256'}]};
export function selectionPayload({token,tokenId,cutoff,blockHash,timestamp,nonce,rulesHash,winner,balance,score}) {
 return keccak256(AbiCoder.defaultAbiCoder().encode(['address','uint256','uint256','bytes32','uint256','uint256','bytes32','address','uint256','uint256'],[token,tokenId,cutoff,blockHash,timestamp,nonce,rulesHash,winner,balance,score]));
}
// Replay immutable finalized events at the cutoff, never use the current holders table for historical ranking.
export function replayBalances(events) {
 const holders=new Map();let lastTime=0;
 for(const event of events){const timestamp=Number(event.timestamp);if(!Number.isSafeInteger(timestamp)||timestamp<lastTime)throw new Error('NONMONOTONIC_REPLAY');lastTime=timestamp;const {from,to,value}=event.data;const amount=BigInt(value);if(amount<0n)throw new Error('NEGATIVE_TRANSFER');
  for(const [raw,delta] of [[from,-amount],[to,amount]]){const address=raw.toLowerCase();if(address===ZeroAddress)continue;const old=holders.get(address)||{balance:0n,score:0n,last_timestamp:timestamp};const balance=old.balance+delta;if(balance<0n)throw new Error('TRANSFER_HISTORY_INCOMPLETE');holders.set(address,{address,balance,score:old.score+old.balance*BigInt(timestamp-old.last_timestamp),last_timestamp:timestamp});}
 }
 return [...holders.values()].map(r=>({...r,balance:r.balance.toString(),score:r.score.toString()}));
}
export async function attestSelection({provider,signer,config,db,ctx}) {
 if(!db)throw new Error('INDEPENDENT_INDEX_DATABASE_REQUIRED');
 const controller=new Contract(config.controllerAddress,[
  'function nextJobId() view returns(uint256)','function jobs(uint256) view returns(uint64 cutoff,uint64 time,uint256 cursor,uint256 count,address winner,uint256 bestScore,bytes32 requestId,bool selected,bool paid,bool finalized)',
  'function selectionNonce() view returns(uint256)','function rulesHash() view returns(bytes32)','function scoringStartBlock() view returns(uint256)','function eligibilitySealed() view returns(bool)','function exclusionList() view returns(address[])','function excluded(address) view returns(bool)','function allocated(address) view returns(bool)','function feeRouter() view returns(address)','function verifier() view returns(address)','function imd() view returns(address)','function cutoffHashes(uint256) view returns(bytes32)'
 ],provider);
 const id=await controller.nextJobId(),job=await controller.jobs(id);if(id>1000n||!job.finalized||job.selected||!await controller.eligibilitySealed())throw new Error('SELECTION_STATE');
 const start=Number(await controller.scoringStartBlock()),cutoff=Number(job.cutoff),block=await provider.getBlock(cutoff),finalized=await provider.send('eth_getBlockByNumber',['finalized',false]);
 if(!block?.hash||!finalized||BigInt(finalized.number)<job.cutoff||block.hash!==await controller.cutoffHashes(id)||BigInt(block.timestamp)!==job.time)throw new Error('FINALIZED_CUTOFF_MISMATCH');
 const state=(await db.query('SELECT * FROM chain_state WHERE chain_id=$1',[config.chainId])).rows[0];
 if(state?.token_address?.toLowerCase()!==config.tokenAddress.toLowerCase()||Number(state.scoring_start_block)!==start||Number(state.next_block)<=cutoff)throw new Error('INDEX_BOUNDARY_MISMATCH');
 const coverage=(await db.query('SELECT count(*)::bigint n,min(number) first,max(number) last FROM chain_blocks WHERE chain_id=$1 AND number BETWEEN $2 AND $3',[config.chainId,start,cutoff])).rows[0];
 const indexed=(await db.query('SELECT hash FROM chain_blocks WHERE chain_id=$1 AND number=$2',[config.chainId,cutoff])).rows[0];
 if(Number(coverage.n)!==cutoff-start+1||Number(coverage.first)!==start||Number(coverage.last)!==cutoff||indexed?.hash!==block.hash)throw new Error('INDEX_COVERAGE_INCOMPLETE');
 const events=(await db.query("SELECT e.data,b.timestamp FROM chain_events e JOIN chain_blocks b ON b.chain_id=e.chain_id AND b.number=e.block_number WHERE e.chain_id=$1 AND e.kind='Transfer' AND e.block_number BETWEEN $2 AND $3 ORDER BY e.block_number,e.log_index",[config.chainId,start,cutoff])).rows;
 const rows=replayBalances(events);if(rows.reduce((sum,r)=>sum+BigInt(r.balance),0n)!==10n**27n)throw new Error('STANDARD_SUPPLY_REPLAY_MISMATCH');
 const blocked=[...await controller.exclusionList(),config.controllerAddress,config.tokenAddress,await controller.imd(),await controller.feeRouter(),config.collectionAddress,await controller.verifier(),await ctx.collection.rewards()];
 const ranked=rank(rows,block.timestamp,blocked);let selected;
 for(const candidate of ranked){if(!await controller.allocated(candidate.address)){selected=candidate;break;}}
 const result={token:config.tokenAddress,tokenId:id.toString(),cutoff:job.cutoff.toString(),blockHash:block.hash,timestamp:job.time.toString(),nonce:(await controller.selectionNonce()).toString(),rulesHash:await controller.rulesHash(),winner:selected?.address||ZeroAddress,balance:selected?.balance||'0',score:selected?.score||'0'};
 const payloadHash=selectionPayload(result);const signature=await signer.signTypedData(ctx.domain,selectionTypes,{payloadHash,controller:config.controllerAddress,expiresAt:ctx.expiresAt});
 return {...result,payloadHash,expiresAt:ctx.expiresAt,signature};
}
