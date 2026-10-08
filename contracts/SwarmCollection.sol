// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {SVGRenderer} from "./SVGRenderer.sol";
interface ITransferRewards {
    function onTransfer(address from, address to, uint256 id) external;
}
interface ICollectionLink {
    function collection() external view returns (address);
}
interface IMigrationController {
    function feeRouter() external view returns (address);
    function retired() external view returns (bool);
    function predecessor() external view returns (address);
    function migrationImported() external view returns (bool);
    function collection() external view returns (address);
}
contract SwarmCollection is ERC721, Ownable, ReentrancyGuard {
    uint256 public constant MAX_SUPPLY = 1000;
    uint256 public totalSupply;
    address public controller;
    ITransferRewards public rewards;
    mapping(uint256 => bytes) private artworks;
    mapping(uint256 => uint16) public duration;
    mapping(uint256 => uint8) public animation;
    mapping(uint256 => bytes32) public artifactHash;
    mapping(bytes32 => bool) public usedArtifact;
    event ArtworkCommitted(uint256 indexed id, address indexed recipient, bytes32 artifactHash);
    event ControllerReplaced(address indexed oldController, address indexed newController);
    constructor(address establishedWallet) ERC721("IMPEPE", "IMPEPE") Ownable(establishedWallet) {
        require(msg.sender == establishedWallet, "direct established deployer required");
    }
    function configure(address nextController, address distributor) external onlyOwner {
        require(
            controller == address(0) &&
                nextController.code.length > 0 &&
                distributor.code.length > 0,
            "configuration"
        );
        require(
            ICollectionLink(nextController).collection() == address(this) &&
                ICollectionLink(distributor).collection() == address(this),
            "collection links"
        );
        controller = nextController;
        rewards = ITransferRewards(distributor);
    }
    // Only the current official router can complete the independently delayed controller handover.
    function replaceController(address replacement) external {
        IMigrationController previous = IMigrationController(controller);
        IMigrationController next = IMigrationController(replacement);
        require(
            msg.sender == previous.feeRouter() &&
                previous.retired() &&
                next.predecessor() == controller &&
                next.migrationImported() &&
                next.feeRouter() == msg.sender &&
                next.collection() == address(this) &&
                totalSupply < 1000,
            "migration authority"
        );
        address old = controller;
        controller = replacement;
        emit ControllerReplaced(old, replacement);
    }
    function commitAndMint(
        address recipient,
        bytes calldata art,
        uint16 durationMs,
        uint8 effect
    ) external nonReentrant returns (uint256 id) {
        require(msg.sender == controller && address(rewards) != address(0), "controller");
        require(totalSupply < MAX_SUPPLY, "complete");
        uint256 frames = art.length / 300;
        require(art.length > 0 && art.length % 300 == 0 && frames <= 8 && effect <= 13, "art");
        require(
            (frames == 1 && effect == 0 && durationMs == 0) ||
                (frames > 1 && effect > 0 && durationMs >= 2000 && durationMs <= 20000),
            "animation"
        );
        bytes32 hash = sha256(art);
        require(!usedArtifact[hash], "duplicate art");
        usedArtifact[hash] = true;
        id = ++totalSupply;
        artworks[id] = art;
        duration[id] = durationMs;
        animation[id] = effect;
        artifactHash[id] = hash;
        emit ArtworkCommitted(id, recipient, artifactHash[id]);
        // Recipient is fixed by ranked selection. Delivery must not depend on a receiver callback.
        _mint(recipient, id);
    }
    function artwork(uint256 id) external view returns (bytes memory) {
        _requireOwned(id);
        return artworks[id];
    }
    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        string memory svg = SVGRenderer.render(artworks[id], duration[id]);
        bytes memory json = abi.encodePacked(
            '{"name":"IMPEPE #',
            Strings.toString(id),
            '","description":"Pepes from the swarm","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '","attributes":[{"trait_type":"Progression","value":',
            Strings.toString(id),
            '},{"trait_type":"Animation","value":',
            Strings.toString(animation[id]),
            "}]}"
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(json)));
    }
    function _update(
        address to,
        uint256 id,
        address auth
    ) internal override returns (address from) {
        from = super._update(to, id, auth);
        if (address(rewards) != address(0)) rewards.onTransfer(from, to, id);
    }
}
