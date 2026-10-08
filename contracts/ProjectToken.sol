// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
interface IAllocationVault { function token() external view returns(address); }
contract ProjectToken is ERC20, Ownable2Step {
    struct Checkpoint {
        uint64 blockNumber;
        uint64 time;
        uint256 balance;
        uint256 score;
    }
    mapping(address => Checkpoint[]) private history;
    mapping(address => bool) public excluded;
    mapping(address => bool) private known;
    address[] public holders;
    mapping(address => uint256) public registeredAt;
    bool public eligibilitySealed;
    uint256 public immutable scoringStartBlock;
    event EligibilitySealed();
    uint256 public constant MINIMUM_HOLDER_BALANCE = 10_000 ether;
    uint256 public constant FIXED_SUPPLY = 1_000_000_000 ether;
    constructor(address admin, address publicAllocation) ERC20("IMPEPE", "IMPEPE") Ownable(admin) {
        require(publicAllocation != admin && publicAllocation.code.length > 0 && IAllocationVault(publicAllocation).token() == address(this), "allocation vault");
        scoringStartBlock = block.number;
        _mint(admin, 20_000_000 ether);
        _mint(publicAllocation, 980_000_000 ether);
    }
    function setExcluded(address account, bool value) external onlyOwner {
        require(!eligibilitySealed, "sealed");
        excluded[account] = value;
    }
    function sealEligibility() external onlyOwner {
        require(!eligibilitySealed, "sealed");
        eligibilitySealed = true;
        emit EligibilitySealed();
    }
    function holderCount() external view returns (uint256) {
        return holders.length;
    }
    function holderCountAt(uint256 cutoff) external view returns (uint256) {
        uint256 lo;
        uint256 hi = holders.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (registeredAt[holders[mid]] <= cutoff) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }
    function scoreAt(
        address account,
        uint256 cutoff,
        uint256 cutoffTime
    ) external view returns (uint256 score, uint256 balance) {
        Checkpoint[] storage items = history[account];
        uint256 lo;
        uint256 hi = items.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (items[mid].blockNumber <= cutoff) lo = mid + 1;
            else hi = mid;
        }
        if (lo == 0) return (0, 0);
        Checkpoint storage point = items[lo - 1];
        require(cutoffTime >= point.time, "time");
        return (point.score + point.balance * (cutoffTime - point.time), point.balance);
    }
    function _checkpoint(address account) private {
        if (account == address(0)) return;
        if (!known[account] && balanceOf(account) >= MINIMUM_HOLDER_BALANCE) {
            known[account] = true;
            registeredAt[account] = block.number;
            holders.push(account);
        }
        Checkpoint[] storage items = history[account];
        uint256 score;
        if (items.length > 0) {
            Checkpoint storage prior = items[items.length - 1];
            score = prior.score + prior.balance * (block.timestamp - prior.time);
        }
        Checkpoint memory next = Checkpoint(
            uint64(block.number),
            uint64(block.timestamp),
            balanceOf(account),
            score
        );
        if (items.length > 0 && items[items.length - 1].blockNumber == block.number)
            items[items.length - 1] = next;
        else items.push(next);
    }
    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);
        _checkpoint(from);
        if (to != from) _checkpoint(to);
    }
    function renounceOwnership() public override onlyOwner { revert("ownership required"); }
}
