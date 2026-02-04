// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {ACLPool} from "../src/ACLPool.sol";
import {KCLStaking} from "../src/KCLStaking.sol";
import {AgentCreditLineKCL} from "../src/AgentCreditLineKCL.sol";

contract DeployKCL is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address borrower = vm.envAddress("BORROWER");

        // Existing deployed addresses (from v1)
        address mUSDC = vm.envAddress("MUSDC");
        address poolAddr = vm.envAddress("POOL");
        address kclToken = vm.envAddress("KCL");

        vm.startBroadcast(deployerPk);

        KCLStaking staking = new KCLStaking(IERC20(kclToken));

        // params tuned for demo
        AgentCreditLineKCL acl = new AgentCreditLineKCL(
            IERC20(mUSDC),
            ACLPool(poolAddr),
            staking,
            borrower,
            50,
            1,
            1,
            2,
            1000,
            -1000,
            10_000_000e18, // kclTarget: 10M KCL => full boost
            5000 // maxBoostBps: +50%
        );

        vm.stopBroadcast();

        console2.log("KCLStaking:", address(staking));
        console2.log("AgentCreditLineKCL:", address(acl));
    }
}
