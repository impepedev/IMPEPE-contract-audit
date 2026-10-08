import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyAuditApproval(){
 const record=JSON.parse(fs.readFileSync('artifacts/audit-approval.json','utf8'));
 if(record.auditApproved!==true||record.status!=='audit_approved')throw new Error('Release audit approval missing');
 for(const [path,expected] of Object.entries(record.sourceHashes))if(hash(fs.readFileSync(path))!==expected)throw new Error(`Approved release source changed: ${path}`);
 if(hash(fs.readFileSync('artifacts/contract-manifest.json'))!==record.manifestSha256||hash(fs.readFileSync('artifacts/compiler-input.json'))!==record.compilerInputSha256)throw new Error('Approved build changed');
 return record;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const record=verifyAuditApproval();console.log(JSON.stringify({status:'approved_source_matches',release:record.release,tests:record.regressionTests}));}
