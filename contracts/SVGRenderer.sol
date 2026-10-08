// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
library SVGRenderer {
    bytes16 private constant HEX = "0123456789abcdef";
    function append(bytes memory out, uint256 cursor, bytes memory value) private pure returns(uint256) {
        require(cursor + value.length <= out.length, "render buffer");
        assembly("memory-safe") { mcopy(add(add(out,32),cursor),add(value,32),mload(value)) }
        return cursor + value.length;
    }
    function color(bytes memory out, uint256 cursor, bytes memory art, uint256 offset) private pure returns (uint256) {
        require(cursor + 7 <= out.length && offset + 3 <= art.length,"render color");
        bytes16 table = HEX;
        assembly("memory-safe") {
            let ptr := add(add(out,32),cursor)
            mstore8(ptr,35)
            ptr := add(ptr,1)
            for {let i := 0} lt(i,3) {i := add(i,1)} {
                let index := add(offset,i)
                // Read the allocated word containing this byte, including final partial words
                let value := byte(and(index,31),mload(add(add(art,32),and(index,not(31)))))
                mstore8(ptr,byte(shr(4,value),table))
                mstore8(add(ptr,1),byte(and(value,15),table))
                ptr := add(ptr,2)
            }
        }
        return cursor + 7;
    }
    // Each frame is exactly 100 RGB cells. Geometry never animates.
    function render(bytes memory art, uint16 durationMs) internal pure returns (string memory) {
        uint256 frames = art.length / 300;
        bytes memory output = new bytes(100 * (180 + frames * 8) + 100);
        uint256 cursor = append(output, 0,
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" shape-rendering="crispEdges">'
        );
        bytes memory duration = bytes(Strings.toString(durationMs));
        for (uint256 cell; cell < 100; cell++) {
            cursor = append(output,cursor,'<rect x="'); output[cursor++] = bytes1(uint8(48+cell%10));
            cursor = append(output,cursor,'" y="'); output[cursor++] = bytes1(uint8(48+cell/10));
            cursor = append(output,cursor,'" width="1" height="1" fill="');
            cursor = color(output,cursor,art,cell*3);
            cursor = append(output,cursor,'"');
            if (frames == 1) cursor = append(output,cursor, "/>");
            else {
                cursor = append(output,cursor,'><animate attributeName="fill" values="');
                for (uint256 f; f < frames; f++) {
                    if (f != 0) output[cursor++] = ";";
                    cursor = color(output,cursor,art,f*300+cell*3);
                }
                cursor = append(output,cursor,'" dur="'); cursor = append(output,cursor,duration);
                cursor = append(output,cursor,'ms" repeatCount="indefinite" calcMode="discrete"/></rect>');
            }
        }
        cursor = append(output,cursor,"</svg>");
        assembly("memory-safe") { mstore(output,cursor) }
        return string(output);
    }
}
