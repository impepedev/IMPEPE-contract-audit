import test from 'node:test';
import assert from 'node:assert/strict';
import {buildServer} from '../backend/server.mjs';
test('ETH quotes never fall through to the single-pool IMD quoter',async()=>{
 const tokenAddress='0x1111111111111111111111111111111111111111';
 const app=buildServer({config:{chainId:1,tokenAddress},db:null,provider:{send(){throw new Error('ETH must not call IMD quoter');}}});
 try{
  for(const side of ['buy','sell']){
   const query=`/api/quote?chainId=1&tokenAddress=${tokenAddress}&side=${side}&amount=1&slippageBps=100`;
   const eth=await app.inject(query+'&asset=ETH');
   assert.equal(eth.statusCode,503);assert.equal(eth.json().reason,'route_unavailable');
   assert.equal((await app.inject(query+'&asset=USDC')).statusCode,400);
   assert.equal((await app.inject(query+'&asset=IMD')).statusCode,503);
  }
 }finally{await app.close();}
});
