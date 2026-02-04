// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

import {MockUSDC} from "../src/MockUSDC.sol";
import {ACLPool} from "../src/ACLPool.sol";
import {AgentCreditLine} from "../src/AgentCreditLine.sol";
import {StrategyMock} from "../src/StrategyMock.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address borrower = vm.envAddress("BORROWER");

        vm.startBroadcast(deployerPk);

        MockUSDC usdc = new MockUSDC("Mock USDC", "mUSDC", 6);
        ACLPool pool = new ACLPool(usdc);

        // params tuned for demo:
        // epochBlocks: 50 blocks
        // aBond: 1 => 1:1 bond to limit
        // bPerf: 1 => profit unit adds 1 to score
        // cLoss: 2 => losses punish 2x
        // dFailure: 1000 => failures hurt hard
        // freezeScore: -1000 => freeze when too negative
        AgentCreditLine acl = new AgentCreditLine(
            usdc,
            pool,
            borrower,
            50,
            1,
            1,
            2,
            1000,
            -1000
        );

        StrategyMock strategy = new StrategyMock(usdc, borrower);

        // mint initial funds to deployer & borrower for demo
        usdc.mint(msg.sender, 1_000_000e6);
        usdc.mint(borrower, 200_000e6);

        vm.stopBroadcast();

        console2.log("MockUSDC:", address(usdc));
        console2.log("ACLPool:", address(pool));
        console2.log("AgentCreditLine:", address(acl));
        console2.log("StrategyMock:", address(strategy));
    }
}
