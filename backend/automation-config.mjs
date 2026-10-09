import {Wallet,isAddress} from 'ethers';
const workerKeys=['DATABASE_URL','ETH_RPC_URL','TOKEN_ADDRESS','COLLECTION_ADDRESS','CONTROLLER_ADDRESS','HOOK_ADDRESS','OPERATOR_PRIVATE_KEY','OPERATOR_ADDRESS','ATTESTOR_ADDRESS','DEPLOYER_ADDRESS','IMD_PAID_TOKEN','IMD_ART_SKILL','IMD_PAY_TO','IMD_PAYMENT_SPENDER','PERMIT2_ADDRESS','OUTBOX_ENCRYPTION_KEY','FINALITY_ATTESTATION_URL','SELECTION_ATTESTATION_URL','ARTIFACT_ATTESTATION_URL','ATTESTOR_SERVICE_TOKEN'];
const attestorKeys=['ATTESTOR_DATABASE_URL','ETH_RPC_URL','TOKEN_ADDRESS','COLLECTION_ADDRESS','CONTROLLER_ADDRESS','ATTESTOR_PRIVATE_KEY','ATTESTOR_ADDRESS','OPERATOR_ADDRESS','DEPLOYER_ADDRESS','IMD_ART_SKILL','ATTESTOR_SERVICE_TOKEN'];
export function automationReadiness(env,role){
 if(!['worker','attestor'].includes(role))throw Error('Invalid signing role');
 const missing=(role==='worker'?workerKeys:attestorKeys).filter(k=>!env[k]);const errors=[];const keyName=role==='worker'?'OPERATOR_PRIVATE_KEY':'ATTESTOR_PRIVATE_KEY',expected=role==='worker'?'OPERATOR_ADDRESS':'ATTESTOR_ADDRESS';
 if(env[role==='worker'?'ATTESTOR_PRIVATE_KEY':'OPERATOR_PRIVATE_KEY'])errors.push('Other signer key must not be present');
 let signerAddress=null;if(env[keyName]){try{if(!/^0x[0-9a-fA-F]{64}$/.test(env[keyName]))throw Error();signerAddress=new Wallet(env[keyName]).address;if(!isAddress(env[expected]||'')||signerAddress.toLowerCase()!==env[expected].toLowerCase())errors.push('Signing key does not match approved address');}catch{errors.push('Invalid signing key');}}
 const names=['OPERATOR_ADDRESS','ATTESTOR_ADDRESS','DEPLOYER_ADDRESS'];const addresses=names.map(k=>env[k]?.toLowerCase());for(const k of names)if(env[k]&&!isAddress(env[k]))errors.push('Invalid '+k);if(addresses.every(Boolean)&&new Set(addresses).size!==3)errors.push('Operator attestor and deployer must be distinct');
 if(env.ATTESTOR_SERVICE_TOKEN&&env.ATTESTOR_SERVICE_TOKEN.length<32)errors.push('Service token too short');
 if(role==='worker'){
  for(const k of ['OUTBOX_ENCRYPTION_KEY','IMD_PAID_TOKEN'])if(env[k]&&!/^[0-9a-f]{64}$/.test(env[k]))errors.push('Invalid '+k);
  for(const k of ['IMD_PAY_TO','IMD_PAYMENT_SPENDER','PERMIT2_ADDRESS'])if(env[k]&&!isAddress(env[k]))errors.push('Invalid '+k);
  for(const k of ['FINALITY_ATTESTATION_URL','SELECTION_ATTESTATION_URL','ARTIFACT_ATTESTATION_URL'])if(env[k]){try{const u=new URL(env[k]);if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&/^(127\.0\.0\.1|localhost|[a-z0-9-]+\.railway\.internal)$/.test(u.hostname)))throw Error();}catch{errors.push('Unsafe '+k);}}
 }
 return {role,ready:!missing.length&&!errors.length,signerAddress,missing,errors};
}
