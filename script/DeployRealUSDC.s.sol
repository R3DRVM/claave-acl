// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";

import {ACLPool} from "../src/ACLPool.sol";
import {KCLStaking} from "../src/KCLStaking.sol";
import {AgentCreditLineKCL} from "../src/AgentCreditLineKCL.sol";

/// @notice Deploy Klaave against *real* Monad USDC (for real DEX swaps).
contract DeployRealUSDC is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address borrower = vm.envAddress("BORROWER");

        address usdc = vm.envAddress("USDC");
        address kcl = vm.envAddress("KCL");

        vm.startBroadcast(deployerPk);

        ACLPool pool = new ACLPool(IERC20(usdc));
        KCLStaking staking = new KCLStaking(IERC20(kcl));

        // Demo parameters: keep it responsive for judges.
        // NOTE: aBond/bPerf/etc are intentionally simple right now.
        AgentCreditLineKCL acl = new AgentCreditLineKCL(
            IERC20(usdc),
            pool,
            staking,
            borrower,
            50, // epochBlocks
            1, // aBond
            1, // bPerf
            2, // cLoss
            1000, // dFailure
            -1000, // freezeScore
            10_000_000e18, // kclTarget
            5000 // maxBoostBps (+50%)
        );

        vm.stopBroadcast();

        console2.log("USDC:", usdc);
        console2.log("ACLPool:", address(pool));
        console2.log("KCLStaking:", address(staking));
        console2.log("AgentCreditLineKCL:", address(acl));
    }
}
