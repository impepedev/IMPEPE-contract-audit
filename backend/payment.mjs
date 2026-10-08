import {x402Client} from '@x402/core/client';import {encodePaymentSignatureHeader} from '@x402/core/http';import {ExactEvmScheme} from '@x402/evm/exact/client';import {sha} from './art.mjs';
export function canonical(value) {
 if(value===null)return 'null';if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 if(typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
 if(typeof value==='number'&&!Number.isSafeInteger(value)||!['string','number','boolean'].includes(typeof value))throw new Error('Invalid canonical input');return JSON.stringify(value);
}
const types={QuoteApproval:['resource:string','requesterScopeHash:bytes32','quoteId:string','quoteHash:bytes32','paymentHash:bytes32','action:string','asset:address','amount:uint256','payTo:address','expiresAt:uint256'].map(field=>{const [name,type]=field.split(':');return{name,type};})};
export function validateChallenge(challenge,{orderId,inputHash,imdAddress,payTo,maxAmount,now=Math.floor(Date.now()/1000)}) {
 const quote=challenge.quote,terms=challenge.accepts?.[0];
 if(!quote||!terms||quote.id!==orderId||quote.action!=='job.open'||quote.inputHash!==inputHash||quote.payment.network!=='eip155:1'||terms.network!=='eip155:1'||quote.payment.asset.toLowerCase()!==imdAddress.toLowerCase()||terms.asset.toLowerCase()!==imdAddress.toLowerCase()||quote.payment.payTo.toLowerCase()!==payTo.toLowerCase()||terms.payTo.toLowerCase()!==payTo.toLowerCase()||BigInt(quote.payment.amount)>BigInt(maxAmount)||BigInt(quote.payment.amount)<=0n||terms.amount!==quote.payment.amount||terms.scheme!=='exact'||terms.extra?.assetTransferMethod!=='permit2'||quote.expiresAt<=now+30||challenge.resourceUrl!==`https://api.imd.fun/requests/${orderId}/submit`)throw new Error('Unapproved IMD payment terms');
 return terms;
}
export async function preparePayment(challenge,policy,signer,{client}={}) {
 const accepted=validateChallenge(challenge,policy);
 const sdk=client||x402Client.fromConfig({schemes:[{network:accepted.network,client:new ExactEvmScheme(signer)}]});
 const generated=await sdk.createPaymentPayload({x402Version:2,resource:challenge.resource,accepts:[accepted]});
 const payment={...generated,accepted};delete payment.extensions;
 const authorization=payment.payload?.permit2Authorization;
 if(!authorization||authorization.from.toLowerCase()!==signer.address.toLowerCase()||authorization.permitted.token.toLowerCase()!==policy.imdAddress.toLowerCase()||BigInt(authorization.permitted.amount)!==BigInt(accepted.amount)||authorization.witness.to.toLowerCase()!==policy.payTo.toLowerCase()||BigInt(authorization.deadline)>BigInt(challenge.quote.expiresAt)||authorization.spender.toLowerCase()!==policy.spender.toLowerCase())throw new Error('Invalid generated Permit2 authorization');
 const normalized=JSON.parse(JSON.stringify(payment));const quote=challenge.quote;
 const approval=await signer.signTypedData({domain:{name:'IdentityMD Paid Action',version:'1',chainId:1},primaryType:'QuoteApproval',types,message:{resource:challenge.resourceUrl,requesterScopeHash:`0x${challenge.requesterScopeHash}`,quoteId:quote.id,quoteHash:`0x${quote.quoteHash}`,paymentHash:`0x${sha(Buffer.from(canonical(normalized)))}`,action:quote.action,asset:quote.payment.asset,amount:BigInt(quote.payment.amount),payTo:quote.payment.payTo,expiresAt:BigInt(quote.expiresAt)}});
 return {header:encodePaymentSignatureHeader(normalized),body:{quoteSignature:approval},orderId:policy.orderId,expiresAt:quote.expiresAt};
}
export async function submitPrepared(client,envelope,{enabled=false}={}) {
 if(!enabled)throw new Error('LIVE_TRANSACTIONS is disabled');
 if(envelope.expiresAt<=Math.floor(Date.now()/1000))throw new Error('Payment expired');
 return (await client.request(`/requests/${encodeURIComponent(envelope.orderId)}/submit`,{paid:true,method:'POST',headers:{'Content-Type':'application/json','PAYMENT-SIGNATURE':envelope.header},body:JSON.stringify(envelope.body)})).json();
}
