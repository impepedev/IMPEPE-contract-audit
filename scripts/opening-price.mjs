import {isAddress} from 'ethers';

// Both assets use 18 decimals. Tick orientation follows the final predicted addresses.
export function openingPrice({targetOpeningFdvImd,fixedSupply,tickSpacing,tokenAddress,imdAddress}) {
 const fdv=Number(targetOpeningFdvImd);const supply=Number(fixedSupply);
 if(!Number.isFinite(fdv)||fdv<=0||supply!==1e9)throw new Error('Positive target FDV and fixed 1 billion supply required');
 if(!Number.isSafeInteger(tickSpacing)||tickSpacing<=0||tickSpacing>32767)throw new Error('Invalid tick spacing');
 const requestedPriceImd=fdv/supply;
 const canonicalTick=Math.round(Math.log(requestedPriceImd)/Math.log(1.0001)/tickSpacing)*tickSpacing;
 const bound=Math.floor(887272/tickSpacing)*tickSpacing;
 if(!Number.isSafeInteger(canonicalTick)||Math.abs(canonicalTick)>=bound)throw new Error('Opening price outside usable tick range');
 const actualPriceImd=Math.pow(1.0001,canonicalTick);
 let openingTick=null;
 if(tokenAddress||imdAddress){
  if(!tokenAddress||!imdAddress||!isAddress(tokenAddress.toLowerCase())||!isAddress(imdAddress.toLowerCase())||tokenAddress.toLowerCase()===imdAddress.toLowerCase())throw new Error('Distinct valid token addresses required');
  openingTick=BigInt(tokenAddress)<BigInt(imdAddress)?canonicalTick:-canonicalTick;
 }
 return {targetOpeningFdvImd:fdv,requestedPriceImd,tickSpacing,openingTick,token0OpeningTick:canonicalTick,token1OpeningTick:-canonicalTick,approximateOpeningPriceImd:actualPriceImd,approximateOpeningFdvImd:actualPriceImd*supply,initialRealImdReserve:'0'};
}
