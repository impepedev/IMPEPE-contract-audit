import {isAddress} from 'ethers';
const address = value => value && isAddress(value.toLowerCase()) ? value.toLowerCase() : null;
export function loadConfig(env=process.env) {
 const bounded=(key,fallback)=>{const value=Number(env[key]??fallback);if(!Number.isSafeInteger(value)||value<0)throw new Error(`Invalid ${key}`);return value;};
 const chainId=bounded('CHAIN_ID',1);if(![1,11155111,31337].includes(chainId))throw new Error('Unsupported chain');
 const origin=env.PUBLIC_ORIGIN||'http://127.0.0.1:4180';const url=new URL(origin);if(!['http:','https:'].includes(url.protocol))throw new Error('Invalid public origin');
 return {artSkill:env.IMD_ART_SKILL,supabaseUrl:env.SUPABASE_URL||null,supabaseKey:env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY||null,airdropSessionSecret:env.AIRDROP_SESSION_SECRET||null,chainId,databaseUrl:env.DATABASE_URL,rpcUrl:env.ETH_RPC_URL,tokenAddress:address(env.TOKEN_ADDRESS),collectionAddress:address(env.COLLECTION_ADDRESS),controllerAddress:address(env.CONTROLLER_ADDRESS),controllerHistory:(env.CONTROLLER_HISTORY||'').split(',').map(address).filter(Boolean),hookAddress:address(env.HOOK_ADDRESS),imdAddress:address(env.IMD_ADDRESS),quoterAddress:address(env.QUOTER_ADDRESS),startBlock:bounded('SCORING_START_BLOCK',0),port:bounded('PORT',4190),origin,apiOrigin:env.PUBLIC_API_ORIGIN||'http://127.0.0.1:4190',marketUrl:env.MARKET_DATA_URL||null,imdApi:'https://api.imd.fun',imdPaidToken:env.IMD_PAID_TOKEN||null,excluded:(env.EXCLUDED_ADDRESSES||'').split(',').map(address).filter(Boolean),liveTransactions:env.LIVE_TRANSACTIONS==='true'};
}
