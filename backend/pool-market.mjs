import {Contract,formatUnits,parseUnits,keccak256,AbiCoder} from 'ethers';
export function poolPrice(sqrt,imdFirst){
 if(sqrt<=0n||sqrt>=2n**160n)throw Error('Uninitialized pool');
 const square=sqrt*sqrt,unit=10n**18n,q=2n**192n;
 return formatUnits(imdFirst?q*unit/square:square*unit/q,18);
}
export async function poolMarket({config,provider,db,block}){
 if(config.launchRoute!=='manual_v4'||!config.poolManager||!/^0x[0-9a-fA-F]{64}$/.test(config.poolId||'')||!config.poolSeedBlock||block.number<config.poolSeedBlock)throw Error('Pool unavailable');
 const slot=keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256'],[config.poolId,6]));
 const raw=await provider.getStorage(config.poolManager,slot,block.number),sqrt=BigInt(raw)&(2n**160n-1n);
 const priceImd=poolPrice(sqrt,BigInt(config.imdAddress)<BigInt(config.tokenAddress));
 const token=new Contract(config.tokenAddress,['function totalSupply() view returns(uint256)'],provider);
 const imd=new Contract(config.imdAddress,['function balanceOf(address) view returns(uint256)'],provider);
 const hook=new Contract(config.hookAddress,['function pendingCreation() view returns(uint256)'],provider);
 const [supply,balance,pending]=await Promise.all([token.totalSupply({blockTag:block.number}),imd.balanceOf(config.controllerAddress,{blockTag:block.number}),hook.pendingCreation({blockTag:block.number})]);
 let totalVolumeImd=null;
 const state=(await db.query('SELECT * FROM chain_state WHERE chain_id=$1',[config.chainId])).rows[0];
 if(state?.token_address===config.tokenAddress.toLowerCase()&&state.fee_hook_address===config.hookAddress.toLowerCase()&&Number(state.fee_index_start)<=config.poolSeedBlock&&Number(state.next_block)>block.number){
  const volume=(await db.query("SELECT COALESCE(SUM((data->>'grossImd')::numeric),0)::text volume FROM chain_events WHERE chain_id=$1 AND kind='FeesAccrued' AND block_number>=$2 AND block_number<=$3",[config.chainId,config.poolSeedBlock,block.number])).rows[0].volume;
  totalVolumeImd=formatUnits(BigInt(volume),18);
 }
 return {chainId:config.chainId,tokenAddress:config.tokenAddress,priceUsd:null,marketCapUsd:null,totalVolumeUsd:null,priceImd,marketCapImd:formatUnits(supply*parseUnits(priceImd,18)/10n**18n,18),totalVolumeImd,creationPoolImd:formatUnits(balance+pending,18),partial:true,updatedAt:block.observedAt,blockNumber:block.number};
}
