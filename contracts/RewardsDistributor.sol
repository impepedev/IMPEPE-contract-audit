// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
interface IRewardCollection {
    function totalSupply() external view returns (uint256);
    function ownerOf(uint256) external view returns (address);
}
contract RewardsDistributor is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 private constant SCALE = 1e27;
    IERC20 public immutable imd;
    IRewardCollection public immutable collection;
    uint256 public accRewardPerNFT;
    mapping(uint256 => uint256) public debt;
    mapping(address => uint256) public creditScaled;
    event RewardsFunded(uint256 amount);
    event Claimed(address indexed account, uint256 amount);
    constructor(IERC20 token, IRewardCollection nft) {
        require(address(token) != address(0) && address(nft) != address(0), "configuration");
        imd = token;
        collection = nft;
    }
    function fund(uint256 amount) external nonReentrant {
        require(collection.totalSupply() == 1000 && amount > 0, "phase");
        uint256 beforeBalance = imd.balanceOf(address(this));
        imd.safeTransferFrom(msg.sender, address(this), amount);
        require(imd.balanceOf(address(this)) - beforeBalance == amount, "received");
        uint256 scaled = amount * SCALE;
        accRewardPerNFT += scaled / 1000;
        emit RewardsFunded(amount);
    }
    function onTransfer(address from, address, uint256 id) external {
        require(msg.sender == address(collection), "collection");
        if (from != address(0)) creditScaled[from] += accRewardPerNFT - debt[id];
        debt[id] = accRewardPerNFT;
    }
    function claim(uint256[] calldata ids) external nonReentrant returns (uint256 amount) {
        for (uint256 i; i < ids.length; i++) {
            uint256 id = ids[i];
            require(i == 0 || id > ids[i - 1], "sorted unique ids");
            require(collection.ownerOf(id) == msg.sender, "owner");
            creditScaled[msg.sender] += accRewardPerNFT - debt[id];
            debt[id] = accRewardPerNFT;
        }
        amount = creditScaled[msg.sender] / SCALE;
        creditScaled[msg.sender] %= SCALE;
        if (amount > 0) imd.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }
    function claimable(address account, uint256[] calldata ids) external view returns (uint256) {
        uint256 scaled = creditScaled[account];
        for (uint256 i; i < ids.length; i++) {
            require(i == 0 || ids[i] > ids[i - 1], "sorted unique ids");
            require(collection.ownerOf(ids[i]) == account, "owner");
            scaled += accRewardPerNFT - debt[ids[i]];
        }
        return scaled / SCALE;
    }
}
