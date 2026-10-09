import {Contract} from 'ethers';
import {creativeBrief} from './art.mjs';
export const baseGrid=['..........','..........','..........','...GGGG...','...W.W....','...GGGG...','...RRRR...','..........','...GGGG...','...GGGG...'];
export function creationInput(tokenId,skill,history=[]){
 if(typeof skill!=='string'||!skill.trim())throw new Error('APPROVED_ART_SKILL_REQUIRED');
 const brief=creativeBrief(tokenId,baseGrid,history);
 brief.outputManifest={v:1,tokenId,artifactHash:'SHA-256 of raw RGB bytes, lowercase 64 hex',durationMs:'0 for static or 2000-20000 for animation',effect:'0 for static or integer 1-13 for animation',holyGrail:tokenId===1000};
 return {objective:JSON.stringify(brief),skill,...(skill==='implement-component'?{paths:['artifacts/impepe.rgb','artifacts/manifest.json']}:{}),github:false,outputs:[{name:'art',path:'artifacts/impepe.rgb',mediaType:'application/octet-stream'},{name:'manifest',path:'artifacts/manifest.json',mediaType:'application/json'}]};
}
// Both services reconstruct history from committed chain state, never Operator-supplied history
export async function expectedCreationInput(provider,collectionAddress,tokenId,skill){
 const collection=new Contract(collectionAddress,['function artifactHash(uint256) view returns(bytes32)','function duration(uint256) view returns(uint16)','function animation(uint256) view returns(uint8)'],provider);
 const history=[];
 for(let id=Math.max(1,tokenId-12);id<tokenId;id++){
  const [hash,duration,effect]=await Promise.all([collection.artifactHash(id),collection.duration(id),collection.animation(id)]);
  history.push({tokenId:id,artifactHash:hash.slice(2),durationMs:Number(duration),effect:Number(effect)});
 }
 return creationInput(tokenId,skill,history);
}
