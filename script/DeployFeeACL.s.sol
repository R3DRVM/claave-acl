// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";

import {ACLPool} from "../src/ACLPool.sol";
import {KCLStaking} from "../src/KCLStaking.sol";
import {AgentCreditLineKCLFee} from "../src/AgentCreditLineKCLFee.sol";

/// @notice Deploy an ACL that routes borrow fees to a protocol reserve.
contract DeployFeeACL is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address borrower = vm.envAddress("BORROWER");

        address usdc = vm.envAddress("USDC");
        address poolAddr = vm.envAddress("POOL");
        address stakingAddr = vm.envAddress("STAKING");
        address reserve = vm.envAddress("RESERVE");

        vm.startBroadcast(deployerPk);

        AgentCreditLineKCLFee acl = new AgentCreditLineKCLFee(
            IERC20(usdc),
            ACLPool(poolAddr),
            KCLStaking(stakingAddr),
            borrower,
            reserve,
            50, // 0.50% borrow fee
            50,
            1,
            1,
            2,
            1000,
            -1000,
            10_000_000e18,
            5000
        );

        vm.stopBroadcast();

        console2.log("AgentCreditLineKCLFee:", address(acl));
    }
}
