const quotes=new Set(['0x0000000000000000000000000000000000000000','0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2','0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48','0xdac17f958d2ee523a2206206994597c13d831ec7']);
export function imdUsdRate(data,address){
 const pairs=(data?.pairs||[]).filter(p=>p.chainId==='ethereum'&&p.baseToken?.address?.toLowerCase()===address.toLowerCase()&&quotes.has(p.quoteToken?.address?.toLowerCase())&&Number.isFinite(Number(p.priceUsd))&&Number(p.priceUsd)>0&&Number.isFinite(p.liquidity?.usd)&&p.liquidity.usd>=10000).sort((a,b)=>b.liquidity.usd-a.liquidity.usd);
 if(!pairs.length)throw Error('IMD/USD unavailable');
 return {price:Number(pairs[0].priceUsd),pairAddress:pairs[0].pairAddress,source:'dexscreener'};
}
export function convertMarket(data,rate){
 if(!Number.isFinite(rate?.price)||rate.price<=0)throw Error('Invalid dollar rate');
 const convert=value=>value==null?null:Number(value)*rate.price;
 const result={...data,priceUsd:convert(data.priceImd),marketCapUsd:convert(data.marketCapImd),totalVolumeUsd:convert(data.totalVolumeImd),creationPoolUsd:convert(data.creationPoolImd),imdPriceUsd:rate.price,usdRateUpdatedAt:rate.updatedAt,usdRateSource:rate.source,usdRatePair:rate.pairAddress,volumeUsdBasis:'current_imd_rate',partial:data.totalVolumeImd==null};
 if([result.priceUsd,result.marketCapUsd,result.creationPoolUsd,...(result.totalVolumeUsd==null?[]:[result.totalVolumeUsd])].some(v=>!Number.isFinite(v)||v<0))throw Error('Invalid dollar conversion');
 return result;
}
export function dollarConverter(fetcher=fetch){
 let cached=null,pending=null;
 return async(data,address)=>{
  try{
   if(!cached||cached.address!==address||Date.now()-cached.time>15000){
    if(!pending)pending=(async()=>{const response=await fetcher(`https://api.dexscreener.com/latest/dex/tokens/${address}`,{signal:AbortSignal.timeout(4000)});if(!response.ok)throw Error('Rate unavailable');const rate=imdUsdRate(await response.json(),address);cached={...rate,address,time:Date.now(),updatedAt:new Date().toISOString()};})().finally(()=>pending=null);
    await pending;
   }
   return convertMarket(data,cached);
  }catch{return {...data,partial:true,priceUsd:null,marketCapUsd:null,totalVolumeUsd:null,creationPoolUsd:null};}
 };
}
