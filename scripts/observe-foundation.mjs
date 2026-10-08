// Read-only public RPC checks; no signing, gas simulation or broadcasting
import fs from 'node:fs';
const config=JSON.parse(fs.readFileSync('deployment.json','utf8'));
const rpc='https://ethereum-rpc.publicnode.com';
const calls=[['eth_chainId',[]],['eth_getTransactionCount',[config.deployer,'pending']],['eth_getBalance',[config.deployer,'latest']],['eth_getCode',[config.poolManager,'latest']],['eth_getCode',[config.imdAddress,'latest']],['eth_call',[{to:config.imdAddress,data:'0x313ce567'},'latest']]];
const response=await fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(calls.map(([method,params],i)=>({jsonrpc:'2.0',id:i+1,method,params}))),signal:AbortSignal.timeout(20000)});
if(!response.ok)throw new Error('RPC observation failed');const results=await response.json();
const get=id=>{const result=results.find(r=>r.id===id);if(result?.error||!result?.result)throw new Error('Incomplete RPC observation');return result.result;};
if(BigInt(get(1))!==1n||get(4)==='0x'||get(5)==='0x'||BigInt(get(6))!==18n)throw new Error('External chain/token assumptions failed');
const now=new Date().toISOString();fs.writeFileSync('artifacts/mainnet-foundation-observation.json',JSON.stringify({observedAtUtc:now,rpc,imdDecimals:18,imdDecimalsVerifiedAtUtc:now,results},null,2));
console.log(JSON.stringify({status:'read_only_verified',chainId:1,imdDecimals:18,pendingNonce:Number(BigInt(get(2))),observedAtUtc:now}));
