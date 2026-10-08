import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import Fastify from 'fastify';
import {PGlite} from '@electric-sql/pglite';
import {registerAirdrop,localAirdropStore} from './airdrop.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const stateDir=path.join(project,'website/.airdrop-local');await fs.mkdir(stateDir,{recursive:true});
const db=new PGlite(path.join(stateDir,'db'));
await db.exec(`create table if not exists airdrop_submissions(id uuid primary key,created_at timestamptz default now(),visitor_hash text not null unique,x_handle text not null unique,wallet_address text not null unique,tasks_completed jsonb not null);`);
const secretPath=path.join(stateDir,'session-secret');let secret;
try{secret=await fs.readFile(secretPath,'utf8');}catch{secret=randomBytes(32).toString('hex');await fs.writeFile(secretPath,secret);}
const port=Number(process.env.AIRDROP_PREVIEW_PORT||4180),origin=`http://127.0.0.1:${port}`;
const app=Fastify({logger:false,bodyLimit:4096});registerAirdrop(app,{origin,secret,store:localAirdropStore(db)});
app.get('/api/*',async(_,reply)=>reply.code(503).send({available:false}));
const dist=path.join(project,'website/dist');const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.gif':'image/gif','.md':'text/plain'};
app.get('/*',async(request,reply)=>{try{
 let pathname=decodeURIComponent(new URL(request.url,origin).pathname);if(pathname==='/')pathname='/index.html';if(!path.extname(pathname))pathname+='.html';
 const target=path.resolve(dist,'.'+pathname);if(!target.startsWith(dist+path.sep))return reply.code(404).send('Not found');
 return reply.type(types[path.extname(target)]||'application/octet-stream').send(await fs.readFile(target));
}catch{return reply.code(404).send('Not found');}});
await app.listen({host:'127.0.0.1',port});console.log(`Local Airdrop preview ${origin}/airdrop — submissions stored only in local PostgreSQL`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();await db.close();process.exit(0);});
