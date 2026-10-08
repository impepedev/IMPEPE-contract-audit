// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
library SVGRenderer {
    bytes16 private constant HEX = "0123456789abcdef";
    function color(bytes memory art, uint256 offset) internal pure returns (string memory) {
        bytes memory out = new bytes(7);
        out[0] = "#";
        for (uint256 i; i < 3; i++) {
            uint8 value = uint8(art[offset + i]);
            out[1 + i * 2] = HEX[value >> 4];
            out[2 + i * 2] = HEX[value & 15];
        }
        return string(out);
    }
    // Each frame is exactly 100 RGB cells. Geometry never animates.
    function render(bytes memory art, uint16 durationMs) internal pure returns (string memory) {
        bytes memory output = abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" shape-rendering="crispEdges">'
        );
        uint256 frames = art.length / 300;
        for (uint256 cell; cell < 100; cell++) {
            output = abi.encodePacked(
                output,
                '<rect x="',
                Strings.toString(cell % 10),
                '" y="',
                Strings.toString(cell / 10),
                '" width="1" height="1" fill="',
                color(art, cell * 3),
                '"'
            );
            if (frames == 1) output = abi.encodePacked(output, "/>");
            else {
                bytes memory values;
                for (uint256 f; f < frames; f++)
                    values = abi.encodePacked(
                        values,
                        f == 0 ? "" : ";",
                        color(art, f * 300 + cell * 3)
                    );
                values = abi.encodePacked(values, ";", color(art, cell * 3));
                output = abi.encodePacked(
                    output,
                    '><animate attributeName="fill" values="',
                    values,
                    '" dur="',
                    Strings.toString(durationMs),
                    'ms" repeatCount="indefinite" calcMode="discrete"/></rect>'
                );
            }
        }
        return string(abi.encodePacked(output, "</svg>"));
    }
}
