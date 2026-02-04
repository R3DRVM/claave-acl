// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {MockUSDC} from "../src/MockUSDC.sol";
import {ACLPool} from "../src/ACLPool.sol";
import {AgentCreditLine} from "../src/AgentCreditLine.sol";
import {StrategyMock} from "../src/StrategyMock.sol";
import {MessageHashUtils} from "openzeppelin-contracts/utils/cryptography/MessageHashUtils.sol";

contract AgentCreditLineTest is Test {
    MockUSDC usdc;
    ACLPool pool;
    AgentCreditLine acl;
    StrategyMock strat;

    uint256 lenderPk = 0xA11CE;
    uint256 borrowerPk = 0xB0B0;
    address lender;
    address borrower;

    function setUp() public {
        lender = vm.addr(lenderPk);
        borrower = vm.addr(borrowerPk);

        usdc = new MockUSDC("Mock USDC", "mUSDC", 6);
        pool = new ACLPool(usdc);
        acl = new AgentCreditLine(usdc, pool, borrower, 10, 1, 1, 2, 1000, -1000);
        pool.setCreditLine(address(acl));
        strat = new StrategyMock(usdc, borrower);

        usdc.mint(lender, 1_000_000e6);
        usdc.mint(borrower, 200_000e6);

        // lender deposits
        vm.startPrank(lender);
        usdc.approve(address(pool), type(uint256).max);
        pool.deposit(500_000e6, lender);
        vm.stopPrank();

        // borrower links strategy
        bytes32 digest = keccak256(abi.encodePacked("ACL_LINK", address(acl), borrower, address(strat)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerPk, MessageHashUtils.toEthSignedMessageHash(digest));
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.startPrank(borrower);
        acl.linkStrategy(address(strat), sig);
        usdc.approve(address(acl), type(uint256).max);
        acl.postBond(50_000e6);
        vm.stopPrank();
    }

    function testBorrowRepayAndEpoch() public {
        vm.startPrank(borrower);
        uint256 lim0 = acl.creditLimit();
        assertGt(lim0, 0);

        acl.borrow(10_000e6);
        (,,, uint256 debt,,,,,,) = acl.state();
        assertEq(debt, 10_000e6);

        // simulate profit by transferring extra funds into strategy
        usdc.transfer(address(strat), 2_000e6);

        // roll forward epochs
        vm.roll(block.number + 11);
        vm.stopPrank();

        acl.updateEpoch();

        vm.startPrank(borrower);
        acl.repay(10_000e6);
        (,,, uint256 debt2,,,,,,) = acl.state();
        assertEq(debt2, 0);
        vm.stopPrank();
    }
}
