# Foundation deployment preparation

Status: unsigned preparation only — no Ethereum transaction signed or broadcast

## Validation completed

- Existing contract and opening-price suites: 21 tests passed, 0 failed
- Standalone compiler input reproduces all ten deployed contracts exactly
- Local rehearsal executes the ten-contract deployment and configuration sequence, including permanent single-sided liquidity
- Token allocation, historical holder scores, sealed exclusions, both pool currency orientations, fee routing, controller migration and the NFT #1000 reward transition are covered by the existing tests
- Public Ethereum constructor simulations for LiquidityBootstrap and ProjectToken succeeded using an artificial sender balance override

These checks are internal verification, not an independent security audit or legal review.

## Wallet observation

- Established deployer: 0x61aEFdAAa5FA9ac74AA0051238Fd4a37B1d24148
- Last observed balance: 0.001992772248826522 ETH
- Last observed pending nonce: 9
- Prior estimated cost for the first two deployments: 0.000452437234292987 ETH
- Observations and estimates become stale and must be refreshed before signing

## Execution constraints

1. LiquidityBootstrap constructor uses the ProjectToken address predicted for the immediately following wallet nonce
2. Do not send another transaction from the deployer between these deployments
3. If a deployment fails or the nonce changes, stop and regenerate the remaining plan before signing
4. An incoming ETH transfer does not consume the recipient wallet's nonce
5. The first two transactions do not initialize a trading pool or seed liquidity
6. The proposed later IMD factory deployments require an adapted deployment plan

## Outstanding mainnet launch gates

- Independent contract audit remains unapproved in deployment.json
- Specialist legal/regulatory review remains unapproved in deployment.json
- Independent artifact signer address is still unset for the later creation contracts
- Wallet signing must occur through the user's wallet; preparation scripts contain no deployer key
