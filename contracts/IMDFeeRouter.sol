// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMDCreationController} from "./IMDCreationController.sol";
import {RewardsDistributor} from "./RewardsDistributor.sol";
interface IIMDFeeHook { function router() external view returns(address); function project() external view returns(address); function imd() external view returns(address); }
contract IMDFeeRouter is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable imd;
    IMDCreationController public creation;
    RewardsDistributor public immutable rewards;
    address public hook;
    uint256 public constant MIGRATION_DELAY = 2 days;
    IMDCreationController public pendingController;
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
        IMDCreationController controller,
        RewardsDistributor distributor
    ) Ownable(admin) {
        require(
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
        money.forceApprove(address(controller), type(uint256).max);
        money.forceApprove(address(distributor), type(uint256).max);
    }
    function configureHook(address value) external onlyOwner {
        require(hook == address(0) && value.code.length > 0 && IIMDFeeHook(value).router() == address(this) && IIMDFeeHook(value).project() == address(creation.token()) && IIMDFeeHook(value).imd() == address(imd), "hook");
        hook = value;
    }
    function scheduleControllerMigration(IMDCreationController replacement) external onlyOwner {
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
        pendingController = IMDCreationController(address(0));
        migrationAvailableAt = 0;
        pendingCodeHash = bytes32(0);
        emit ControllerMigrationCancelled();
    }
    function executeControllerMigration() external onlyOwner nonReentrant {
        IMDCreationController next = pendingController;
        IMDCreationController previous = creation;
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
        pendingController = IMDCreationController(address(0));
        migrationAvailableAt = 0;
        pendingCodeHash = bytes32(0);
        next.activateMigration();
        uint256 escrow = migrationEscrow;
        migrationEscrow = 0;
        if (escrow > 0) next.deposit(escrow);
        emit ControllerMigrated(address(previous), address(next), escrow);
    }
    function routeAmount(uint256 allocation) external nonReentrant {
        require(msg.sender == hook, "hook");
        if (allocation == 0) return;
        uint256 balance = imd.balanceOf(address(this));
        imd.safeTransferFrom(msg.sender, address(this), allocation);
        require(imd.balanceOf(address(this)) - balance == allocation, "received");
        bool completed = creation.collection().totalSupply() == 1000;
        if (completed) rewards.fund(allocation);
        else if (creation.retired()) migrationEscrow += allocation;
        else creation.deposit(allocation);
        emit FeesRouted(0, allocation, 0, completed);
    }
    function renounceOwnership() public override onlyOwner { revert("ownership required"); }
}
