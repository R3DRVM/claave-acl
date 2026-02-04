// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";

import {ACLPool} from "../src/ACLPool.sol";
import {KCLStaking} from "../src/KCLStaking.sol";
import {ProtocolReserve} from "../src/ProtocolReserve.sol";
import {AgentCreditLineKCLFee} from "../src/AgentCreditLineKCLFee.sol";

/// @notice Deploy a fresh Pool+Staking+Reserve+FeeACL wired to real USDC on Monad.
contract DeployRealUSDC_FeeReserve is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address borrower = vm.envAddress("BORROWER");
        address usdc = vm.envAddress("USDC");

        vm.startBroadcast(deployerPk);

        address kclToken = vm.envAddress("KCL");

        ACLPool pool = new ACLPool(IERC20(usdc));
        KCLStaking staking = new KCLStaking(IERC20(kclToken));
        ProtocolReserve reserve = new ProtocolReserve(borrower);

        AgentCreditLineKCLFee acl = new AgentCreditLineKCLFee(
            IERC20(usdc),
            pool,
            staking,
            borrower,
            address(reserve),
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

        pool.setCreditLine(address(acl));

        vm.stopBroadcast();

        console2.log("USDC:", usdc);
        console2.log("ACLPool:", address(pool));
        console2.log("KCLStaking:", address(staking));
        console2.log("ProtocolReserve:", address(reserve));
        console2.log("AgentCreditLineKCLFee:", address(acl));
    }
}
