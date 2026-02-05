// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {MockUSDC} from "../src/MockUSDC.sol";
import {ACLPool} from "../src/ACLPool.sol";
import {ProtocolReserve} from "../src/ProtocolReserve.sol";
import {KCLStaking} from "../src/KCLStaking.sol";
import {AgentCreditLineKCLFee} from "../src/AgentCreditLineKCLFee.sol";
import {StrategyMock} from "../src/StrategyMock.sol";
import {MessageHashUtils} from "openzeppelin-contracts/utils/cryptography/MessageHashUtils.sol";

contract AgentCreditLineKCLFeeTest is Test {
    MockUSDC usdc;
    ACLPool pool;
    ProtocolReserve reserve;
    KCLStaking staking;
    AgentCreditLineKCLFee acl;
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
        reserve = new ProtocolReserve(borrower);
        staking = new KCLStaking(usdc); // irrelevant for this test

        acl = new AgentCreditLineKCLFee(
            usdc, pool, staking, borrower, address(reserve), 50, 8000, 10, 1, 1, 2, 1000, -1000, 0, 0
        );

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

    function testSlashBondWhenDelinquent() public {
        vm.startPrank(borrower);
        acl.borrow(10_000e6);
        vm.stopPrank();

        // move forward > 2 epochs behind
        vm.roll(block.number + 31);

        assertTrue(acl.slashable());

        uint256 poolBefore = usdc.balanceOf(address(pool));

        acl.slashBond(2_000e6);

        uint256 poolAfter = usdc.balanceOf(address(pool));
        assertEq(poolAfter - poolBefore, 2_000e6);

        (,,, uint256 debt,,,,,,) = acl.state();
        assertEq(debt, 8_000e6);
    }
}
