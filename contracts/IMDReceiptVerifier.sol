// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ReceiptVerifier} from "./ReceiptVerifier.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

contract IMDReceiptVerifier is ReceiptVerifier {
    bytes32 public constant SELECTION_TYPEHASH = keccak256("Selection(bytes32 payloadHash,address controller,uint256 expiresAt)");
    constructor(address signer) ReceiptVerifier(signer) {}
    function verifySelection(bytes32 payloadHash, bytes calldata proof) external view returns(bool) {
        (uint256 expiresAt, bytes memory signature) = abi.decode(proof, (uint256,bytes));
        if (block.timestamp > expiresAt) return false;
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(SELECTION_TYPEHASH,payloadHash,msg.sender,expiresAt)));
        return SignatureChecker.isValidSignatureNow(attestor,digest,signature);
    }
}
