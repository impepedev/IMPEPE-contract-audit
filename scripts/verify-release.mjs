import fs from 'node:fs';
import {createHash} from 'node:crypto';
import solc from 'solc';
const input=fs.readFileSync('artifacts/compiler-input.json','utf8');
const manifest=JSON.parse(fs.readFileSync('artifacts/contract-manifest.json','utf8'));
const hash=data=>createHash('sha256').update(data).digest('hex');
if(hash(input)!==manifest.compilerInputSha256||hash(fs.readFileSync('package-lock.json'))!==manifest.packageLockSha256)throw new Error('Release input hash mismatch');
for(const [file,expected] of Object.entries(manifest.sources))if(hash(fs.readFileSync(file))!==expected)throw new Error(`Source changed: ${file}`);
const output=JSON.parse(solc.compile(input));
const errors=(output.errors||[]).filter(item=>item.severity==='error');if(errors.length)throw new Error(errors.map(item=>item.formattedMessage).join('\n'));
for(const [name,expected]of Object.entries(manifest.contracts)){
 const built=output.contracts[`contracts/${name}.sol`][name];
 if(hash(JSON.stringify(built.abi))!==expected.abiSha256||hash(Buffer.from(built.evm.bytecode.object,'hex'))!==expected.creationBytecodeSha256||hash(Buffer.from(built.evm.deployedBytecode.object,'hex'))!==expected.runtimeBytecodeSha256)throw new Error(`Non-reproducible contract: ${name}`);
}
fs.writeFileSync('artifacts/release-verification.json',JSON.stringify({status:'verified',contracts:Object.keys(manifest.contracts).length,compiler:solc.version(),compilerInputSha256:manifest.compilerInputSha256,sourceAndDependencyHashesMatch:true,standaloneCompilerInputReproducesBytecode:true},null,2));
console.log('All ten contracts reproduce exactly from the standalone compiler input');
