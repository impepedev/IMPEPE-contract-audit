import fs from 'node:fs';
import { ContractFactory, getCreateAddress, formatEther, keccak256 } from 'ethers';

// Preparation only: no signer, private key, RPC writes or transaction broadcast.
const config = JSON.parse(fs.readFileSync('deployment.json', 'utf8'));
const observation = JSON.parse(fs.readFileSync('artifacts/mainnet-foundation-observation.json', 'utf8').replace(/^\uFEFF/, ''));
const result = id => observation.results.find(item => item.id === id)?.result;
if (config.chainId !== 1 || Number(BigInt(result(1))) !== 1) throw new Error('Ethereum mainnet required');
if (!result(2) || !result(3)) throw new Error('Missing wallet observation');
if (!result(4) || result(4) === '0x' || !result(5) || result(5) === '0x') throw new Error('External contract has no code');
if (!observation.imdDecimalsVerifiedAtUtc || Date.now()-Date.parse(observation.observedAtUtc)>300000 || observation.imdDecimals!==18) throw new Error('Fresh mainnet observation with verified IMD decimals required');
const admin = config.deployer.toLowerCase();
const nonce = Number(BigInt(result(2)));
const predicted = {
  LiquidityBootstrap: getCreateAddress({ from: admin, nonce }),
  ProjectToken: getCreateAddress({ from: admin, nonce: nonce + 1 }),
};
const definitions = [
  ['LiquidityBootstrap', [admin, config.poolManager, predicted.ProjectToken, config.imdAddress]],
  ['ProjectToken', [admin, predicted.LiquidityBootstrap]],
];
const transactions = [];
for (const [name, args] of definitions) {
  const artifact = JSON.parse(fs.readFileSync(`artifacts/${name}.json`, 'utf8'));
  const unsigned = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object).getDeployTransaction(...args);
  transactions.push({ label: `Deploy ${name}`, from: admin, chainId: 1, nonce: nonce + transactions.length, value: '0', data: unsigned.data, predictedAddress: predicted[name], constructorArguments: args, initCodeHash: keccak256(unsigned.data) });
}
const plan = {
  status: 'unsigned_preparation_only', observedAtUtc: observation.observedAtUtc,
  deployer: admin, walletBalanceEth: formatEther(BigInt(result(3))), predicted, transactions,
  launchGates: { auditApproved: config.auditApproved, legalReviewApproved: config.legalReviewApproved, legalReviewWaived: config.legalReviewWaived === true },
  constraints: [
    'Refresh pending nonce and rebuild immediately before signing',
    'No unrelated wallet transactions between vault and token deployments',
    'Abort and replan if the token nonce changes or either deployment fails',
    'External code presence is not verification of identity or bytecode',
    'No pool is initialized and no liquidity is seeded by these transactions',
    'This plan cannot replace the later swarm deployment compatibility and configuration plan',
  ],
};
fs.writeFileSync('artifacts/unsigned-foundation-plan.json', JSON.stringify(plan, null, 2));
console.log(JSON.stringify({ status: plan.status, observedAtUtc: plan.observedAtUtc, walletBalanceEth: plan.walletBalanceEth, predicted, nonces: transactions.map(tx => tx.nonce), launchGates: plan.launchGates }, null, 2));
