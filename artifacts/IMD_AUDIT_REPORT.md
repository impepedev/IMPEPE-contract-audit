# Audit report

> Audit the complete IMPEPE system at the pinned repository commit. Read AUDIT_SCOPE.md and THREAT_MODEL.md. Cover all ten deployed contracts, embedded SVGRenderer, cross-contract invariants, Uniswap v4 hook and permanent single-sided liquidity, fee/reward accounting and NFT #1000 transition, holder scoring/selection, independent artifact/finality/recovery signer, delayed migration, deployment/address prediction scripts and the supporting IMD/backend evidence and payment integration. Reproduce material findings with tests where feasible and report severity, source locations, impact, assumptions, remediation and uncovered areas. Do not modify implementation, deploy anything, or infer legal approval. Report the exact reviewed commit and hashes. Existing passing tests do not establish security approval.

| | |
|---|---|
| Repository | https://github.com/impepedev/IMPEPE-contract-audit.git |
| Commit | `cafc305e764f0300c8ddf9d70feea2113a58b913` |
| Job | `08bcbaac-7072-4084-a22f-9d810be7b388` |
| Judged | 2026-10-08 03:24 UTC |
| Findings | 3 medium · 7 low · 8 info |

Four agents audited the code as it is at `cafc305`, each in one area (math, permissions, economics, control flow),
and a judge reproduced, merged and ranked what they found, then read the code once more itself. Nothing in the repository was changed or deployed.

## Findings

### 1. Medium: Hook permanently halts the only official market if Uniswap governance sets any protocol fee on the pool

`contracts/IMPEPEHook.sol:144`

```
        require(protocolFee == 0, "additional pool protocol fee unsupported");
```

beforeSwap reads slot0.protocolFee for the official pool and reverts when it is non-zero. The protocol fee is set per pool by the PoolManager's protocolFeeController (Uniswap governance), up to 0.1% per direction, and nothing in this system can clear it: the hook is immutable, the 980M-token position can never be removed (beforeRemoveLiquidity always reverts), the hook refuses to initialize any other pool and the vault cannot be reconfigured. One external governance action therefore stops every buy and sell through the IMPEPE/IMD market forever, ending creation funding, protocol fees and all exits via the official pool. README/THREAT_MODEL mention the halt but present it as unavoidable; it is not needed for correctness. With key.fee == 0 the PoolManager carves the protocol fee out of the pool's own input-side accounting, the swapper's input delta still equals amountSpecified, afterSwap's full-fill check (actualInput == gross - 4%) still holds and the hook's 4% IMD claims are unchanged; the only effect of tolerating the fee is up to 0.1% less IMD reaching the locked position. Verified: the attached proof fails on the current code and passes against a copy of the hook with lines 143-144 removed (all other behaviour identical). Merged from three specialist reports (economics, flow, permissions). Remediation: delete the protocolFee read and require, or replace the revert with an event; if the project insists on rejecting protocol fees, document that this is a permanent, unrecoverable kill switch held by a third party.

**Reproduction**

Foundry (real PoolManager, hook mined at permission address 0x2ACC, vault seeded at tick +/-138180): trader buys 100 IMD worth via IMPEPESwapRouter.swapExactInput (succeeds). manager.setProtocolFeeController(admin); manager.setProtocolFee(key, MAX_PROTOCOL_FEE | MAX_PROTOCOL_FEE << 12). Expected: the next swapExactInput(key, buyDirection, 100e18, 1, deadline) executes with the protocol fee deducted by the PoolManager. Actual: it reverts with WrappedError wrapping Error('additional pool protocol fee unsupported') from beforeSwap, and so does every later swap in either direction; no admin, vault or operator function can restore trading. Reproduced with .imd proof Proof_31432592641c (fails) and in test/scratch/Repro.t.sol test_ProtocolFeeHaltsSwaps (sell direction also reverts). The same proof passes against a copy of IMPEPEHook with the require removed.

**Proof**: a Foundry test that fails on this code and passes once it is fixed.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ProtocolFeeLibrary} from "@uniswap/v4-core/src/libraries/ProtocolFeeLibrary.sol";
import {ProjectToken} from "contracts/ProjectToken.sol";
import {LiquidityBootstrap} from "contracts/LiquidityBootstrap.sol";
import {SwarmCollection} from "contracts/SwarmCollection.sol";
import {RewardsDistributor, IRewardCollection} from "contracts/RewardsDistributor.sol";
import {CreationController, IArtifactVerifier} from "contracts/CreationController.sol";
import {FeeRouter} from "contracts/FeeRouter.sol";
import {IMPEPEHook} from "contracts/IMPEPEHook.sol";
import {IMPEPESwapRouter} from "contracts/IMPEPESwapRouter.sol";

contract MockIMD is ERC20 {
    constructor() ERC20("IMD", "IMD") { _mint(msg.sender, 1e30); }
}
contract StubVerifier {
    address public constant attestor = address(0x1234);
    function verify(uint256, bytes32, bytes32, bytes calldata) external pure returns (bool) { return true; }
    function verifyFinality(uint256, bytes calldata) external pure returns (bool) { return true; }
    function verifyRecovery(uint256, bytes32, uint256, uint256, address, bytes calldata) external pure returns (bool) { return true; }
}

/// Finding: IMPEPEHook.beforeSwap reverts whenever the PoolManager protocol fee for this pool is non-zero.
/// Uniswap governance (the protocol fee controller) can enable a protocol fee on any pool at any time. The
/// vault's liquidity is permanently locked and the hook is immutable, so the official IMPEPE/IMD market is
/// then dead forever. This test fails on the current code (swap reverts) and passes once the hook tolerates
/// a non-zero protocol fee.
contract ProtocolFeeHaltTest is Test {
    address admin = address(this);
    address operator = address(0xA11CE);
    address trader = address(0xBEEF);
    PoolManager manager;
    MockIMD imd;
    ProjectToken token;
    LiquidityBootstrap vault;
    IMPEPEHook hook;
    IMPEPESwapRouter swapRouter;
    PoolKey key;

    function setUp() public {
        manager = new PoolManager(admin);
        imd = new MockIMD();
        // Compute the vault address (next create from this contract) so the token can mint to it.
        uint64 nonce = vm.getNonce(address(this));
        address predictedVault = vm.computeCreateAddress(address(this), nonce + 1);
        token = new ProjectToken(admin, predictedVault);
        vault = new LiquidityBootstrap(admin, IPoolManager(address(manager)), token, imd);
        require(address(vault) == predictedVault, "prediction");
        SwarmCollection nft = new SwarmCollection(admin);
        RewardsDistributor rewards = new RewardsDistributor(imd, IRewardCollection(address(nft)));
        StubVerifier verifier = new StubVerifier();
        CreationController controller = new CreationController(
            admin, imd, token, nft, IArtifactVerifier(address(verifier)), operator, operator, 0.5 ether, 2, bytes32(uint256(1))
        );
        FeeRouter feeRouter = new FeeRouter(admin, imd, controller, rewards, admin);
        controller.configureRouter(address(feeRouter));
        nft.configure(address(controller), address(rewards));
        // Deploy the hook at an address carrying exactly the permission bits it declares (0x2ACC).
        bytes memory initCode = abi.encodePacked(
            type(IMPEPEHook).creationCode,
            abi.encode(IPoolManager(address(manager)), address(imd), address(token), feeRouter, int24(60), address(vault))
        );
        bytes32 initHash = keccak256(initCode);
        bytes32 salt;
        address target;
        for (uint256 i; ; i++) {
            salt = bytes32(i);
            target = vm.computeCreate2Address(salt, initHash, address(this));
            if (uint160(target) & 0x3FFF == 0x2ACC) break;
        }
        assembly { target := create2(0, add(initCode, 32), mload(initCode), salt) }
        hook = IMPEPEHook(payable(target));
        feeRouter.configureHook(address(hook));
        swapRouter = new IMPEPESwapRouter(IPoolManager(address(manager)), hook);
        bool imdFirst = address(imd) < address(token);
        key = PoolKey(
            Currency.wrap(imdFirst ? address(imd) : address(token)),
            Currency.wrap(imdFirst ? address(token) : address(imd)),
            0,
            60,
            IHooks(address(hook))
        );
        address[7] memory excluded = [admin, operator, address(vault), address(manager), address(controller), address(feeRouter), address(rewards)];
        for (uint256 i; i < excluded.length; i++) token.setExcluded(excluded[i], true);
        token.sealEligibility();
        vault.configure(key, imdFirst ? int24(138180) : int24(-138180));
        vault.seed();
        imd.transfer(trader, 1_000 ether);
        vm.prank(trader);
        imd.approve(address(swapRouter), type(uint256).max);
    }

    function testSwapsSurviveProtocolFeeEnablement() public {
        bool buyZeroForOne = Currency.unwrap(key.currency0) == address(imd);
        // Baseline: a buy works before any protocol fee exists.
        vm.prank(trader);
        uint256 out1 = swapRouter.swapExactInput(key, buyZeroForOne, 100 ether, 1, block.timestamp + 1);
        assertGt(out1, 0, "baseline buy");

        // Uniswap governance enables the maximum protocol fee (0.1% per direction) on this pool.
        manager.setProtocolFeeController(admin);
        uint24 fee = ProtocolFeeLibrary.MAX_PROTOCOL_FEE | (uint24(ProtocolFeeLibrary.MAX_PROTOCOL_FEE) << 12);
        manager.setProtocolFee(key, fee);

        // Expected: the market keeps trading (fee is deducted by the PoolManager; hook fee logic is unaffected).
        // Actual on current code: IMPEPEHook.beforeSwap reverts "additional pool protocol fee unsupported" and
        // no swap can ever succeed again because the hook is immutable and the position cannot be withdrawn.
        vm.prank(trader);
        uint256 out2 = swapRouter.swapExactInput(key, buyZeroForOne, 100 ether, 1, block.timestamp + 1);
        assertGt(out2, 0, "market must stay alive after governance protocol fee");
    }
}
```

### 2. Medium: Holder registry spam: a one-time 1-wei transfer permanently adds about 21k gas of scan work to every one of the 1000 recipient selections

`contracts/ProjectToken.sol:69`

```
        if (!known[account] && balanceOf(account) > 0) {
```

ProjectToken._checkpoint registers any address the first time its balance becomes positive, with no minimum amount and no pruning, and CreationController.scan (line 411) must visit every holder registered before the cutoff for every job: token.holders(i), token.excluded(), allocated() (chaining through up to 8 predecessor controllers after migrations) and token.scoreAt(). The 250-per-call batch bounds a transaction, not total work. Measured in this review (forge, real PoolManager, optimizer 200 runs): registering one fresh dust address costs the attacker 209,987 gas once; each registered candidate then costs the keeper 20,765 gas in every job's scan (scan(250) = 5,191,475 gas), for all remaining jobs, so the lifetime amplification approaches 100x. Example: 50,000 dust addresses cost about 10.5G gas once (about 10.5 ETH at 1 gwei) and add about 1.04G gas per job (35 full 30M blocks, about 400 of the worker's scan(125) transactions), i.e. about 1,040 ETH of keeper gas over 1000 jobs at 1 gwei; at 100,000 addresses the keeper role becomes economically infeasible and creation stalls with no privileged action involved. The same cost curve applies to organic growth (20,000 holders -> about 415M gas per job). Nothing on-chain pays the scanner. THREAT_MODEL item 3 acknowledges keeper-cost spam as an open benchmark item; no code mitigation exists. Merged from three specialist reports. Remediation requires a scope decision that preserves the ranking rules: register an address in holders only once its balance reaches a minimum threshold (checkpoints and scoring unchanged, so eligibility semantics for real holders are preserved), and/or bound per-job work with an optimistic claim model (anyone submits a candidate during a challenge window after finality; scan compares candidates via scoreAt; best after the window wins), keeping tie-break, exclusions and one-allocation rules.

**Reproduction**

test/scratch/Repro.t.sol test_HolderSpamScanCost: alice buys 1 IMD of IMPEPE via IMPEPESwapRouter; warp 1 day; alice transfers 1 wei to 250 fresh addresses 0x10000..0x100F9 (measured 209,987 gas each); bob buys 20 IMD so creation funding crosses 0.5 IMD; openNextJob(); roll settlementBlocks+1; confirmFinality(''); holderCountAt(cutoff) == 255; scan(250) consumes 5,191,475 gas (20,765 per candidate), none of the 250 dust addresses can win, and a second scan(250) is needed to select alice. Expected: per-job selection work independent of worthless registrations. Actual: O(holderCountAt(cutoff)) external calls per job, repeated for every later job, permanently inflated by anyone who sends 1 wei to new addresses.

### 3. Medium: LiquidityBootstrap.configure is one-shot but validates neither the hook link nor that seed() can succeed; one wrong input permanently strands the 980M allocation

`contracts/LiquidityBootstrap.sol:53`

```
                address(officialKey.hooks).code.length > 0,
```

configure() checks only fee == 0, tickSpacing > 0, that officialKey.hooks has code, the currency pair and that startTick is spacing-aligned and strictly inside the usable range, then sets configured = true (line 71) with no reset path. It does not verify that the hook is the IMPEPEHook bound to this vault (IMPEPEHook.liquidityOwner() == address(this), .spacing() == tickSpacing, .imd()/.project() match) nor does it evaluate the conditions seed() later imposes: derived liquidity > 0 and <= type(uint128).max (line 90), PoolManager's per-tick liquidity cap, rounding dust <= 1e12 (lines 98-101) and manager.initialize succeeding (the hook's check() rejects any key not matching the deployed hook; the PoolManager rejects a hooks address without the right permission bits). After one mistaken configure() the vault, which has no transfer, sweep, reconfigure or upgrade path, holds 980,000,000 IMPEPE (98% of the fixed supply) forever with no pool, and the immutable token and everything referencing it must be redeployed. Two concrete failing inputs were reproduced: (1) hooks = any deployed contract that is not this vault's hook (e.g. the HookFactory address) -> seed() reverts forever in PoolManager.initialize and configure() reverts 'configuration' on retry; (2) tick -600000 with IMD as currency0 -> configure() accepts, seed() reverts 'liquidity range' forever (liquidity about 1.05e40). The planner (scripts/opening-price.mjs) does not pre-check seedability either: openingPrice({targetOpeningFdvImd:'1e-20',...}) returns -667800 without error (verified). This is a deployment-time hazard (owner action, no attacker), rated medium because the outcome is total and irreversible while the asymmetry is striking: SwarmCollection.configure and FeeRouter's constructor verify their cross-links, the contract custodying the most value verifies nothing. Merged from four specialist reports. Remediation (keeps the one-time seed design): in configure() require IMPEPEHook(address(officialKey.hooks)).liquidityOwner() == address(this) && .spacing() == officialKey.tickSpacing && .imd() == address(imd) && .project() == address(token), compute the same liquidity/amounts seed() will use and revert on anything seed() would reject; and/or replace '!configured' with 'positionLiquidity == 0' so configuration can be corrected until the position actually exists.

**Reproduction**

Foundry: deploy PoolManager, IMD, vault (predicting the token address), ProjectToken(admin, vault); sealEligibility(); deploy a plain contract NotTheHook; configure({currency0,currency1 ordered, fee 0, spacing 60, hooks: NotTheHook}, +/-138180) succeeds; seed() reverts (PoolManager HookAddressNotValid); configure(key, tick) again reverts 'configuration'; token.balanceOf(vault) == 980_000_000e18 with no function able to move it. Expected: configure rejects a hook that is not this vault's IMPEPEHook or stays correctable until positionLiquidity > 0. Actual: accepted and irreversible. Reproduced with .imd proofs Proof_f00da034a797 (wrong hook, fails 'configuration') and Proof_f6e320664d4b (tick -600000 with IMD as currency0: configure accepted, seed reverts 'liquidity range', reconfigure reverts 'configuration'). The attached proof passes once configure validates the hook link or stays callable while positionLiquidity == 0.

**Proof**: a Foundry test that fails on this code and passes once it is fixed.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ProjectToken} from "contracts/ProjectToken.sol";
import {LiquidityBootstrap} from "contracts/LiquidityBootstrap.sol";

contract MockIMD is ERC20 {
    constructor() ERC20("IMD", "IMD") { _mint(msg.sender, 1e30); }
}
contract NotTheHook {}

/// LiquidityBootstrap.configure() is a one-shot setter that only checks `hooks.code.length > 0`.
/// If the recorded key cannot initialize the pool, seed() can never succeed and configure()
/// can never be called again: the entire 980,000,000 token allocation is locked in the vault
/// with no pool. Expected: a key that cannot seed is rejected, or configuration stays
/// re-doable until the position exists. Actual: permanent brick after one wrong call.
contract VaultConfigBrickTest is Test {
    address admin = address(0xAD);

    function testWrongHookBricksTheVaultForever() public {
        vm.startPrank(admin);
        PoolManager manager = new PoolManager(admin);
        MockIMD imd = new MockIMD();
        // vault address is predicted as the next deployment
        address predictedVault = vm.computeCreateAddress(admin, vm.getNonce(admin) + 1);
        ProjectToken token = new ProjectToken(admin, predictedVault);
        LiquidityBootstrap vault = new LiquidityBootstrap(admin, IPoolManager(address(manager)), IERC20(address(token)), IERC20(address(imd)));
        assertEq(address(vault), predictedVault);
        assertEq(token.balanceOf(address(vault)), 980_000_000 ether);
        token.sealEligibility();

        NotTheHook wrong = new NotTheHook(); // has code, but is not a valid v4 hook for this pool
        (address a, address b) = address(token) < address(imd) ? (address(token), address(imd)) : (address(imd), address(token));
        PoolKey memory key = PoolKey(Currency.wrap(a), Currency.wrap(b), 0, 60, IHooks(address(wrong)));
        int24 tick = a == address(token) ? int24(-138180) : int24(138180);

        // A fix that validates the hook link in configure() rejects this key here: acceptable.
        try vault.configure(key, tick) {} catch { vm.stopPrank(); return; }
        // Current code accepts it (only hooks.code.length > 0 is checked) ...
        vm.expectRevert();
        vault.seed(); // ... and PoolManager rejects the hook address, so seeding can never succeed.

        // Expected: the admin can still correct the configuration while no position exists.
        // Actual: configure() is permanently sealed and the 98% allocation is stranded.
        vault.configure(key, tick);
        assertEq(vault.positionLiquidity(), 0);
        vm.stopPrank();
    }
}
```

### 4. Low: ProjectToken constructor mints the 980M liquidity allocation to an unverified predicted address; a deployer nonce slip silently strands 98% of supply

`contracts/ProjectToken.sol:22`

```
        require(publicAllocation != address(0) && publicAllocation != admin, "configuration");
```

The deployment plan deploys LiquidityBootstrap at nonce n with the ProjectToken address predicted for n+1, then ProjectToken at n+1 with publicAllocation = address predicted for n (scripts/deployment-plan.mjs lines 17-20). The only on-chain checks are publicAllocation != 0 and != admin. If the observed nonce is stale by any amount when the established wallet signs (any transaction sent from the deployer between planning and signing, including a failed one), the vault deploys at nonce m storing a token address that will never hold the token, and the token deploys at m+1 minting 980,000,000 IMPEPE to predicted(n), an address with no code and no key. Nothing reverts; the loss only surfaces when seed() later fails its balance check, and the token must be abandoned. artifacts/foundation-predeployment-check.md documents the nonce dependency operationally, and the vault already exists when the token's constructor runs, so the pairing can be enforced on-chain at negligible cost. Rated low because it requires an operator mistake and the predeployment check covers it; the on-chain guard converts a silent irreversible loss into a reverted deployment. Merged from two specialist reports (flow low, permissions medium). Note the fix changes the test fixture, which currently passes an EOA as publicAllocation. Remediation: require(publicAllocation.code.length > 0 && address(LiquidityBootstrap(publicAllocation).token()) == address(this), 'vault link') in the constructor (or an equivalent minimal interface), or mint the allocation to the token itself and let the vault pull it in configure().

**Reproduction**

Input: new ProjectToken(admin, X) where X has no code (the address an extra deployer transaction shifted the prediction to). Expected: revert so the deployer regenerates the plan. Actual: deployment succeeds, balanceOf(X) == 980_000_000e18, totalSupply() == 1e27 and no function can move those tokens; LiquidityBootstrap.seed() can never reach POOL_ALLOCATION. Reproduced with .imd proof Proof_dba6e2390a6e (fails: 'next call did not revert as expected'); it passes once the constructor verifies the vault link, because the call to a codeless address reverts.

**Proof**: a Foundry test that fails on this code and passes once it is fixed.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "forge-std/Test.sol";
import {ProjectToken} from "contracts/ProjectToken.sol";

/// Deployment relies on a nonce prediction: ProjectToken's `publicAllocation` must be the
/// LiquidityBootstrap deployed one nonce earlier. If the prediction is wrong (any extra
/// transaction from the deployer), the constructor still mints 980,000,000 tokens to an
/// address with no code, and there is no mint/recovery path afterwards.
contract GenesisMintTargetTest is Test {
    address constant ADMIN = address(0xA11CE);

    function testGenesisMintToCodelessAddressReverts() public {
        // A mis-predicted vault address: an EOA / never-deployed address with no code.
        address mispredicted = address(0xBEEF);
        assertEq(mispredicted.code.length, 0);
        // Expected: the constructor refuses to mint the 98% allocation to a codeless address.
        // Actual (current code): the deployment succeeds and the tokens are stranded forever.
        vm.expectRevert();
        new ProjectToken(ADMIN, mispredicted);
    }
}
```

### 5. Low: openNextJob rewinds every subsequent job to a snapshot already proven empty, forcing repeated finality attestations and full rescans

`contracts/CreationController.sol:324`

```
            if (funding(mid).cumulative < id * jobBudget) lo = mid + 1;
```

openNextJob always binary-searches from funding index 0 for the earliest checkpoint whose cumulative amount covers id * jobBudget. When one deposit covers several budgets while its block has no eligible holder (for example the first large buy before any unexcluded wallet exists, or after every eligible wallet at that block has been allocated), job N is advanced by advanceEmptySnapshot to the earliest later funding block and minted, but job N+1 is opened at the same old block again because its threshold is also met at index 0. Holders at a past block and the sealed exclusions are fixed and allocated only grows, so a snapshot proven empty for job N is provably empty for every later job, yet each later job must obtain a new finality attestation for the old block, run a complete scan over every registered holder (see the holder-spam finding), call advanceEmptySnapshot, obtain a second attestation and scan again before progressing. With a single deposit covering k budgets this repeats k times (60 times for a 30 IMD deposit), multiplying scan work and attestor dependency. Remediation: start the search in openNextJob at fundingIndex[id - 1] instead of 0. This cannot skip a non-empty snapshot: every index below fundingIndex[id - 1] was either proven empty or shares the block of one that was (advanceEmptySnapshot only moves to the earliest strictly later block). Verified: the attached proof fails on the current code and passes against a copy of the controller with 'uint256 lo = id > 1 ? fundingIndex[id - 1] : 0;'.

**Reproduction**

test/scratch/Repro.t.sol test_OpenNextJobRewindsToProvenEmptySnapshot and the attached proof: no eligible holder exists (only excluded genesis holders); FeeRouter deposit of 30 IMD at block B (60 budgets); openNextJob -> jobs(1).cutoff == B; confirmFinality; scan(250) -> winner 0; transfer 100 tokens to alice; deposit 0.03 IMD at block L > B; advanceEmptySnapshot -> cutoff L; confirmFinality; scan -> alice; payJob; bindRequest; submit (#1 minted to alice). openNextJob for job 2. Expected: cutoff >= L. Actual: jobs(2).cutoff == B; after confirmFinality and a full scan the winner is again 0 and advanceEmptySnapshot is needed again, costing two extra attestations and one full extra scan per job.

**Proof**: a Foundry test that fails on this code and passes once it is fixed.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ProjectToken} from "contracts/ProjectToken.sol";
import {SwarmCollection} from "contracts/SwarmCollection.sol";
import {RewardsDistributor, IRewardCollection} from "contracts/RewardsDistributor.sol";
import {CreationController, IArtifactVerifier} from "contracts/CreationController.sol";
import {FeeRouter} from "contracts/FeeRouter.sol";

contract MockIMD is ERC20 {
    constructor() ERC20("IMD", "IMD") { _mint(msg.sender, 1e30); }
}
contract StubVerifier {
    address public constant attestor = address(0x1234);
    function verify(uint256, bytes32, bytes32, bytes calldata) external pure returns (bool) { return true; }
    function verifyFinality(uint256, bytes calldata) external pure returns (bool) { return true; }
    function verifyRecovery(uint256, bytes32, uint256, uint256, address, bytes calldata) external pure returns (bool) { return true; }
}
/// Stands in for IMPEPEHook: the only caller FeeRouter accepts for fee settlement.
contract StubHook {
    function approve(ERC20 imd, address router) external { imd.approve(router, type(uint256).max); }
    function flush(FeeRouter router, uint256 allocation, uint256 protocol) external { router.routeAmounts(allocation, protocol); }
}

/// Finding: CreationController.openNextJob always binary-searches from funding index 0, so when one
/// deposit covers several budgets and its snapshot block was fully scanned and proven empty for job N,
/// job N+1 is opened at that same proven-empty block again. Every later job then needs a new finality
/// attestation, a complete rescan of every registered holder, advanceEmptySnapshot, a second attestation
/// and a second scan before any progress. Expected: job N+1 opens at the earliest funding checkpoint that
/// can contain an eligible holder (the block job N was actually selected from, or later). Actual: the
/// cutoff rewinds to the empty block. Fails on current code; passes when openNextJob starts its search at
/// fundingIndex[id - 1].
contract OpenNextJobRewindTest is Test {
    address admin = address(this);
    address operator = address(0xA11CE);
    address alice = address(0xA1);
    MockIMD imd;
    ProjectToken token;
    SwarmCollection nft;
    RewardsDistributor rewards;
    CreationController controller;
    FeeRouter feeRouter;
    StubHook hook;
    bytes baseArt;

    function setUp() public {
        imd = new MockIMD();
        token = new ProjectToken(admin, address(0xDEAD));
        nft = new SwarmCollection(admin);
        rewards = new RewardsDistributor(imd, IRewardCollection(address(nft)));
        StubVerifier verifier = new StubVerifier();
        baseArt = new bytes(300);
        for (uint256 i; i < 300; i++) baseArt[i] = bytes1(uint8(1));
        controller = new CreationController(
            admin, imd, token, nft, IArtifactVerifier(address(verifier)), operator, operator, 0.5 ether, 2, sha256(baseArt)
        );
        feeRouter = new FeeRouter(admin, imd, controller, rewards, admin);
        controller.configureRouter(address(feeRouter));
        nft.configure(address(controller), address(rewards));
        hook = new StubHook();
        hook.approve(imd, address(feeRouter));
        feeRouter.configureHook(address(hook));
        token.setExcluded(admin, true);
        token.setExcluded(address(0xDEAD), true);
        token.sealEligibility();
    }

    function deposit(uint256 allocation, uint256 protocol) internal {
        imd.transfer(address(hook), allocation + protocol);
        hook.flush(feeRouter, allocation, protocol);
    }
    function step(uint256 blocks) internal {
        vm.roll(block.number + blocks);
        vm.warp(block.timestamp + blocks * 12);
    }
    function settleAndScan() internal {
        step(3);
        controller.confirmFinality("");
        controller.scan(250);
    }

    function testNextJobDoesNotRewindToProvenEmptySnapshot() public {
        // One deposit covering 60 budgets lands at block B while no eligible holder exists.
        deposit(30 ether, 10 ether);
        uint256 B = block.number;
        controller.openNextJob();
        assertEq(controller.jobs(1).cutoff, B);
        settleAndScan();
        assertEq(controller.jobs(1).winner, address(0), "snapshot B proven empty");
        // alice becomes the only eligible holder; a later deposit at block L creates a later snapshot.
        step(1);
        token.transfer(alice, 100 ether);
        step(1);
        deposit(0.03 ether, 0.01 ether);
        uint256 L = block.number;
        controller.advanceEmptySnapshot();
        assertEq(controller.jobs(1).cutoff, L);
        settleAndScan();
        assertEq(controller.jobs(1).winner, alice);
        vm.startPrank(operator);
        controller.payJob();
        controller.bindRequest(keccak256("job-1"));
        controller.submit(baseArt, 0, 0, "");
        vm.stopPrank();
        assertEq(nft.ownerOf(1), alice);

        // Job 2: the cumulative budget was already met at index 0 (block B), which is proven empty.
        controller.openNextJob();
        uint256 cutoff = controller.jobs(2).cutoff;
        assertTrue(cutoff >= L, "job 2 must not rewind to the proven-empty snapshot block");
    }
}
```

### 6. Low: FeeRouter.configureHook is a one-shot setter that does not verify the hook points back to this router; a wrong value bricks fee settlement and every fee-bearing IMPEPESwapRouter trade

`contracts/FeeRouter.sol:66`

```
        require(hook == address(0) && value.code.length > 0, "hook");
```

configureHook only checks that the value has code. IMPEPEHook.router is immutable and the hook approves and pulls fees only against that router, so the correct value is uniquely determined and can be verified on-chain. If any other contract is configured, routeAmounts()/route() revert 'hook' for the real hook forever (no re-configuration), which (a) makes every IMPEPESwapRouter.swapExactInput with fee > 0 revert because it calls hook.flushFees() after settlement, and (b) leaves fees from external v4 routers stuck as unflushable ERC-6909 claims in the hook, so creation is never funded. The deployment plan supplies the right address; the hazard is the same deployment-time asymmetry as the vault finding (SwarmCollection.configure verifies reciprocal links, this setter does not). Remediation: add a minimal interface and require(IHookLink(value).router() == address(this), 'hook') (FeeRouter cannot import IMPEPEHook directly because IMPEPEHook imports FeeRouter).

**Reproduction**

test/scratch/Repro.t.sol WrongHookLinkTest: full deployment with feeRouter.configureHook(address(new NotTheHook())) instead of the real hook, pool seeded. alice swapExactInput(key, buy, 1e18, 0, deadline) reverts (flushFees -> routeAmounts 'hook'); feeRouter.configureHook(realHook) reverts 'hook'; a 24 wei buy (fee rounds to 0) still succeeds, showing the pool is fine and only fee settlement is dead. Expected: configureHook rejects a contract whose router() is not this FeeRouter. Actual: accepted and irreversible.

### 7. Low: SVGRenderer.render concatenates with O(n^2) abi.encodePacked copies; an 8-frame tokenURI costs about 22.9M gas

`contracts/SVGRenderer.sol:23`

```
            output = abi.encodePacked(
```

Each of the 100 cells re-copies the entire accumulated output buffer, and for animated art the inner loop re-copies the values string up to 9 times per cell, so memory expansion is quadratic. Measured in this review: SwarmCollection.tokenURI for a maximal 8-frame (2400-byte) artwork consumes 22,925,127 gas and returns a 41,693-byte URI; a static token costs 2,453,509 gas. This is below geth's 50M default rpc.gascap, so the specialists' claim that it exceeds common caps is not demonstrated, but it is close to a full block of execution for a view call, above the 25M-30M eth_call limits some commercial RPCs and indexers apply and far above what wallets budget for metadata reads, so the NFT's only image source can fail to render on some viewers for exactly the most valuable animated late-progression and #1000 pieces; the backend /api/art/:id.svg route depends on the same eth_call. Remediation: render into a pre-sized bytes buffer written in place (fixed header + per-cell template + 7 bytes per colour), producing byte-identical SVG output.

**Reproduction**

test/scratch/Repro.t.sol test_SvgGasAndSmilTiming: mint job 1 with the static base art and job 2 with art = 2400 bytes (art[i] = uint8(i*7)), durationMs 20000, effect 13 via CreationController.submit; measure gasleft() around nft.tokenURI(2): 22,925,127 gas, output length 41,693 bytes; nft.tokenURI(1) (static): 2,453,509 gas. Expected: a view call comfortably under common eth_call caps. Actual: about 23M gas for every 8-frame token.

### 8. Low: SVGRenderer appends frame 0 a second time to the SMIL values list, so each frame shows for durationMs/(frames+1) and frame 0 is displayed twice as long

`contracts/SVGRenderer.sol:42`

```
                values = abi.encodePacked(values, ";", color(art, cell * 3));
```

For multi-frame art the renderer emits <animate attributeName="fill" values="f0;f1;...;f(n-1);f0" dur="<durationMs>ms" repeatCount="indefinite" calcMode="discrete"/>. With calcMode=discrete and no keyTimes, SMIL holds each of the n+1 listed values for dur/(n+1), so the trailing f0 is an extra time slot rather than a return-to-start marker: every frame is displayed for durationMs/(frames+1) instead of durationMs/frames and, because the cycle restarts on f0, the first frame is displayed for 2*durationMs/(frames+1) contiguously. The attestor signs durationMs and effect as the animation metadata, and the renderer is embedded in the immutable collection, so every animated NFT's on-chain rendering disagrees with its committed timing. No funds are affected. Fix: drop the trailing color(art, cell*3) append (the loop already restarts at f0), or document that a cycle has frames+1 slots and size durationMs accordingly.

**Reproduction**

test/scratch/Repro.t.sol test_SvgGasAndSmilTiming: SVGRenderer.render(art, 2000) with art of 600 bytes where bytes 0-299 are 0x11 and bytes 300-599 are 0x22 produces for each cell: <animate attributeName="fill" values="#111111;#222222;#111111" dur="2000ms" repeatCount="indefinite" calcMode="discrete"/>. Expected per the 2-frame/2000ms metadata: #111111 for 1000 ms then #222222 for 1000 ms. Actual SMIL timing: three 666.7 ms slots, i.e. #111111 for 1333 ms and #222222 for 667 ms per cycle; with 8 frames and 20000 ms each frame gets 2222 ms instead of 2500 ms and frame 0 gets 4444 ms.

### 9. Low: Single-step Ownable everywhere; renouncing or mis-transferring ProjectToken ownership before sealEligibility permanently prevents seeding and fee deposits

`contracts/ProjectToken.sol:31`

```
    function sealEligibility() external onlyOwner {
```

All five owned contracts use OpenZeppelin Ownable with single-step transferOwnership and renounceOwnership available. The setup sequence has hard dependencies on ownership surviving until specific one-time calls: LiquidityBootstrap.seed() requires ProjectToken.eligibilitySealed() (line 79) and CreationController.deposit() requires it too, so if ProjectToken ownership is renounced or transferred to an inaccessible address before sealEligibility(), the pool can never be seeded and fee routing can never deposit; the 980M allocation then sits in the vault forever. For CreationController and FeeRouter, loss of ownership removes the only emergency/migration path. The tests exercise transferOwnership on CreationController but never a lost-owner or renounce path. Operator-mistake class; rated low. Remediation: use Ownable2Step for the owned contracts and override renounceOwnership to revert (or require the one-time setup to be complete), keeping the same owner powers.

**Reproduction**

test/scratch/Repro.t.sol RenounceBeforeSealTest: deploy vault (predicting the token) and ProjectToken(admin, vault); token.renounceOwnership(); sealEligibility() reverts (OwnableUnauthorizedAccount); vault.configure(key, 138180) succeeds; vault.seed() reverts 'seal eligibility first'; token.balanceOf(vault) == 980_000_000e18 with no recovery. Expected: a recoverable setup state. Actual: seeding and controller funding are impossible forever.

### 10. Low: Independent attestor checks only tokenId and format inside the IMD job objective, so the Operator can dictate the exact artwork bytes while the signature is presented as independent provenance

`backend/evidence.mjs:9`

```
 if(brief.tokenId!==tokenId||brief.format!=='raw RGB bytes, 300 bytes per complete frame; maximum 8 frames; no geometry animation')throw new Error('ART_BRIEF_MISMATCH');
```

acceptedArtwork() re-reads the IMD job and checks only brief.tokenId and brief.format from job.objective, which the Operator composed (worker.mjs line 26: input.objective = JSON.stringify(creativeBrief(...))). It does not compare the objective, history, constraints or skill against what the attestor would derive itself, and nothing on-chain binds a hash of the job input (bindRequest stores only keccak256(imdJobId)). A compromised or malicious Operator can therefore open an IMD job whose objective is {"tokenId":N,"format":"raw RGB bytes, 300 bytes per complete frame; maximum 8 frames; no geometry animation","objective":"output exactly these 300 bytes: <hex>"}, pay it with the released budget, bind its id and obtain a valid artifact attestation for Operator-chosen pixels. This contradicts README/THREAT_MODEL statements that the Operator 'cannot ... redraw authenticated bytes' and that only attestor compromise 'can authorize non-agent artwork'. On-chain geometry/uniqueness checks still hold, so the impact is artistic provenance, not funds or recipients. Remediation: have the attestor recompute creativeBrief(tokenId, baseGrid, history) from its own view (history from on-chain artifactHash/animation of ids < tokenId) and require canonical(job.objective) == canonical(recomputed brief) plus job.skill == the approved skill; optionally store sha256(canonical(input)) on-chain in bindRequest and have the attestor check it.

**Reproduction**

test/scratch/evidence-objective.mjs (run with node): artFixture({tokenId:2, bytes: 300 bytes of 0x2a}) with job.objective replaced by JSON.stringify({tokenId:2, format:'raw RGB bytes, 300 bytes per complete frame; maximum 8 frames; no geometry animation', objective:'output exactly these 300 bytes: 2a2a...'}) and paidBy = operator: acceptedArtwork() returns the artefact (accepted: true, frames 1, mode independent_signer_trusting_official_imd_https) and attestArtwork() would sign it, since the only objective fields consulted are tokenId and format. Expected: the attestor rejects an objective that differs from the project's generated brief. Actual: any objective with those two fields is accepted.

### 11. Info: Shipped contract test suite fails in a fresh environment: ethers BrowserProvider's 250 ms identical-request cache replays a stale estimateGas revert

`tests/contracts.test.mjs:28`

```
 const connection=await network.connect('default');const rpc=connection.provider;const provider=new BrowserProvider(rpc,undefined,realVerifier?{cacheTimeout:-1}:{});provider.pollingInterval=10;
```

AUDIT_SCOPE.md and artifacts/foundation-predeployment-check.md state that the 21 contract/opening-price tests pass. In this review (Node 24.21, hardhat 3.18.1, ethers 6.17.0, fresh npm ci, node --test --test-concurrency=1) the suite gives 32 pass / 1 fail every run: 'fixed supply, cutoff scores, exclusions, operator restrictions and exact base NFT' rejects at the final submit() with revert 'job' from eth_estimateGas, although on-chain the job is selected, paid and bound. Cause: ethers AbstractProvider caches identical perform requests for cacheTimeout = 250 ms; the submit estimateGas issued at line 154 (which legitimately reverted 'job' before payment) is served again for the identical calls at lines 156-157 when payJob/bindRequest/setAccepted complete within 250 ms. Only the realVerifier fixture disables the cache. Verified: a copy of the test with {cacheTimeout:-1} for every fixture passes, the original fails in isolation as well. Consequences: the documented green suite and the gas.firstMint benchmark are not reproducible as committed, and the 'artifact proof' rejection assertion at line 156 can pass for the wrong reason (cached 'job' revert instead of the on-chain proof check). The economics specialist's additional claim of a second, time-order-dependent failure did not reproduce here. Edges the suite never exercises: holder-count scaling of scan() (max 4 holders), fee rounding below 25 wei, animated multi-frame tokenURI validity and gas, a zero-balance seller re-entering in the cutoff block, protocol-fee enablement, mis-oriented configure() input, lost-owner paths and the x402 flow against a real IMD challenge. Remediation: construct every BrowserProvider with {cacheTimeout:-1} (or mine a block / vary calldata between identical estimates) and add the listed edge tests.

**Reproduction**

npm ci && npm test: 32 pass, 1 fail ('fixed supply, cutoff scores, exclusions, operator restrictions and exact base NFT', execution reverted: "job" (action="estimateGas") at tests/contracts.test.mjs:157). node --test --test-name-pattern='fixed supply' tests/contracts.test.mjs fails identically in isolation. A copy of the file with realVerifier?{cacheTimeout:-1}:{} replaced by {cacheTimeout:-1} passes the same test. Expected: a deterministic green suite as documented. Actual: host-speed-dependent failure.

### 12. Info: Exclusions are per-address only: the admin's 20M genesis allocation (or any excluded party) becomes eligible by moving tokens to a fresh wallet

`contracts/CreationController.sol:413`

```
            if (token.excluded(candidate) || allocated(candidate)) continue;
```

README/THREAT_MODEL state that the administrator, Operator, protocol recipient and protocol contracts are excluded so they cannot be selected, and AUDIT_SCOPE requires that the Operator cannot choose a recipient. Exclusion is enforced per address and sealed before trading, but excluded parties still hold freely transferable tokens (the admin holds 20,000,000 IMPEPE, 2% of supply, from genesis). Transferring to a fresh, non-excluded wallet creates an eligible holder whose score grows at 20M token-seconds per second, far above any early buyer in a pool that opens at a 1,000 IMD valuation; one allocation per address is enforced, but the holder can rotate to another fresh wallet after each win. This is not a bypass of the contract rules as written; it is a gap between the documented intent and what a sealed per-address list can enforce, recorded as a trust assumption on the two project wallets. If undesired: lock the 2% allocation in a time-locked contract that is itself excluded (design decision).

**Reproduction**

test/scratch/Repro.t.sol test_AdminAllocationRotatesIntoEligibleWallet: admin transfers 20,000,000e18 to fresh EOA 0xF00D at genesis+1 block; alice buys 100 IMD of IMPEPE; 30 days later bob buys 20 IMD (funding crosses 0.5 IMD); openNextJob; confirmFinality; scan(250). Expected per docs: the admin allocation never receives an original NFT. Actual: jobs(1).winner == 0xF00D.

### 13. Info: Snapshot cutoff is controllable at the margin: the deposit that crosses the budget fixes the cutoff block, and a sold-out historical leader can re-enter with 1 wei in that block and win

`contracts/CreationController.sol:329`

```
        localJobs[id].cutoff = point.blockNumber;
```

The cutoff is the block of the funding deposit that makes cumulative funding reach id * jobBudget. Deposits happen when fees are flushed, which any IMPEPESwapRouter swap does atomically and anyone can trigger for pending external-router claims via flushFees(), so a holder about to be overtaken can pull the snapshot forward by trading gap/0.03 IMD (never delay it). Separately, ProjectToken.scoreAt uses the last checkpoint with blockNumber <= cutoff, so a transfer placed after the funding deposit in the same block still determines the 'positive cutoff balance'. Combined with the non-decaying historical score, a wallet that held a large balance for a long time and sold out can re-enter with 1 wei in the cutoff block (same-block bundle after the crossing swap) and win with its full historical score. Both behaviours match the documented design ('Same-block token transfers resolve to the final balance checkpoint'; 'waiting cannot move the cutoff') and are recorded for the economic record, not as a bypass. If undesired, snapshot at cutoff-1 and/or require a minimum balance or weight by balance at cutoff.

**Reproduction**

test/scratch/Repro.t.sol test_CutoffMarginReentryWithOneWei: alice buys 1 IMD of IMPEPE and holds 10 days; bob buys 1 IMD and holds 1 day; alice sells her entire balance (balanceOf == 0, historical score retained). In one block: bob buys 20 IMD (funding crosses 0.5 IMD), then bob transfers 1 wei IMPEPE to alice. openNextJob() records cutoff == that block; after confirmFinality and scan, jobs(1).winner == alice. Expected by the intuition of a 'cutoff balance': alice ineligible (zero balance when the deposit landed). Actual: eligible and selected (documented end-of-block semantics).

### 14. Info: External-dependency trust: the opening-tick planner assumes an 18-decimal, plain ERC-20 IMD without reading the live token, and IMD is an owner-managed contract on every value path

`scripts/opening-price.mjs:3`

```
// Both assets use 18 decimals. Tick orientation follows the final predicted addresses.
```

openingPrice() hard-codes equal 18-decimal assets and derives tick -138180/+138180 purely from the 1,000 IMD target; it never queries decimals() of the configured IMD contract, and a wrong assumption would open the permanently locked pool at a valuation off by 10^(18-d) with no re-seed path. This review verified the live mainnet contract at 0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7 over public RPC: decimals() == 18, symbol() == 'IMD', owner() == 0x047F606fD5b2BaA5f5C6c4aB8958E45CB6B054B7, and the PoolManager at 0x000000000004444c5dc75cB358380D2e3dE08A90 has code; so the tick derivation holds today. The remaining point is trust: IMD is owner-managed, and every value path (hook claims, FeeRouter.distribute, controller deposits/payments, rewards, migration import) does exact-amount safeTransfer/safeTransferFrom of IMD, so any future IMD behaviour change (fee-on-transfer, pause, blocklist of hook/router/controller/protocol recipient) makes FeeRouter.distribute revert and with it every IMPEPESwapRouter trade, with external-router fees accumulating as unflushable claims and no admin lever to re-route. Recorded as an accepted trust assumption. Remediation: have the planner read decimals() from the configured RPC and fail closed unless both are 18; document the verified IMD implementation (proxy/pause/blocklist capabilities) before sealing the opening tick.

**Reproduction**

openingPrice({targetOpeningFdvImd:'1000', fixedSupply:'1000000000', tickSpacing:60, tokenAddress, imdAddress}) returns -138180 or +138180 regardless of the IMD contract; with a 6-decimal IMD the correct tick would differ by about 276,000 (factor 10^12) and no error is raised. Live check (cast call over https://ethereum-rpc.publicnode.com): decimals() 18, symbol() IMD, owner() 0x047F606fD5b2BaA5f5C6c4aB8958E45CB6B054B7. Trust path: if IMD's transferFrom(hook, router) reverts or returns less than fee, FeeRouter.distribute reverts 'received' and swapExactInput reverts for every fee-bearing trade.

### 15. Info: Hook fee truncation: buys below 25 wei of IMD pay no fee and 25-33 wei pay 1 wei entirely to the protocol recipient

`contracts/IMPEPEHook.sol:151`

```
        uint256 fee = (gross * 4) / 100;
```

fee = floor(gross*4/100) and allocation = floor(gross*3/100) round down independently. For gross < 25 wei the fee is 0 and accrue() is skipped; for 25 <= gross <= 33 fee = 1 wei with allocation 0, so the whole fee goes to protocol; for 34 <= gross <= 49 fee = 1 and allocation = 1, so the whole fee goes to creation (the math specialist's '34 wei routes 1/1' was wrong; it routes 1/0). Across many trades the realised split deviates from 3:1 by at most 1 wei per trade. Verified against a real PoolManager in both currency orientations. Economic impact is nil (a swap costs about 1e5 gas versus 1e-17 IMD of avoided fee) and the behaviour is documented as 'preserving per-trade rounding'; recorded for completeness.

**Reproduction**

test/scratch/Repro.t.sol test_FeeTruncation (IMD as currency0) and ReverseOrientationTest (IMPEPE as currency0): swapExactInput(key, buy, 24, 0, deadline): controller +0, protocolRecipient +0; amountIn 25: controller +0, protocol +1; amountIn 34: controller +1, protocol +0; amountIn 1000e18: controller +30e18, protocol +10e18, buyer pays exactly 1000e18. Expected under an exact 3%/1% rule: 0.72/0.24 wei etc.; actual: floors as listed.

### 16. Info: RewardsDistributor.remainder is dead state: SCALE (1e27) is divisible by 1000 so scaled % 1000 is always 0

`contracts/RewardsDistributor.sol:33`

```
        remainder = scaled % 1000;
```

fund() computes scaled = amount*1e27 + remainder and sets remainder = scaled % 1000. Because 1e27 mod 1000 == 0 and remainder starts at 0, scaled mod 1000 is always 0, so the carry never holds a value and accRewardPerNFT += amount*1e24 exactly. The accumulator math is otherwise correct (1000 equal shares sum to the funded amount; per-holder dust below 1e-27 IMD stays in creditScaled). No impact; the variable and its storage write can be removed or SCALE chosen so the carry is meaningful.

**Reproduction**

fund(1) with totalSupply == 1000: scaled = 1e27, accRewardPerNFT += 1e24, remainder = 0. fund(999): remainder = 0. For any amount the remainder stays 0 (expected by the author: a non-zero carry for amounts not divisible by 1000; actual: always 0).

### 17. Info: FeeRouter.route(uint256) is unreachable: only the hook may call it and IMPEPEHook never does

`contracts/FeeRouter.sol:122`

```
    function route(uint256 grossImd) external nonReentrant returns (uint256 fee) {
```

route() requires msg.sender == hook and would pull floor(gross*4/100) IMD from the hook's ERC-20 balance. IMPEPEHook settles fees exclusively through flushFees() -> routeAmounts(allocation, protocol) and contains no call to route(); the only caller in the repository is the TestFeeSource harness in tests/contracts/TestHarness.sol. Dead production code duplicating the split formula; it cannot be triggered by anyone but the immutable hook, so there is no impact. Removing it reduces the audited surface and the chance of the two formulas diverging in a future revision.

**Reproduction**

Any account calling route(1000e18) reverts 'hook'. grep of contracts/ shows no invocation of route( in IMPEPEHook; the only invocation is tests/contracts/TestHarness.sol TestFeeSource. Expected: either the hook uses it or it does not exist; actual: unreachable.

### 18. Info: Worker releases the on-chain job budget (payJob) before validating the x402 challenge terms

`backend/worker.mjs:33`

```
   assertLock();if(!job.paid)await(await controller.payJob()).wait();
```

In cycleUnlocked the Operator calls controller.payJob() (moving 0.5 IMD to the Operator wallet and flipping job.paid) before fetching the 402 challenge and running validateChallenge/preparePayment (line 38). If the challenge terms are rejected (payTo/spender/resource mismatch, expiry too close, amount changed between quote and challenge) the cycle throws after the budget has already left the controller. A transient mismatch self-heals on a later cycle (job.paid is skipped), but a permanent policy mismatch leaves the job paid with no admission, which can only be unwound through the signed refund-backed recovery path (attestor signature + exact refund). No funds leave the Operator's own wallet in this scenario (paymentRecipient == Operator). Remediation: fetch and validate the challenge (imd.challenge + validateChallenge) before calling payJob(), then sign/persist the payment.

**Reproduction**

State: job selected, not paid, order quoted. Input: IMD_PAY_TO env differs from the challenge quote.payment.payTo. Expected: cycle halts without on-chain side effects. Actual: payJob() executes (JobPayment event, controller balance -0.5 IMD), then preparePayment throws 'Unapproved IMD payment terms'; job.paid stays true until recoverJob() with an independent recovery signature.

---

Judge's submission `29e80b1b6c839900ec382f189c735bb9b48affdd849a0653682d01f93c2a84df`, accepted on the IdentityMD network. Acceptance means the report met the job's checks;
it is not a guarantee that the code has no other defects.
