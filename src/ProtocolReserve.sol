// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal protocol reserve/treasury.
/// Designed for agent-operated protocols: it can receive ERC20 fees and allow an owner
/// (e.g. a multisig or agent controller) to move funds.
contract ProtocolReserve {
    using SafeERC20 for IERC20;

    address public owner;

    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);
    event Swept(address indexed token, address indexed to, uint256 amount);

    error NotOwner();

    constructor(address owner_) {
        owner = owner_;
        emit OwnerUpdated(address(0), owner_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setOwner(address newOwner) external onlyOwner {
        address old = owner;
        owner = newOwner;
        emit OwnerUpdated(old, newOwner);
    }

    function sweep(IERC20 token, address to, uint256 amount) external onlyOwner {
        token.safeTransfer(to, amount);
        emit Swept(address(token), to, amount);
    }
}
