// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "openzeppelin-contracts/token/ERC20/ERC20.sol";

/// @notice Minimal deposit/withdraw pool. Shares represent claim on underlying.
/// Not trying to be a full ERC4626 in MVP; just "real money in a contract" + accounting.
contract ACLPool is ERC20 {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset;

    event Deposit(address indexed lender, uint256 assets, uint256 shares);
    event Withdraw(address indexed lender, uint256 assets, uint256 shares);

    constructor(IERC20 asset_) ERC20("ACL Pool Share", "ACL-S") {
        asset = asset_;
    }

    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function availableLiquidity() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function previewDeposit(uint256 assets) public view returns (uint256 shares) {
        uint256 supply = totalSupply();
        if (supply == 0) return assets;
        return (assets * supply) / totalAssets();
    }

    function previewWithdraw(uint256 assets) public view returns (uint256 shares) {
        uint256 supply = totalSupply();
        return supply == 0 ? 0 : (assets * supply + (totalAssets() - 1)) / totalAssets();
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        require(assets > 0, "assets=0");
        shares = previewDeposit(assets);
        _mint(receiver, shares);
        asset.safeTransferFrom(msg.sender, address(this), assets);
        emit Deposit(receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        require(assets > 0, "assets=0");
        shares = previewWithdraw(assets);
        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            require(allowed >= shares, "allowance");
            _approve(owner, msg.sender, allowed - shares);
        }
        _burn(owner, shares);
        asset.safeTransfer(receiver, assets);
        emit Withdraw(owner, assets, shares);
    }

    /// @notice Called by the credit line to fund a borrower draw.
    function transferTo(address to, uint256 assets) external {
        asset.safeTransfer(to, assets);
    }
}
