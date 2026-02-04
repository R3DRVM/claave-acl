// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal KCL staking contract.
/// Agents stake KCL to boost their credit line multiplier.
/// No governance, no emissions. Pure utility: stake -> multiplier.
contract KCLStaking {
    using SafeERC20 for IERC20;

    IERC20 public immutable kcl;

    mapping(address => uint256) public staked;

    event Staked(address indexed user, uint256 amount, uint256 total);
    event Unstaked(address indexed user, uint256 amount, uint256 remaining);

    constructor(IERC20 kcl_) {
        kcl = kcl_;
    }

    function stake(uint256 amount) external {
        require(amount > 0, "amount=0");
        staked[msg.sender] += amount;
        kcl.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount, staked[msg.sender]);
    }

    function unstake(uint256 amount) external {
        require(amount > 0, "amount=0");
        uint256 bal = staked[msg.sender];
        require(bal >= amount, "insufficient");
        staked[msg.sender] = bal - amount;
        kcl.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount, staked[msg.sender]);
    }
}
