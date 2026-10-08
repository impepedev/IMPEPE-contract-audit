import pg from 'pg';
export function database(connectionString) {
 if(!connectionString)throw new Error('DATABASE_URL required');
 const pool=new pg.Pool({connectionString,max:10});
 return {query:(...args)=>pool.query(...args),close:()=>pool.end(),async withAdvisoryLock(name,fn){const client=await pool.connect();let alive=true;const lost=()=>{alive=false;};client.on('error',lost);client.on('end',lost);try{const lock=await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held',[name]);if(!lock.rows[0].held)return{status:'worker_busy'};return await fn(()=>{if(!alive)throw new Error('WORKER_LOCK_LOST');});}finally{if(alive)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[name]);client.removeListener('error',lost);client.removeListener('end',lost);client.release(!alive);}},async transaction(fn){const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}};
}
