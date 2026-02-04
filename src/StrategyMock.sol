// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "openzeppelin-contracts/access/Ownable.sol";

/// @notice MVP strategy "account" controlled by an agent.
/// For now it can simulate returns by moving funds to/from itself via an authorized actor.
/// This is intentionally simple: PnL is computed from on-chain balance deltas.
contract StrategyMock is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset;

    event SimulatedReturn(int256 pnl, uint256 newBalance);

    constructor(IERC20 asset_, address owner_) Ownable(owner_) {
        asset = asset_;
    }

    function balance() external view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /// @notice Simulate PnL by transferring tokens in/out.
    /// Positive pnl requires caller to have pre-funded this contract (or mint) and transfer in.
    /// Negative pnl transfers out to the owner.
    function simulatePnL(int256 pnl) external onlyOwner {
        if (pnl < 0) {
            uint256 amt = uint256(-pnl);
            asset.safeTransfer(owner(), amt);
        }
        emit SimulatedReturn(pnl, asset.balanceOf(address(this)));
    }

    /// @notice Rescue tokens (owner only).
    function sweep(address to, uint256 amount) external onlyOwner {
        asset.safeTransfer(to, amount);
    }
}
