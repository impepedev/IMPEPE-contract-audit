// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
// Explicit trusted bridge: NOT a native IMD receipt verifier. Native Ed25519 evidence is checked off-chain.
// Production deployment requires approving and configuring this trust boundary, or replacing this module.
contract ReceiptVerifier is EIP712 {
    address public immutable attestor;
    bytes32 public constant TYPEHASH =
        keccak256(
            "Artifact(uint256 tokenId,bytes32 requestId,bytes32 artifactHash,address controller,uint256 expiresAt)"
        );
    bytes32 public constant FINALITY_TYPEHASH =
        keccak256(
            "Finalized(uint256 blockNumber,bytes32 blockHash,address controller,uint256 expiresAt)"
        );
    bytes32 public constant RECOVERY_TYPEHASH =
        keccak256(
            "Recovery(uint256 tokenId,bytes32 requestId,uint256 attempt,uint256 amount,address paymentRecipient,address controller,uint256 expiresAt)"
        );
    constructor(address signer) EIP712("IMPEPE Artifact", "1") {
        require(signer != address(0), "attestor");
        attestor = signer;
    }
    function verify(
        uint256 id,
        bytes32 requestId,
        bytes32 hash,
        bytes calldata proof
    ) external view returns (bool) {
        (uint256 expiresAt, bytes memory signature) = abi.decode(proof, (uint256, bytes));
        if (block.timestamp > expiresAt) return false;
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(TYPEHASH, id, requestId, hash, msg.sender, expiresAt))
        );
        return SignatureChecker.isValidSignatureNow(attestor, digest, signature);
    }
    function verifyFinality(uint256 cutoff, bytes calldata proof) external view returns (bool) {
        (bytes32 hash, uint256 expiresAt, bytes memory signature) = abi.decode(
            proof,
            (bytes32, uint256, bytes)
        );
        if (block.timestamp > expiresAt || hash == bytes32(0) || cutoff >= block.number)
            return false;
        if (block.number - cutoff <= 256 && blockhash(cutoff) != hash) return false;
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(FINALITY_TYPEHASH, cutoff, hash, msg.sender, expiresAt))
        );
        return SignatureChecker.isValidSignatureNow(attestor, digest, signature);
    }
    function verifyRecovery(
        uint256 id,
        bytes32 requestId,
        uint256 attempt,
        uint256 amount,
        address paymentRecipient,
        bytes calldata proof
    ) external view returns (bool) {
        (uint256 expiresAt, bytes memory signature) = abi.decode(proof, (uint256, bytes));
        if (block.timestamp > expiresAt) return false;
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RECOVERY_TYPEHASH,
                    id,
                    requestId,
                    attempt,
                    amount,
                    paymentRecipient,
                    msg.sender,
                    expiresAt
                )
            )
        );
        return SignatureChecker.isValidSignatureNow(attestor, digest, signature);
    }
}
