// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
contract HookFactory {
    address public immutable deployer;
    event HookDeployed(address indexed hook, bytes32 salt);
    constructor(address establishedWallet) {
        require(establishedWallet != address(0), "deployer");
        deployer = establishedWallet;
    }
    function deploy(bytes32 salt, bytes calldata initCode) external returns (address result) {
        require(msg.sender == deployer, "deployer");
        bytes memory code = initCode;
        assembly {
            result := create2(0, add(code, 32), mload(code), salt)
        }
        require(result != address(0), "deployment");
        emit HookDeployed(result, salt);
    }
}
