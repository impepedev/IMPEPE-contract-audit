export class IMDClient {
 constructor({token,fetcher=fetch,base='https://api.imd.fun'}) {this.token=token;this.fetcher=fetcher;this.base=base;}
 async request(path,options={}) {
  if(!/^\/(requests|jobs|artifacts)(\/|$)/.test(path))throw new Error('Unsupported IMD route');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try{const response=await this.fetcher(this.base+path,{...options,redirect:'error',signal:controller.signal,headers:{Accept:'application/json',...(options.paid?{Authorization:`Bearer ${this.requireToken()}`} : {}),...options.headers}});
   if(!response.ok)throw Object.assign(new Error(`IMD request failed (${response.status})`),{status:response.status});
   const max=options.maxBytes||4*1024*1024;const chunks=[];let size=0;
   if(Number(response.headers.get('content-length'))>max)throw new Error('IMD response too large');
   if(response.body){const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Error('IMD response too large');}chunks.push(value);}}finally{reader.releaseLock();}}
   return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers});
  } finally{clearTimeout(timer);}
 }
 requireToken(){if(!this.token)throw new Error('IMD paid request token required');return this.token;}
 async capabilities(){return (await this.request('/requests/capabilities')).json();}
 async quote(requestKey,input){return (await this.request('/requests/quote',{paid:true,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestKey,action:'job.open',input})})).json();}
 async order(id){return (await this.request(`/requests/${encodeURIComponent(id)}`,{paid:true})).json();}
 async job(id){return (await this.request(`/jobs/${encodeURIComponent(id)}`)).json();}
 async result(id){return (await this.request(`/jobs/${encodeURIComponent(id)}/result`)).json();}
 async submissions(id){return (await this.request(`/jobs/${encodeURIComponent(id)}/submissions`)).json();}
 async artifact(hash,{maxBytes=2400}={}){if(!/^[0-9a-f]{64}$/.test(hash))throw new Error('Invalid hash');const response=await this.request(`/artifacts/${hash}`,{maxBytes});return Buffer.from(await response.arrayBuffer());}
 async challenge(id){const response=await this.fetcher(`${this.base}/requests/${encodeURIComponent(id)}/submit`,{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${this.requireToken()}`}});if(response.status!==402)throw new Error('Expected unpaid IMD challenge');return response.json();}
}
