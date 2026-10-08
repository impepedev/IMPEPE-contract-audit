const zero='0x0000000000000000000000000000000000000000';
export async function applyTransfer(db,{chainId,from,to,value,timestamp,blockNumber}) {
 const amount=BigInt(value);if(amount<0n)throw new Error('Negative transfer');
 for(const [raw,delta]of [[from,-amount],[to,amount]]) {
  const address=raw.toLowerCase();if(address===zero)continue;
  const {rows}=await db.query('SELECT balance,score,last_timestamp FROM holders WHERE chain_id=$1 AND address=$2 FOR UPDATE',[chainId,address]);
  const old=rows[0];const elapsed=BigInt(timestamp)-BigInt(old?.last_timestamp??timestamp);if(elapsed<0n)throw new Error('Nonmonotonic timestamp');
  const balance=BigInt(old?.balance??0)+delta;if(balance<0n)throw new Error('Transfer history incomplete');
  const score=BigInt(old?.score??0)+BigInt(old?.balance??0)*elapsed;
  await db.query('INSERT INTO holders(chain_id,address,balance,score,last_timestamp,first_block) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(chain_id,address) DO UPDATE SET balance=EXCLUDED.balance,score=EXCLUDED.score,last_timestamp=EXCLUDED.last_timestamp',[chainId,address,balance.toString(),score.toString(),timestamp,blockNumber]);
 }
}
export const MINIMUM_HOLDER_BALANCE = 10_000n * 10n ** 18n;
export function rank(rows,cutoffTimestamp,excluded=[],allocated=[],minimumBalance=MINIMUM_HOLDER_BALANCE) {
 const blocked=new Set([...excluded,...allocated].map(a=>a.toLowerCase()));
 return rows.filter(row=>BigInt(row.balance)>=minimumBalance&&!blocked.has(row.address.toLowerCase())).map(row=>{
  const elapsed=BigInt(cutoffTimestamp)-BigInt(row.last_timestamp);if(elapsed<0n)throw new Error('Cutoff predates current accounting Use a historical replay');
  return {address:row.address,score:(BigInt(row.score)+BigInt(row.balance)*elapsed).toString(),balance:row.balance};
 }).sort((a,b)=>BigInt(a.score)>BigInt(b.score)?-1:BigInt(a.score)<BigInt(b.score)?1:a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
}
export function feeSplit(gross){gross=BigInt(gross);if(gross<0n)throw new Error('Negative gross');const total=gross*4n/100n,creation=gross*3n/100n;return{total,creation,protocol:total-creation};}
