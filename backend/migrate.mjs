import fs from 'node:fs/promises';
import {database} from './db.mjs';
const db=database(process.env.DATABASE_URL);
try{await db.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));console.log('Database migrated');}finally{await db.close();}
