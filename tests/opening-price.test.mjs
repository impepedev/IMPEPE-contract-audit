import test from 'node:test';import assert from 'node:assert/strict';
import {openingPrice} from '../scripts/opening-price.mjs';
const config={targetOpeningFdvImd:'1000',fixedSupply:'1000000000',tickSpacing:60};
const low='0x0000000000000000000000000000000000000001',high='0x0000000000000000000000000000000000000002';
test('approved valuation rounds to the supported price without pretending reserves exist',()=>{
 const p=openingPrice(config);assert.equal(p.requestedPriceImd,0.000001);assert.equal(p.openingTick,null);assert.equal(p.initialRealImdReserve,'0');assert.ok(Math.abs(p.approximateOpeningFdvImd-998.2030284)<0.000001);
});
test('either address ordering preserves the same IMD price instead of its reciprocal',()=>{
 for(const [tokenAddress,imdAddress] of [[low,high],[high,low]]){const p=openingPrice({...config,tokenAddress,imdAddress});assert.equal(p.openingTick,tokenAddress===low?-138180:138180);const price=Math.pow(1.0001,tokenAddress===low?p.openingTick:-p.openingTick);assert.equal(price,p.approximateOpeningPriceImd);}
});
test('invalid targets, ticks and ambiguous currency addresses fail closed',()=>{
 for(const extra of [{targetOpeningFdvImd:'0'},{targetOpeningFdvImd:'NaN'},{targetOpeningFdvImd:'1e-100'},{fixedSupply:'980000000'},{tickSpacing:0},{tickSpacing:1.5},{tokenAddress:low},{tokenAddress:low,imdAddress:low}])assert.throws(()=>openingPrice({...config,...extra}));
});
