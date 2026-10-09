// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
// Standard launch token: the IMD factory distributes the supply; no owner, tax or custom checkpoints.
contract IMPEPE is ERC20 {
    constructor() ERC20("IMPEPE", "IMPEPE") { _mint(msg.sender, 1_000_000_000 ether); }
}
