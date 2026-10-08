// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SwarmCollection} from "../../contracts/SwarmCollection.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {V4Quoter} from "@uniswap/v4-periphery/src/lens/V4Quoter.sol";
contract TestIMD is ERC20 {constructor() ERC20("Test IMD","IMD"){_mint(msg.sender,1e30);}}
contract TestVerifier {address public constant attestor=address(0x123456);bool public accepted=true;function setAccepted(bool value)external{accepted=value;}function verify(uint256,bytes32,bytes32,bytes calldata)external view returns(bool){return accepted;}function verifyFinality(uint256,bytes calldata)external view returns(bool){return accepted;}function verifyRecovery(uint256,bytes32,uint256,uint256,address,bytes calldata)external view returns(bool){return accepted;}}
contract RejectingNFTHolder {function onERC721Received(address,address,uint256,bytes calldata)external pure returns(bytes4){revert("reject NFT");}}
contract TestFeeSource {function route(address router,uint256 gross)external{(bool ok,bytes memory data)=router.call(abi.encodeWithSignature("route(uint256)",gross));if(!ok)assembly{revert(add(data,32),mload(data))}}function approve(address token,address router)external{ERC20(token).approve(router,type(uint256).max);}}
contract SeededCollection is SwarmCollection {
    constructor(address admin) SwarmCollection(admin){}
    function seedNearCompletion(address a,address b)external onlyOwner{require(totalSupply==0);totalSupply=999;_mint(a,1);_mint(b,2);}
}
contract TestCreate2 {function deploy(bytes32 salt,bytes calldata initCode)external returns(address result){bytes memory code=initCode;assembly{result:=create2(0,add(code,32),mload(code),salt)}require(result!=address(0),"create2");}}
