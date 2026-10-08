import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';

export const socialTasks=[
 {id:'follow',title:'Follow IMPEPE on X',description:'Follow @impepefun for updates from the swarm',url:'https://x.com/impepefun',action:'FOLLOW ON X'},
 {id:'like',title:'Like the highlighted post',description:'Open our highlights and like the highlighted post',url:'https://x.com/impepefun/highlights',action:'OPEN HIGHLIGHTS'},
 {id:'repost',title:'Repost the highlighted post',description:'Share the highlighted post with your timeline',url:'https://x.com/impepefun/highlights',action:'OPEN HIGHLIGHTS'}
];
export function normalizeEntry(body){
 if(!body||typeof body.xHandle!=='string'||typeof body.walletAddress!=='string')throw new Error('invalid_entry');
 const xHandle=body.xHandle.trim().replace(/^@/,'').toLowerCase(),walletAddress=body.walletAddress.trim().toLowerCase();
 if(!/^[a-z0-9_]{1,15}$/.test(xHandle)||!/^0x[0-9a-f]{40}$/.test(walletAddress)||/^0x0{40}$/.test(walletAddress))throw new Error('invalid_entry');
 return {x_handle:xHandle,wallet_address:walletAddress};
}
export function supabaseStore({url,key,fetcher=fetch}){
 const base=new URL(url);if(base.protocol!=='https:'||base.username||base.password)throw new Error('Invalid Supabase URL');
 const endpoint=new URL('/rest/v1/airdrop_submissions',base);
 async function request(target,options={}){
  const response=await fetcher(target,{...options,signal:AbortSignal.timeout(8000),headers:{apikey:key,...(!key.startsWith('sb_secret_')?{Authorization:`Bearer ${key}`}:{ }),'Content-Type':'application/json',...options.headers}});
  if(!response.ok){let data;try{data=await response.json();}catch{}const error=new Error(data?.code==='23505'?'duplicate':'storage_unavailable');throw error;}
  const text=await response.text();return text?JSON.parse(text):null;
 }
 return {
  async find(visitorHash){const target=new URL(endpoint);target.searchParams.set('visitor_hash',`eq.${visitorHash}`);target.searchParams.set('select','id');target.searchParams.set('limit','1');return (await request(target))[0]||null;},
  async insert(row){await request(endpoint,{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});}
 };
}
export function localAirdropStore(db){return{
 async find(hash){return(await db.query('SELECT id FROM airdrop_submissions WHERE visitor_hash=$1 LIMIT 1',[hash])).rows[0]||null;},
 async insert(row){try{await db.query('INSERT INTO airdrop_submissions(id,visitor_hash,x_handle,wallet_address,tasks_completed) VALUES($1,$2,$3,$4,$5)',[row.id,row.visitor_hash,row.x_handle,row.wallet_address,JSON.stringify(row.tasks_completed)]);}catch(error){if(error.code==='23505')throw new Error('duplicate');throw error;}}
};}
export function registerAirdrop(app,{origin,secret,store}){
 const enabled=secret?.length>=32&&store;const rates=new Map();
 const hash=value=>createHmac('sha256',secret).update(value).digest('hex');
 const cookieName='impepe_airdrop';
 function read(request){
  try{const token=request.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);if(!token)return null;
   const [payload,signature]=token.split('.');const expected=hash(payload);if(signature?.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return null;
   const state=JSON.parse(Buffer.from(payload,'base64url'));if(!/^[0-9a-f-]{36}$/.test(state.id)||!Number.isInteger(state.step)||state.step<0||state.step>3||typeof state.opened!=='boolean'||state.expires<Date.now())return null;return state;
  }catch{return null;}
 }
 function write(reply,state){const payload=Buffer.from(JSON.stringify(state)).toString('base64url');reply.header('Set-Cookie',`${cookieName}=${payload}.${hash(payload)}; HttpOnly; SameSite=Strict; Path=/api/airdrop; Max-Age=31536000${origin.startsWith('https:')?'; Secure':''}`);}
 function publicState(state,submitted=false){return {step:state.step,opened:state.opened,submitted,tasks:socialTasks};}
 async function gate(request,reply){
  reply.header('Cache-Control','no-store');if(!enabled)return reply.code(503).send({error:'unavailable'});
  if(request.method==='POST'&&request.headers.origin!==origin)return reply.code(403).send({error:'invalid_origin'});
  const now=Date.now(),key=hash(request.ip);for(const [key,value] of rates)if(value.until<now)rates.delete(key);
  if(rates.size>5000)return reply.code(429).send({error:'rate_limited'});
  const rate=rates.get(key)||{count:0,until:now+60000};rate.count++;rates.set(key,rate);
  if(rate.count>60)return reply.code(429).send({error:'rate_limited'});
 }
 app.get('/api/airdrop/session',{preHandler:gate},async(request,reply)=>{
  const state=read(request)||{id:randomUUID(),step:0,opened:false,expires:Date.now()+31536000000};
  try{const submitted=Boolean(await store.find(hash(state.id)));write(reply,state);return publicState(state,submitted);}catch{return reply.code(503).send({error:'unavailable'});}
 });
 app.post('/api/airdrop/progress',{preHandler:gate},async(request,reply)=>{
  const state=read(request),body=request.body;if(!state)return reply.code(401).send({error:'session_required'});
  if(state.step===3||body?.step!==state.step||!['open','done'].includes(body?.action))return reply.code(400).send({error:'invalid_step'});
  if(body.action==='open')state.opened=true;
  else{if(!state.opened)return reply.code(400).send({error:'open_task_first'});state.step++;state.opened=false;}
  write(reply,state);return publicState(state);
 });
 app.post('/api/airdrop/submit',{preHandler:gate},async(request,reply)=>{
  const state=read(request);if(!state||state.step!==3)return reply.code(403).send({error:'complete_tasks_first'});
  let entry;try{entry=normalizeEntry(request.body);}catch{return reply.code(400).send({error:'invalid_entry'});}
  try{await store.insert({id:randomUUID(),visitor_hash:hash(state.id),...entry,tasks_completed:socialTasks.map(t=>t.id)});return reply.code(201).send({submitted:true});}
  catch(error){return reply.code(error.message==='duplicate'?409:503).send({error:error.message==='duplicate'?'duplicate_entry':'unavailable'});}
 });
}
