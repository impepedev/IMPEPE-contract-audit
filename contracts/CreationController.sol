// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ProjectToken} from "./ProjectToken.sol";
import {SwarmCollection} from "./SwarmCollection.sol";
interface IArtifactVerifier {
    function attestor() external view returns (address);
    function verify(
        uint256 id,
        bytes32 requestId,
        bytes32 hash,
        bytes calldata proof
    ) external view returns (bool);
    function verifyFinality(uint256 cutoff, bytes calldata proof) external view returns (bool);
    function verifyRecovery(
        uint256 id,
        bytes32 requestId,
        uint256 attempt,
        uint256 amount,
        address paymentRecipient,
        bytes calldata proof
    ) external view returns (bool);
}
interface ICompletionRewards {
    function fund(uint256 amount) external;
}
contract CreationController is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Funding {
        uint256 cumulative;
        uint64 blockNumber;
        uint64 time;
    }
    struct Job {
        uint64 cutoff;
        uint64 time;
        uint256 cursor;
        uint256 count;
        address winner;
        uint256 bestScore;
        bytes32 requestId;
        bool selected;
        bool paid;
        bool finalized;
    }
    IERC20 public immutable imd;
    ProjectToken public immutable token;
    SwarmCollection public immutable collection;
    IArtifactVerifier public immutable verifier;
    address public immutable operator;
    address public immutable paymentRecipient;
    uint256 public immutable jobBudget;
    uint256 public immutable settlementBlocks;
    bytes32 public immutable baseHash;
    address public immutable recoveryRecipient;
    uint256 public constant MIGRATION_DELAY = 2 days;
    bool public paused;
    bool public retired;
    uint256 public withdrawalAvailableAt;
    bytes32 public withdrawalReason;
    uint256 public totalFunded;
    uint256 public nextJobId = 1;
    address public feeRouter;
    Funding[] private localFunding;
    CreationController public predecessor;
    uint256 public inheritedFundingCount;
    uint256 public migrationStartId;
    uint256 public migrationDepth;
    bool public migrationImported;
    uint256 public recoveredAmount;
    mapping(uint256 => Job) private localJobs;
    mapping(address => bool) private localAllocated;
    mapping(bytes32 => bool) private localUsedRequests;
    mapping(uint256 => uint256) public attempts;
    mapping(uint256 => uint256) private localFundingIndex;
    function fundingIndex(uint256 id) public view returns(uint256) {
        if (id < migrationStartId && address(predecessor) != address(0)) return predecessor.fundingIndex(id);
        return localFundingIndex[id];
    }
    event CreationFunded(uint256 amount, uint256 cumulative);
    event JobOpened(uint256 indexed id, uint256 cutoff, uint256 time);
    event RecipientSelected(uint256 indexed id, address indexed winner, uint256 score);
    event JobPayment(uint256 indexed id, uint256 amount, address recipient);
    event WorkRequested(uint256 indexed id, bytes32 requestId);
    event JobMinted(uint256 indexed id, bytes32 requestId, bytes32 artifactHash);
    event JobRecovered(
        uint256 indexed id,
        bytes32 oldRequestId,
        uint256 attempt,
        uint256 refundedBudget,
        address refundPayer
    );
    event SnapshotAdvanced(uint256 indexed id, uint256 oldCutoff, uint256 newCutoff);
    event EmergencyPaused(address indexed administrator);
    event CreationResumed();
    event WithdrawalScheduled(address indexed recipient, uint256 availableAt, bytes32 reason);
    event WithdrawalCancelled();
    event CreationFundsRecovered(address indexed recipient, uint256 amount, bytes32 reason);
    modifier whenActive() {
        require(
            !paused && !retired && (address(predecessor) == address(0) || migrationImported),
            "creation paused or retired"
        );
        _;
    }
    constructor(
        address admin,
        IERC20 money,
        ProjectToken project,
        SwarmCollection nft,
        IArtifactVerifier proofVerifier,
        address swarmOperator,
        address payTo,
        uint256 budget,
        uint256 delayBlocks,
        bytes32 firstArtHash
    ) Ownable(admin) {
        require(
            address(money) != address(0) &&
                address(project) != address(0) &&
                address(nft) != address(0) &&
                address(proofVerifier) != address(0),
            "contracts"
        );
        address signer = proofVerifier.attestor();
        require(
            signer != address(0) && signer != swarmOperator && signer != admin,
            "independent attestor required"
        );
        require(
            swarmOperator != address(0) &&
                swarmOperator != admin &&
                payTo != address(0) &&
                budget > 0 &&
                delayBlocks > 0 &&
                firstArtHash != bytes32(0),
            "configuration"
        );
        imd = money;
        token = project;
        collection = nft;
        verifier = proofVerifier;
        operator = swarmOperator;
        paymentRecipient = payTo;
        jobBudget = budget;
        settlementBlocks = delayBlocks;
        baseHash = firstArtHash;
        recoveryRecipient = admin;
    }
    // Creation reserves only. Already allocated NFT rewards and pool liquidity are outside this contract.
    function emergencyPause() external onlyOwner {
        require(!paused && !retired && collection.totalSupply() < 1000, "creation phase");
        paused = true;
        emit EmergencyPaused(msg.sender);
    }
    function resumeCreation() external onlyOwner {
        require(
            paused &&
                !retired &&
                withdrawalAvailableAt == 0 &&
                (address(predecessor) == address(0) ||
                    (migrationImported && collection.controller() == address(this))),
            "migration pending or retired"
        );
        paused = false;
        emit CreationResumed();
    }
    function scheduleWithdrawal(bytes32 reason) external onlyOwner {
        require(
            paused && !retired && withdrawalAvailableAt == 0 && reason != bytes32(0),
            "withdrawal state"
        );
        withdrawalAvailableAt = block.timestamp + MIGRATION_DELAY;
        withdrawalReason = reason;
        emit WithdrawalScheduled(recoveryRecipient, withdrawalAvailableAt, reason);
    }
    function cancelWithdrawal() external onlyOwner {
        require(!retired && withdrawalAvailableAt != 0, "no pending withdrawal");
        withdrawalAvailableAt = 0;
        withdrawalReason = bytes32(0);
        emit WithdrawalCancelled();
    }
    function withdrawCreationFunds() external onlyOwner nonReentrant {
        require(
            paused &&
                !retired &&
                withdrawalAvailableAt != 0 &&
                block.timestamp >= withdrawalAvailableAt &&
                collection.totalSupply() < 1000,
            "withdrawal delay or phase"
        );
        retired = true;
        uint256 amount = imd.balanceOf(address(this));
        recoveredAmount = amount;
        imd.safeTransfer(recoveryRecipient, amount);
        emit CreationFundsRecovered(recoveryRecipient, amount, withdrawalReason);
    }
    event MigrationPrepared(address indexed predecessor);
    event MigrationImported(address indexed predecessor, uint256 nextNft, uint256 recoveredFunds);
    function allocated(address account) public view returns (bool) {
        return
            localAllocated[account] ||
            (address(predecessor) != address(0) && predecessor.allocated(account));
    }
    function usedRequests(bytes32 request) public view returns (bool) {
        return
            localUsedRequests[request] ||
            (address(predecessor) != address(0) && predecessor.usedRequests(request));
    }
    function jobs(uint256 id) external view returns (Job memory) {
        if (address(predecessor) != address(0) && migrationImported && id < migrationStartId)
            return predecessor.jobs(id);
        return localJobs[id];
    }
    function fundingLength() public view returns (uint256) {
        return inheritedFundingCount + localFunding.length;
    }
    function funding(uint256 index) public view returns (Funding memory) {
        if (index < inheritedFundingCount) return predecessor.funding(index);
        return localFunding[index - inheritedFundingCount];
    }
    // A replacement is inert until the official fee router completes its delayed atomic handover.
    function prepareMigration(CreationController previous) external onlyOwner {
        require(
            address(predecessor) == address(0) &&
                totalFunded == 0 &&
                nextJobId == 1 &&
                localFunding.length == 0 &&
                address(previous) != address(this),
            "fresh replacement"
        );
        require(
            previous.paused() &&
                address(previous.token()) == address(token) &&
                address(previous.collection()) == address(collection) &&
                address(previous.imd()) == address(imd) &&
                previous.recoveryRecipient() == recoveryRecipient &&
                previous.operator() == operator &&
                previous.paymentRecipient() == paymentRecipient &&
                previous.jobBudget() == jobBudget &&
                previous.settlementBlocks() == settlementBlocks &&
                previous.baseHash() == baseHash &&
                previous.migrationDepth() < 8,
            "migration compatibility"
        );
        require(
            collection.totalSupply() < 1000 && collection.controller() == address(previous),
            "current controller"
        );
        predecessor = previous;
        migrationDepth = previous.migrationDepth() + 1;
        paused = true;
        emit MigrationPrepared(address(previous));
    }
    function importMigration() external nonReentrant {
        require(
            msg.sender == feeRouter &&
                paused &&
                !retired &&
                address(predecessor) != address(0) &&
                !migrationImported &&
                predecessor.retired() &&
                collection.controller() == address(predecessor),
            "migration import"
        );
        nextJobId = predecessor.nextJobId();
        require(nextJobId == collection.totalSupply() + 1, "mint sequence");
        totalFunded = predecessor.totalFunded();
        inheritedFundingCount = predecessor.fundingLength();
        migrationStartId = nextJobId;
        localJobs[nextJobId] = predecessor.jobs(nextJobId);
        attempts[nextJobId] = predecessor.attempts(nextJobId);
        localFundingIndex[nextJobId] = predecessor.fundingIndex(nextJobId);
        uint256 amount = predecessor.recoveredAmount();
        uint256 balance = imd.balanceOf(address(this));
        if (amount > 0) imd.safeTransferFrom(recoveryRecipient, address(this), amount);
        require(imd.balanceOf(address(this)) - balance == amount, "full migration funding");
        migrationImported = true;
        emit MigrationImported(address(predecessor), nextJobId, amount);
    }
    function activateMigration() external {
        require(
            msg.sender == feeRouter &&
                migrationImported &&
                paused &&
                !retired &&
                withdrawalAvailableAt == 0 &&
                collection.controller() == address(this),
            "migration activation"
        );
        paused = false;
        emit CreationResumed();
    }
    function configureRouter(address router) external onlyOwner {
        require(feeRouter == address(0) && router.code.length > 0, "router");
        feeRouter = router;
    }
    function deposit(uint256 amount) external nonReentrant {
        require(
            msg.sender == feeRouter &&
                token.eligibilitySealed() &&
                collection.totalSupply() < 1000 &&
                amount > 0,
            "funding"
        );
        require(
            !retired && (address(predecessor) == address(0) || migrationImported),
            "retired or inert controller"
        );
        uint256 beforeBalance = imd.balanceOf(address(this));
        imd.safeTransferFrom(msg.sender, address(this), amount);
        require(imd.balanceOf(address(this)) - beforeBalance == amount, "received");
        totalFunded += amount;
        localFunding.push(Funding(totalFunded, uint64(block.number), uint64(block.timestamp)));
        emit CreationFunded(amount, totalFunded);
    }
    // Anyone can open/scan. The cutoff is the earliest funding checkpoint meeting this job's cumulative budget.
    function openNextJob() external whenActive {
        uint256 id = nextJobId;
        require(id <= 1000 && localJobs[id].cutoff == 0 && totalFunded >= id * jobBudget, "job");
        uint256 lo = id > 1 ? fundingIndex(id - 1) : 0;
        uint256 hi = fundingLength();
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (funding(mid).cumulative < id * jobBudget) lo = mid + 1;
            else hi = mid;
        }
        Funding memory point = funding(lo);
        localFundingIndex[id] = lo;
        localJobs[id].cutoff = point.blockNumber;
        localJobs[id].time = point.time;
        emit JobOpened(id, point.blockNumber, point.time);
    }
    function confirmFinality(bytes calldata proof) external whenActive {
        Job storage job = localJobs[nextJobId];
        require(
            job.cutoff > 0 &&
                !job.finalized &&
                block.number > uint256(job.cutoff) + settlementBlocks,
            "settlement"
        );
        require(verifier.verifyFinality(job.cutoff, proof), "finality proof");
        job.finalized = true;
    }
    // An exhausted snapshot can move only to the earliest later funding block, never to an arbitrary cutoff.
    function advanceEmptySnapshot() external whenActive {
        uint256 id = nextJobId;
        Job storage job = localJobs[id];
        require(
            job.cutoff > 0 &&
                job.finalized &&
                !job.selected &&
                job.winner == address(0) &&
                job.count == token.holderCountAt(job.cutoff) &&
                job.cursor == job.count,
            "snapshot not exhausted"
        );
        uint256 lo = localFundingIndex[id] + 1;
        uint256 hi = fundingLength();
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (funding(mid).blockNumber <= job.cutoff) lo = mid + 1;
            else hi = mid;
        }
        require(lo < fundingLength(), "await next funding snapshot");
        Funding memory point = funding(lo);
        uint256 old = job.cutoff;
        localFundingIndex[id] = lo;
        job.cutoff = point.blockNumber;
        job.time = point.time;
        job.cursor = 0;
        job.count = 0;
        job.bestScore = 0;
        job.finalized = false;
        emit SnapshotAdvanced(id, old, point.blockNumber);
        emit JobOpened(id, point.blockNumber, point.time);
    }
    // Replacement authorization is bound to this exact attempt, and another budget must be returned first.
    function recoverJob(bytes calldata proof) external nonReentrant {
        require(!retired, "retired controller");
        uint256 id = nextJobId;
        Job storage job = localJobs[id];
        require(id <= 1000 && job.selected && job.paid, "paid job required");
        uint256 attempt = attempts[id];
        bytes32 oldRequest = job.requestId;
        require(
            verifier.verifyRecovery(id, oldRequest, attempt, jobBudget, paymentRecipient, proof),
            "recovery proof"
        );
        uint256 beforeBalance = imd.balanceOf(address(this));
        imd.safeTransferFrom(msg.sender, address(this), jobBudget);
        require(imd.balanceOf(address(this)) - beforeBalance == jobBudget, "full refund required");
        attempts[id] = attempt + 1;
        job.paid = false;
        job.requestId = bytes32(0);
        emit JobRecovered(id, oldRequest, attempt + 1, jobBudget, msg.sender);
    }
    function scan(uint256 limit) external whenActive {
        Job storage job = localJobs[nextJobId];
        require(
            job.cutoff > 0 &&
                job.finalized &&
                !job.selected &&
                block.number > uint256(job.cutoff) + settlementBlocks,
            "settlement"
        );
        require(limit > 0 && limit <= 250, "batch");
        uint256 count = token.holderCountAt(job.cutoff);
        job.count = count;
        uint256 end = job.cursor + limit;
        if (end > count) end = count;
        for (uint256 i = job.cursor; i < end; i++) {
            address candidate = token.holders(i);
            if (token.excluded(candidate) || allocated(candidate)) continue;
            (uint256 score, uint256 balance) = token.scoreAt(candidate, job.cutoff, job.time);
            if (balance < token.MINIMUM_HOLDER_BALANCE()) continue;
            if (
                job.winner == address(0) ||
                score > job.bestScore ||
                (score == job.bestScore && uint160(candidate) < uint160(job.winner))
            ) {
                job.winner = candidate;
                job.bestScore = score;
            }
        }
        job.cursor = end;
        if (end == count && job.winner != address(0)) {
            job.selected = true;
            localAllocated[job.winner] = true;
            emit RecipientSelected(nextJobId, job.winner, job.bestScore);
        }
    }
    function payJob() external nonReentrant whenActive {
        require(msg.sender == operator, "operator");
        Job storage job = localJobs[nextJobId];
        require(job.selected && !job.paid, "job");
        job.paid = true;
        imd.safeTransfer(paymentRecipient, jobBudget);
        emit JobPayment(nextJobId, jobBudget, paymentRecipient);
    }
    function bindRequest(bytes32 requestId) external whenActive {
        require(msg.sender == operator && requestId != bytes32(0), "operator");
        Job storage job = localJobs[nextJobId];
        require(job.selected && job.paid && job.requestId == bytes32(0), "job");
        require(!usedRequests(requestId), "request already used");
        localUsedRequests[requestId] = true;
        job.requestId = requestId;
        emit WorkRequested(nextJobId, requestId);
    }
    function submit(
        bytes calldata art,
        uint16 durationMs,
        uint8 effect,
        bytes calldata proof
    ) external nonReentrant whenActive {
        require(msg.sender == operator, "operator");
        uint256 id = nextJobId;
        Job storage job = localJobs[id];
        require(job.selected && job.paid && job.requestId != bytes32(0), "job");
        bytes32 hash = sha256(art);
        if (id == 1) require(hash == baseHash && effect == 0 && durationMs == 0, "base");
        require(
            verifier.verify(id, job.requestId, sha256(abi.encode(art, durationMs, effect)), proof),
            "artifact proof"
        );
        nextJobId = id + 1;
        require(collection.commitAndMint(job.winner, art, durationMs, effect) == id, "mint order");
        emit JobMinted(id, job.requestId, hash);
        if (id == 1000) {
            uint256 surplus = imd.balanceOf(address(this));
            if (surplus > 0) {
                address destination = address(collection.rewards());
                imd.forceApprove(destination, surplus);
                ICompletionRewards(destination).fund(surplus);
            }
        }
    }
    function renounceOwnership() public override onlyOwner { revert("ownership required"); }
}
