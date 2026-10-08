import {createHash,verify,createPublicKey} from 'node:crypto';
import {AbiCoder,sha256} from 'ethers';
export const sha = bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateArt(bytes,{tokenId,durationMs=0,effect=0,baseHash}) {
 const frames=bytes.length/300;if(!Number.isInteger(frames)||frames<1||frames>8||!Number.isInteger(tokenId)||tokenId<1||tokenId>1000)throw new Error('Invalid 10x10 frame payload');
 if(frames===1?(durationMs!==0||effect!==0):(!Number.isInteger(durationMs)||durationMs<2000||durationMs>20000||!Number.isInteger(effect)||effect<1||effect>13))throw new Error('Invalid animation');
 if(tokenId===1&&(frames!==1||sha(bytes)!==baseHash))throw new Error('First NFT must use the exact base');
 const commitment=sha256(AbiCoder.defaultAbiCoder().encode(['bytes','uint16','uint8'],[bytes,durationMs,effect]));
 return {artifactHash:sha(bytes),commitmentHash:commitment,frames,bytes:bytes.length};
}
export function authenticateArtifact(bytes,receipt,{expectedHash,expectedLease,expectedDevice}) {
 // Expected values must come from authenticated job/lease evidence, never from the artifact itself.
 const {hash,leaseId,deviceKey,signature}=receipt;
 if(!/^[0-9a-f]{64}$/.test(hash)||hash!==expectedHash||hash!==sha(bytes)||leaseId!==expectedLease||deviceKey!==expectedDevice||!/^[0-9a-f]{64}$/.test(deviceKey)||!/^[0-9a-f]{128}$/.test(signature))throw new Error('Artifact identity mismatch');
 const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(deviceKey,'hex')]),format:'der',type:'spki'});
 const preimage=Buffer.from(`identitymd.v2\nartifact:${leaseId}\n${hash}`);
 if(!verify(null,preimage,key,Buffer.from(signature,'hex')))throw new Error('Invalid device signature');
 return true;
}
export const effects=['static','brightness pulse','color cycle','pixel glow','twinkle','blink','expression','traveling wave','shimmer','particles','scene change','rain','glitch','distortion'];
export function creativeBrief(id,baseGrid,history=[]) {
 if(!Number.isInteger(id)||id<1||id>1000)throw new Error('Invalid progression');
 return {objective:`Create IMPEPE #${id} as strict 10x10 whole-cell pixel art ${id===1?'Use the exact supplied static base':id===1000?'Create the Holy Grail finale with a final-only composition':'Develop the collection progressively while preserving recognizable Pepe identity'}`,baseGrid,basePalette:{'.':[0,0,0],G:[34,183,0],W:[255,255,255],R:[183,0,0]},pixelOrder:'Rows top to bottom, cells left to right, unsigned RGB bytes per cell',tokenId:id,history,effects:id===1?['static']:effects,format:'raw RGB bytes, 300 bytes per complete frame; maximum 8 frames; no geometry animation',duration:'static 0; animated 2000-20000ms',constraints:['No external resources, scripts, gradients, blur, subpixels or transforms','Return the raw artifact bytes unchanged','Animation changes uniform cell colors only']};
}
