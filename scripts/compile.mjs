import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
export function compile({tests=false}={}) {
 const sources={};
 const imported={};
 for(const folder of ['contracts',...(tests?['tests/contracts']:[])])for(const file of fs.readdirSync(folder).filter(f=>f.endsWith('.sol')))sources[`${folder}/${file}`]={content:fs.readFileSync(`${folder}/${file}`,'utf8')};
 const settings={optimizer:{enabled:true,runs:200},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','storageLayout']}}};
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings}),{import: name=>{for(const base of ['.', 'node_modules','node_modules/@uniswap/v4-core/lib']){const file=path.join(base,name);if(fs.existsSync(file)){const contents=fs.readFileSync(file,'utf8');imported[name]={content:contents};return {contents};}}return{error:`Missing import ${name}`};}}));
 const errors=(output.errors||[]).filter(e=>e.severity==='error');if(errors.length)throw new Error(errors.map(e=>e.formattedMessage).join('\n'));
 fs.mkdirSync('artifacts',{recursive:true});const sizes={};
 if(!tests)fs.writeFileSync('artifacts/compiler-input.json',JSON.stringify({language:'Solidity',sources:{...sources,...imported},settings},null,2));
 for(const [source,contracts]of Object.entries(output.contracts))if(source.startsWith('contracts/'))for(const [name,artifact]of Object.entries(contracts))if(artifact.evm.bytecode.object){const size=artifact.evm.deployedBytecode.object.length/2;if(size>24576)throw new Error(`${name} exceeds EIP-170`);fs.writeFileSync(`artifacts/${name}.json`,JSON.stringify(artifact,null,2));sizes[name]=size;}
 fs.writeFileSync('artifacts/bytecode-sizes.json',JSON.stringify(sizes,null,2));return output.contracts;
}
if(import.meta.url===`file:///${process.argv[1]?.replaceAll('\\','/')}`)console.log(compile()&&'Contracts compiled');
