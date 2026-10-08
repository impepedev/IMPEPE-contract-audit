import fs from 'node:fs';import {createHash} from 'node:crypto';import solc from 'solc';
import {compile} from './compile.mjs';
compile();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const names=['ProjectToken','LiquidityBootstrap','IMPEPEHook','FeeRouter','CreationController','SwarmCollection','RewardsDistributor','ReceiptVerifier','IMPEPESwapRouter','HookFactory'];
const manifest={status:'v1.1_source_freeze_pending_external_deployment_inputs_and_audit',compiler:solc.version(),evm:'cancun',optimizerRuns:200,proxyUpgradeable:false,creationControllerReplaceable:true,migrationDelaySeconds:172800,tokenAndLiquidityImmutable:true,deployedContracts:10,renderer:'embedded SVGRenderer library',compilerInputSha256:hash(fs.readFileSync('artifacts/compiler-input.json')),packageLockSha256:hash(fs.readFileSync('package-lock.json')),sources:{},contracts:{}};
for(const name of [...names,'SVGRenderer'])manifest.sources[`contracts/${name}.sol`]=hash(fs.readFileSync(`contracts/${name}.sol`));
for(const name of names){const artifact=JSON.parse(fs.readFileSync(`artifacts/${name}.json`));manifest.contracts[name]={abiSha256:hash(JSON.stringify(artifact.abi)),creationBytecodeSha256:hash(Buffer.from(artifact.evm.bytecode.object,'hex')),runtimeBytecodeSha256:hash(Buffer.from(artifact.evm.deployedBytecode.object,'hex')),runtimeBytes:artifact.evm.deployedBytecode.object.length/2};}
fs.writeFileSync('artifacts/contract-manifest.json',JSON.stringify(manifest,null,2));console.log('Contract v1.1 manifest and complete verification compiler input written');
