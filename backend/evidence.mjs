import {sha,validateArt} from './art.mjs';
import {canonical} from './payment.mjs';
const hex=/^[0-9a-f]{64}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function acceptedArtwork({imd,imdJobId,tokenId,baseHash,payer,expectedInput}) {
 if(!uuid.test(imdJobId)||!Number.isInteger(tokenId)||tokenId<1||tokenId>1000)throw new Error('INVALID_ART_JOB');
 const [job,result,submissions]=await Promise.all([imd.job(imdJobId),imd.result(imdJobId),imd.submissions(imdJobId)]);
 if(job.id!==imdJobId||job.state!=='completed'||job.paidBy?.toLowerCase()!==payer.toLowerCase()||result.jobId!==imdJobId||!result.complete||result.state!=='completed'||submissions.jobId!==imdJobId)throw new Error('ACCEPTED_JOB_REQUIRED');
 let brief;try{brief=JSON.parse(job.objective);}catch{throw new Error('ART_BRIEF_MISMATCH');}
 if(!expectedInput?.skill||canonical(brief)!==canonical(JSON.parse(expectedInput.objective))||job.skill!==expectedInput.skill||brief.tokenId!==tokenId)throw new Error('ART_BRIEF_MISMATCH');
 if(!Array.isArray(result.files)||result.files.length>32||!Array.isArray(submissions.submissions)||submissions.submissions.length>256)throw new Error('RESULT_SHAPE_UNSUPPORTED');
 function file(name,path,type,max){
  const matches=result.files.filter(f=>f.name===name);if(matches.length!==1)throw new Error('EXACT_NAMED_OUTPUT_REQUIRED');const f=matches[0];
  if(f.path!==path||f.mediaType!==type||!hex.test(f.hash)||!hex.test(f.submissionHash)||!Number.isInteger(f.bytes)||f.bytes<=0||f.bytes>max||f.url!==`https://api.imd.fun/artifacts/${f.hash}`)throw new Error('INVALID_ACCEPTED_FILE');
  const accepted=submissions.submissions.filter(s=>s.hash===f.submissionHash&&s.accepted===true&&s.outcome==='completed'&&hex.test(s.deviceKey));if(accepted.length!==1)throw new Error('ACCEPTED_SUBMISSION_REQUIRED');
  if(!accepted[0].artifacts?.some(a=>a.hash===f.hash&&a.name===f.name&&a.path===f.path&&a.mediaType===f.mediaType&&a.bytes===f.bytes))throw new Error('SUBMISSION_FILE_MISMATCH');
  return {...f,deviceKey:accepted[0].deviceKey};
 }
 const art=file('art','artifacts/impepe.rgb','application/octet-stream',2400),meta=file('manifest','artifacts/manifest.json','application/json',16384);
 if(art.submissionHash!==meta.submissionHash)throw new Error('OUTPUTS_MUST_SHARE_SUBMISSION');
 const [bytes,metadata]=await Promise.all([imd.artifact(art.hash),imd.artifact(meta.hash,{maxBytes:16384})]);
 if(bytes.length!==art.bytes||sha(bytes)!==art.hash||metadata.length!==meta.bytes||sha(metadata)!==meta.hash)throw new Error('ARTIFACT_HASH_MISMATCH');
 let manifest;try{manifest=JSON.parse(metadata.toString('utf8'));}catch{throw new Error('INVALID_ART_MANIFEST');}
 if(manifest.v!==1||manifest.tokenId!==tokenId||manifest.artifactHash!==art.hash||manifest.holyGrail!==(tokenId===1000)||!Number.isInteger(manifest.durationMs)||!Number.isInteger(manifest.effect))throw new Error('ART_MANIFEST_MISMATCH');
 const validation=validateArt(bytes,{tokenId,baseHash,durationMs:manifest.durationMs,effect:manifest.effect});
 return {...validation,byteLength:validation.bytes,bytes,manifest,provenance:{mode:'independent_signer_trusting_official_imd_https',imdJobId,submissionHash:art.submissionHash,deviceKey:art.deviceKey,artifactHash:art.hash,manifestHash:meta.hash}};
}
