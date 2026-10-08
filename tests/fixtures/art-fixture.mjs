import {creationInput} from '../../backend/creation-input.mjs';
import {sha} from '../../backend/art.mjs';
export function artFixture({tokenId=2,bytes=Buffer.alloc(300,42),payer='0x'+'1'.repeat(40)}={}){
 const imdJobId='11111111-1111-4111-8111-111111111111',submissionHash='a'.repeat(64),deviceKey='b'.repeat(64);
 const manifest={v:1,tokenId,artifactHash:sha(bytes),durationMs:bytes.length===300?0:4000,effect:bytes.length===300?0:13,holyGrail:tokenId===1000},meta=Buffer.from(JSON.stringify(manifest));
 const files=[{name:'art',path:'artifacts/impepe.rgb',mediaType:'application/octet-stream',hash:sha(bytes),bytes:bytes.length,submissionHash},{name:'manifest',path:'artifacts/manifest.json',mediaType:'application/json',hash:sha(meta),bytes:meta.length,submissionHash}].map(f=>({...f,url:`https://api.imd.fun/artifacts/${f.hash}`}));
 const expectedInput=creationInput(tokenId,'impepe-art');
 const job={skill:expectedInput.skill,id:imdJobId,state:'completed',paidBy:payer,objective:expectedInput.objective},result={jobId:imdJobId,state:'completed',complete:true,files},submissions={jobId:imdJobId,submissions:[{hash:submissionHash,deviceKey,accepted:true,outcome:'completed',artifacts:files.map(({url,submissionHash,...f})=>f)}]};
 const imd={async job(){return job;},async result(){return result;},async submissions(){return submissions;},async artifact(hash){return hash===sha(bytes)?bytes:meta;}};
 return {expectedInput,imd,imdJobId,tokenId,payer,bytes,manifest,job,result,submissions};
}
