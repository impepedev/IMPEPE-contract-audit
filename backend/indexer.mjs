import {pathToFileURL} from 'node:url';
import {JsonRpcProvider,Interface,Contract} from 'ethers';import {randomUUID} from 'node:crypto';
import {database} from './db.mjs';import {loadConfig} from './config.mjs';import {applyTransfer} from './accounting.mjs';
const erc20=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const creation=new Interface(['event RecipientSelected(uint256 indexed id,address indexed winner,uint256 score)','event JobOpened(uint256 indexed id,uint256 cutoff,uint256 time)','event WorkRequested(uint256 indexed id,bytes32 requestId)','event JobMinted(uint256 indexed id,bytes32 requestId,bytes32 artifactHash)']);
export async function indexBatch(db,provider,config,{maxBlocks=20,owner=randomUUID()}={}) {
 if(!config.tokenAddress||!config.rpcUrl)throw new Error('INDEXER_CONFIG_REQUIRED');
 if(!config.startBlock)config={...config,startBlock:Number(await new Contract(config.tokenAddress,['function scoringStartBlock() view returns(uint256)'],provider).scoringStartBlock())};
 const chain=await provider.getNetwork();if(Number(chain.chainId)!==config.chainId)throw new Error('Wrong RPC chain');
 const controllerAddresses=[...new Set([...(config.controllerHistory||[]),...(config.controllerAddress?[config.controllerAddress]:[])].map(a=>a.toLowerCase()))];
 const tip=await provider.send('eth_getBlockByNumber',['finalized',false]);if(!tip)throw new Error('Finalized block unavailable');const finalized=Number(BigInt(tip.number));
 const lease=await db.query("INSERT INTO service_leases(name,owner,expires_at) VALUES('indexer',$1,NOW()+INTERVAL '60 seconds') ON CONFLICT(name) DO UPDATE SET owner=EXCLUDED.owner,expires_at=EXCLUDED.expires_at WHERE service_leases.expires_at<NOW() OR service_leases.owner=$1 RETURNING name",[owner]);
 if(!lease.rows.length)return {busy:true};
 try {
  await db.query('INSERT INTO chain_state(chain_id,next_block) VALUES($1,$2) ON CONFLICT DO NOTHING',[config.chainId,config.startBlock]);
  const {rows}=await db.query('SELECT * FROM chain_state WHERE chain_id=$1',[config.chainId]);let {next_block:next,last_hash:last}=rows[0];next=Number(next);
  if(next>config.startBlock){const prior=await provider.send('eth_getBlockByNumber',[`0x${(next-1).toString(16)}`,false]);if(!prior||prior.hash!==last)throw new Error('FINALIZED_HISTORY_MISMATCH: halt and rebuild from deployment');}
  let indexed=0;
  for(;next<=finalized&&indexed<maxBlocks;next++,indexed++) {
   const block=await provider.send('eth_getBlockByNumber',[`0x${next.toString(16)}`,false]);if(!block||(last&&block.parentHash!==last))throw new Error('Parent mismatch');
   const timestamp=Number(BigInt(block.timestamp));const logs=await provider.getLogs({blockHash:block.hash,address:[config.tokenAddress,...controllerAddresses]});logs.sort((a,b)=>a.index-b.index);
   await db.transaction(async tx=>{
    await tx.query('INSERT INTO chain_blocks(chain_id,number,hash,parent_hash,timestamp) VALUES($1,$2,$3,$4,$5)',[config.chainId,next,block.hash,block.parentHash,timestamp]);
    for(const log of logs) {
     let event;try{event=(log.address.toLowerCase()===config.tokenAddress.toLowerCase()?erc20:creation).parseLog(log);}catch{continue;}if(!event)continue;
     const data=Object.fromEntries(event.fragment.inputs.map((input,i)=>[input.name,typeof event.args[i]==='bigint'?event.args[i].toString():event.args[i]]));
     await tx.query('INSERT INTO chain_events(chain_id,block_number,tx_hash,log_index,kind,data) VALUES($1,$2,$3,$4,$5,$6)',[config.chainId,next,log.transactionHash,log.index,event.name,JSON.stringify(data)]);
     if(event.name==='Transfer')await applyTransfer(tx,{chainId:config.chainId,from:data.from,to:data.to,value:data.value,timestamp,blockNumber:next});
     if(event.name==='RecipientSelected'){const opened=await tx.query("SELECT data FROM chain_events WHERE chain_id=$1 AND kind='JobOpened' AND data->>'id'=$2 ORDER BY block_number DESC LIMIT 1",[config.chainId,data.id]);if(!opened.rows[0])throw new Error('Missing job cutoff');await tx.query('INSERT INTO allocations(chain_id,token_id,recipient,cutoff) VALUES($1,$2,$3,$4)',[config.chainId,data.id,data.winner.toLowerCase(),opened.rows[0].data.cutoff]);}
    }
    await tx.query('UPDATE chain_state SET next_block=$2,last_hash=$3,observed_at=NOW() WHERE chain_id=$1',[config.chainId,next+1,block.hash]);
   });last=block.hash;
  }
  return {indexed,finalized,nextBlock:next};
 }finally{await db.query("DELETE FROM service_leases WHERE name='indexer' AND owner=$1",[owner]);}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){const config=loadConfig();const db=database(config.databaseUrl);const provider=new JsonRpcProvider(config.rpcUrl);let stopped=false;process.on('SIGINT',()=>stopped=true);while(!stopped){try{console.log(await indexBatch(db,provider,config));}catch(error){console.error(error.message);}await new Promise(resolve=>setTimeout(resolve,10000));}await db.close();provider.destroy();}
