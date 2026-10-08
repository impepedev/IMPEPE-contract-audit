import test from 'node:test';import assert from 'node:assert/strict';
import {acceptedArtwork} from '../backend/evidence.mjs';import {creativeBrief,sha} from '../backend/art.mjs';
import {IMDClient} from '../backend/imd.mjs';import {buildAttestor} from '../backend/attestor.mjs';import {workerCycle} from '../backend/worker.mjs';
import {artFixture} from './fixtures/art-fixture.mjs';
test('accepted named files preserve raw frames and animation metadata without redrawing',async()=>{
 for(const tokenId of [1,2,1000]){const f=artFixture({tokenId,bytes:Buffer.alloc(tokenId===1?300:600,42)});const art=await acceptedArtwork({...f,baseHash:sha(f.bytes)});assert.deepEqual(art.bytes,f.bytes);assert.equal(art.artifactHash,sha(f.bytes));assert.equal(art.manifest.holyGrail,tokenId===1000);assert.equal(art.provenance.mode,'independent_signer_trusting_official_imd_https');}
});
test('artifact adapter rejects rejected attempts, altered files, unrelated jobs and malformed metadata',async()=>{
 for(const mutate of [f=>f.submissions.submissions[0].accepted=false,f=>f.result.files[0].hash='c'.repeat(64),f=>f.result.files[0].url='https://evil.invalid/art',f=>f.result.files.push(f.result.files[0]),f=>f.result.files[1].submissionHash='c'.repeat(64),f=>f.job.paidBy='0x'+'2'.repeat(40),f=>f.job.objective='{}',f=>f.result.complete=false,f=>f.submissions.submissions[0].artifacts[0].bytes=301]){const f=artFixture();mutate(f);await assert.rejects(acceptedArtwork({...f}));}
 const wrong=artFixture({tokenId:1});await assert.rejects(acceptedArtwork({...wrong,baseHash:'bad'}));
});
test('IMD reads enforce byte limits on streamed responses and forbid download redirects',async()=>{
 let redirect;const client=new IMDClient({fetcher:async(url,options)=>{redirect=options.redirect;return new Response(new Uint8Array(2401));}});await assert.rejects(client.artifact('a'.repeat(64)),/large/);assert.equal(redirect,'error');await assert.rejects(client.artifact('../bad'),/hash/);
 const paths=[];const shapes=new IMDClient({fetcher:async url=>{paths.push(url);return new Response('{}');}});await shapes.result('uuid');await shapes.submissions('uuid');assert.ok(paths[0].endsWith('/jobs/uuid/result'));assert.ok(paths[1].endsWith('/jobs/uuid/submissions'));
});
test('unconfigured signer rejects signing and disabled worker performs no external actions',async()=>{
 const app=buildAttestor({config:{signingEnabled:false}});assert.equal((await app.inject('/health')).json().signingEnabled,false);assert.equal((await app.inject({method:'POST',url:'/artifact',payload:{}})).statusCode,503);await app.close();assert.deepEqual(await workerCycle({config:{liveTransactions:false}}),{status:'transactions_disabled'});
});
