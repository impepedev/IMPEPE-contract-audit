import fs from 'node:fs';import {ContractFactory,Interface,getCreateAddress,getCreate2Address,keccak256,toBeHex,zeroPadValue,parseEther,sha256,isAddress} from 'ethers';
import {compile} from './compile.mjs';
import {openingPrice} from './opening-price.mjs';
import {verifyAuditApproval} from './verify-audit-approval.mjs';
import {imdLaunchPlan} from './imd-launch-plan.mjs';
const config=JSON.parse(fs.readFileSync(process.argv[2]||'deployment.json','utf8'));const blocked=[];
const outputDir=process.argv[3]||'artifacts';
if(config.launchRoute==='imd_standard'){await imdLaunchPlan(config,outputDir);process.exit(0);}
for(const field of ['poolManager','artifactAttestor'])if(!config[field]||!isAddress(config[field].toLowerCase()))blocked.push(`${field} required`);
if(!Number.isSafeInteger(config.deployerNonce)||config.deployerNonce<0)blocked.push('deployerNonce required from a fresh RPC observation');
if(config.liquidityModel!=='single_sided_permanent')blocked.push('Approved single-sided permanent liquidity model required');
let pricePreview;try{pricePreview=openingPrice({targetOpeningFdvImd:config.targetOpeningFdvImd,fixedSupply:config.fixedSupply,tickSpacing:config.tickSpacing});}catch(error){blocked.push(error.message);}
if(!config.artifactTrustApproved)blocked.push('Artifact attestation trust boundary requires approval');
if(config.chainId===1&&!config.auditApproved)blocked.push('Mainnet audit approval required');
if(config.chainId===1&&!config.legalReviewApproved&&config.legalReviewWaived!==true)blocked.push('Specialist legal/regulatory review required or explicit owner waiver needed');
if(config.chainId===1&&config.auditApproved){try{verifyAuditApproval();}catch(error){blocked.push(error.message);}}
fs.mkdirSync(outputDir,{recursive:true});
if(pricePreview)fs.writeFileSync(`${outputDir}/opening-price.json`,JSON.stringify(pricePreview,null,2));
if(blocked.length){fs.writeFileSync(`${outputDir}/deployment-readiness.json`,JSON.stringify({status:'not_ready',blocked},null,2));console.log(JSON.stringify({status:'not_ready',blocked},null,2));process.exitCode=1;}else{
 compile();const admin=config.deployer.toLowerCase(),operator=config.operator.toLowerCase();if(admin===operator)throw new Error('Separate Operator required');
 if([admin,operator].includes(config.artifactAttestor.toLowerCase()))throw new Error('Attestor must differ from admin and Operator');
 const names=['LiquidityBootstrap','ProjectToken','SwarmCollection','ReceiptVerifier','RewardsDistributor','CreationController','FeeRouter','HookFactory'];const predicted=Object.fromEntries(names.map((name,i)=>[name,getCreateAddress({from:admin,nonce:config.deployerNonce+i})]));
 const price=openingPrice({...config,tokenAddress:predicted.ProjectToken});
 const art=Buffer.alloc(300);const rows=['..........','..........','..........','...GGGG...','...W.W....','...GGGG...','...RRRR...','..........','...GGGG...','...GGGG...'];const colors={'.':[0,0,0],G:[34,183,0],W:[255,255,255],R:[183,0,0]};rows.join('').split('').forEach((v,i)=>art.set(colors[v],i*3));
 const args={LiquidityBootstrap:[admin,config.poolManager,predicted.ProjectToken,config.imdAddress],ProjectToken:[admin,predicted.LiquidityBootstrap],SwarmCollection:[admin],ReceiptVerifier:[config.artifactAttestor],RewardsDistributor:[config.imdAddress,predicted.SwarmCollection],CreationController:[admin,config.imdAddress,predicted.ProjectToken,predicted.SwarmCollection,predicted.ReceiptVerifier,operator,operator,parseEther(config.jobBudgetImd),config.settlementBlocks,sha256(art)],FeeRouter:[admin,config.imdAddress,predicted.CreationController,predicted.RewardsDistributor,config.protocolRecipient.toLowerCase()],HookFactory:[admin]};
 const transactions=[];
 for(const name of names){const a=JSON.parse(fs.readFileSync(`artifacts/${name}.json`));const tx=await new ContractFactory(a.abi,a.evm.bytecode.object).getDeployTransaction(...args[name]);transactions.push({label:`Deploy ${name}`,from:admin,chainId:config.chainId,nonce:config.deployerNonce+transactions.length,data:tx.data,value:'0'});}
 const hookArtifact=JSON.parse(fs.readFileSync('artifacts/IMPEPEHook.json'));const hookInit=(await new ContractFactory(hookArtifact.abi,hookArtifact.evm.bytecode.object).getDeployTransaction(config.poolManager,config.imdAddress,predicted.ProjectToken,predicted.FeeRouter,config.tickSpacing,predicted.LiquidityBootstrap)).data;
 const initHash=keccak256(hookInit);let salt,hook;for(let i=0;;i++){salt=zeroPadValue(toBeHex(i),32);hook=getCreate2Address(predicted.HookFactory,salt,initHash);if((BigInt(hook)&0x3fffn)===0x2accn)break;}
 predicted.IMPEPEHook=hook;
 // Verify the deployed HookFactory bytecode against this package before signing the CREATE2 call.
 transactions.push({label:'Deploy permission-address hook via HookFactory',from:admin,to:predicted.HookFactory,chainId:config.chainId,nonce:config.deployerNonce+transactions.length,data:new Interface(['function deploy(bytes32,bytes) returns(address)']).encodeFunctionData('deploy',[salt,hookInit]),value:'0'});
 predicted.IMPEPESwapRouter=getCreateAddress({from:admin,nonce:config.deployerNonce+transactions.length});
 const swapArtifact=JSON.parse(fs.readFileSync('artifacts/IMPEPESwapRouter.json'));const swapDeploy=await new ContractFactory(swapArtifact.abi,swapArtifact.evm.bytecode.object).getDeployTransaction(config.poolManager,hook);
 transactions.push({label:'Deploy IMPEPESwapRouter',from:admin,chainId:config.chainId,nonce:config.deployerNonce+transactions.length,data:swapDeploy.data,value:'0'});
 function call(name,method,values){const a=JSON.parse(fs.readFileSync(`artifacts/${name}.json`));transactions.push({label:`${name}.${method}`,from:admin,to:predicted[name],chainId:config.chainId,nonce:config.deployerNonce+transactions.length,data:new Interface(a.abi).encodeFunctionData(method,values),value:'0'});}
 call('SwarmCollection','configure',[predicted.CreationController,predicted.RewardsDistributor]);call('CreationController','configureRouter',[predicted.FeeRouter]);call('FeeRouter','configureHook',[hook]);
 for(const address of [...new Set([admin,operator,config.protocolRecipient.toLowerCase(),config.poolManager,...Object.values(predicted)])])call('ProjectToken','setExcluded',[address,true]);
 const imdFirst=BigInt(config.imdAddress)<BigInt(predicted.ProjectToken);const key={currency0:imdFirst?config.imdAddress:predicted.ProjectToken,currency1:imdFirst?predicted.ProjectToken:config.imdAddress,fee:0,tickSpacing:config.tickSpacing,hooks:hook};call('LiquidityBootstrap','configure',[key,price.openingTick]);call('ProjectToken','sealEligibility',[]);call('LiquidityBootstrap','seed',[]);
 const result={status:'review_required',liquidityModel:config.liquidityModel,...price,predicted,poolKey:key,transactions,remaining:['Verify every configured external contract and factory bytecode','Review the exact opening price and tick orientation after addresses are predicted; displayed numeric price is approximate','Verify 980 million tokens enter permanently locked liquidity except for bounded rounding dust','Verify contract source, addresses, allocation, eligibility exclusions, empty-reserve behavior and hook fee settlement on Sepolia','Configure backend RPC, database, IMD evidence bridge, prices and public endpoint URLs']};
 fs.writeFileSync(`${outputDir}/unsigned-deployment-plan.json`,JSON.stringify(result,null,2));console.log('Unsigned deployment plan written No transaction was signed or broadcast');
}
