// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CreationController} from "./CreationController.sol";
import {RewardsDistributor} from "./RewardsDistributor.sol";
contract FeeRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable imd;
    CreationController public creation;
    RewardsDistributor public immutable rewards;
    address public immutable protocolRecipient;
    address public hook;
    uint256 public constant MIGRATION_DELAY = 2 days;
    CreationController public pendingController;
    bytes32 public pendingCodeHash;
    uint256 public migrationAvailableAt;
    uint256 public migrationEscrow;
    event ControllerMigrationScheduled(
        address indexed oldController,
        address indexed newController,
        uint256 availableAt
    );
    event ControllerMigrationCancelled();
    event ControllerMigrated(
        address indexed oldController,
        address indexed newController,
        uint256 forwardedEscrow
    );
    event FeesRouted(
        uint256 grossImd,
        uint256 creationOrRewards,
        uint256 protocol,
        bool rewardPhase
    );
    constructor(
        address admin,
        IERC20 money,
        CreationController controller,
        RewardsDistributor distributor,
        address protocol
    ) Ownable(admin) {
        require(
            protocol != address(0) &&
                address(money).code.length > 0 &&
                address(controller).code.length > 0 &&
                address(distributor).code.length > 0,
            "configuration"
        );
        require(
            address(controller.imd()) == address(money) &&
                address(distributor.imd()) == address(money) &&
                address(distributor.collection()) == address(controller.collection()),
            "fee links"
        );
        imd = money;
        creation = controller;
        rewards = distributor;
        protocolRecipient = protocol;
        money.forceApprove(address(controller), type(uint256).max);
        money.forceApprove(address(distributor), type(uint256).max);
    }
    function configureHook(address value) external onlyOwner {
        require(hook == address(0) && value.code.length > 0, "hook");
        hook = value;
    }
    function scheduleControllerMigration(CreationController replacement) external onlyOwner {
        require(
            address(pendingController) == address(0) &&
                replacement.owner() == owner() &&
                replacement.feeRouter() == address(this) &&
                address(replacement.predecessor()) == address(creation) &&
                replacement.paused() &&
                !replacement.migrationImported() &&
                creation.paused() &&
                creation.collection().totalSupply() < 1000,
            "migration state"
        );
        pendingController = replacement;
        pendingCodeHash = address(replacement).codehash;
        migrationAvailableAt = block.timestamp + MIGRATION_DELAY;
        emit ControllerMigrationScheduled(
            address(creation),
            address(replacement),
            migrationAvailableAt
        );
    }
    function cancelControllerMigration() external onlyOwner {
        require(address(pendingController) != address(0), "no migration");
        pendingController = CreationController(address(0));
        migrationAvailableAt = 0;
        pendingCodeHash = bytes32(0);
        emit ControllerMigrationCancelled();
    }
    function executeControllerMigration() external onlyOwner nonReentrant {
        CreationController next = pendingController;
        CreationController previous = creation;
        require(
            address(next) != address(0) &&
                block.timestamp >= migrationAvailableAt &&
                address(next).codehash == pendingCodeHash &&
                previous.retired() &&
                address(next.predecessor()) == address(previous),
            "migration delay or state"
        );
        next.importMigration();
        previous.collection().replaceController(address(next));
        imd.forceApprove(address(previous), 0);
        imd.forceApprove(address(next), type(uint256).max);
        creation = next;
        pendingController = CreationController(address(0));
        migrationAvailableAt = 0;
        pendingCodeHash = bytes32(0);
        next.activateMigration();
        uint256 escrow = migrationEscrow;
        migrationEscrow = 0;
        if (escrow > 0) next.deposit(escrow);
        emit ControllerMigrated(address(previous), address(next), escrow);
    }
    function route(uint256 grossImd) external nonReentrant returns (uint256 fee) {
        require(msg.sender == hook, "hook");
        fee = (grossImd * 4) / 100;
        if (fee == 0) return 0;
        distribute(grossImd, (grossImd * 3) / 100, fee - (grossImd * 3) / 100);
    }
    function routeAmounts(uint256 allocation, uint256 protocol) external nonReentrant {
        require(msg.sender == hook, "hook");
        distribute(0, allocation, protocol);
    }
    function distribute(uint256 grossImd, uint256 allocation, uint256 protocol) private {
        uint256 fee = allocation + protocol;
        if (fee == 0) return;
        uint256 balance = imd.balanceOf(address(this));
        imd.safeTransferFrom(msg.sender, address(this), fee);
        require(imd.balanceOf(address(this)) - balance == fee, "received");
        bool completed = creation.collection().totalSupply() == 1000;
        if (allocation > 0) {
            if (completed) rewards.fund(allocation);
            else if (creation.retired()) migrationEscrow += allocation;
            else creation.deposit(allocation);
        }
        if (protocol > 0) imd.safeTransfer(protocolRecipient, protocol);
        emit FeesRouted(grossImd, allocation, protocol, completed);
    }
}
