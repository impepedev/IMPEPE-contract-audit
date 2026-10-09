// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMDFeeRouter} from "../../contracts/IMDFeeRouter.sol";
contract IMDTestFeeSource {
    address public immutable router;
    constructor(address destination) { router=destination; }
    function project() external view returns(address) { return address(IMDFeeRouter(router).creation().token()); }
    function imd() external view returns(address) { return address(IMDFeeRouter(router).imd()); }
    function fund(address money,uint256 amount) external { IERC20(money).approve(router,amount); IMDFeeRouter(router).routeAmount(amount); }
}
