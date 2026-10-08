import fs from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';import {loadConfig} from './config.mjs';import {buildServer} from './server.mjs';
// Developer-only PostgreSQL runtime No mocked market, mint or swarm activity.
const db=new PGlite('./.localdb');await db.exec(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));
const config=loadConfig();const app=buildServer({config,db,provider:null});await app.listen({host:'127.0.0.1',port:config.port});console.log(`Local backend http://127.0.0.1:${config.port} No deployed data sources`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();await db.close();process.exit(0);});
