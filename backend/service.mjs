import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import Fastify from 'fastify';
import {isAddress} from 'ethers';
import {database} from './db.mjs';

export function serviceState(env=process.env) {
  const role=env.SERVICE_ROLE||'api';
  if(!['api','worker','indexer'].includes(role))throw new Error('INVALID_SERVICE_ROLE');
  if(role==='api')return {role,status:'starting'};
  if(role==='worker'&&env.LIVE_TRANSACTIONS!=='true')return {role,status:'transactions_disabled'};
  const publicReady=Boolean(env.DATABASE_URL&&env.ETH_RPC_URL&&['TOKEN_ADDRESS','COLLECTION_ADDRESS','CONTROLLER_ADDRESS'].every(k=>isAddress(env[k]||'')));
  const workerReady=role!=='worker'||['OPERATOR_PRIVATE_KEY','IMD_PAID_TOKEN','IMD_ART_SKILL','IMD_PAY_TO','IMD_PAYMENT_SPENDER','PERMIT2_ADDRESS','OUTBOX_ENCRYPTION_KEY','FINALITY_ATTESTATION_URL','ARTIFACT_ATTESTATION_URL','ATTESTOR_SERVICE_TOKEN','HOOK_ADDRESS'].every(k=>Boolean(env[k]));
  return {role,status:publicReady&&workerReady?'starting':'waiting_configuration'};
}

async function main() {
  const state=serviceState();let child=null,stopping=false,app=null;
  const launch=file=>spawn(process.execPath,[fileURLToPath(new URL(file,import.meta.url))],{stdio:'inherit',env:process.env});
  const stop=async()=>{if(stopping)return;stopping=true;child?.kill('SIGTERM');await app?.close();if(!child)process.exit(0);setTimeout(()=>process.exit(0),12000).unref();};
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,stop);
  if(state.role==='api') {
    child=launch('./migrate.mjs');const code=await new Promise(resolve=>child.once('exit',resolve));
    if(code!==0)throw new Error('DATABASE_MIGRATION_FAILED');if(stopping)return;
  } else {
    app=Fastify({logger:false});app.get('/health',async()=>({...state,signingEnabled:state.role==='worker'&&state.status==='running'}));
    await app.listen({host:process.env.HOST||'0.0.0.0',port:Number(process.env.PORT||4190)});
    if(state.status!=='starting') {
      console.log(`${state.role}: ${state.status}`);
      if(process.env.DATABASE_URL){const db=database(process.env.DATABASE_URL);try{await db.query('INSERT INTO service_state(name,status) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET status=$2,observed_at=NOW(),error_code=NULL',[state.role,state.status]);}catch{console.log('Runtime status awaits API database migration');}finally{await db.close();}}
      return;
    }
  }
  child=launch(`./${state.role==='api'?'server':state.role}.mjs`);state.status='running';
  child.once('exit',async code=>{state.status=stopping?'stopped':'halted';await app?.close();process.exit(stopping?0:code||1);});
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Service startup failed Check configuration and database readiness');process.exit(1);});
