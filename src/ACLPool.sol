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
    address public owner;
    address public creditLine;

    event Deposit(address indexed lender, uint256 assets, uint256 shares);
    event Withdraw(address indexed lender, uint256 assets, uint256 shares);
    event CreditLineSet(address indexed creditLine);
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);

    error NotOwner();
    error NotCreditLine();
    error CreditLineAlreadySet();

    constructor(IERC20 asset_) ERC20("ACL Pool Share", "ACL-S") {
        asset = asset_;
        owner = msg.sender;
        emit OwnerUpdated(address(0), msg.sender);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyCreditLine() {
        if (msg.sender != creditLine) revert NotCreditLine();
        _;
    }

    function setOwner(address newOwner) external onlyOwner {
        address old = owner;
        owner = newOwner;
        emit OwnerUpdated(old, newOwner);
    }

    /// @notice Set the authorized credit line contract (one-time).
    function setCreditLine(address creditLine_) external onlyOwner {
        if (creditLine != address(0)) revert CreditLineAlreadySet();
        creditLine = creditLine_;
        emit CreditLineSet(creditLine_);
    }

    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function availableLiquidity() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function previewDeposit(uint256 assets) public view returns (uint256 shares) {
        uint256 supply = totalSupply();
        uint256 assetsInPool = totalAssets();
        // If the pool was drained (e.g. borrower draws) but shares remain,
        // allow fresh deposits to re-seed without division-by-zero.
        if (supply == 0 || assetsInPool == 0) return assets;
        return (assets * supply) / assetsInPool;
    }

    function previewWithdraw(uint256 assets) public view returns (uint256 shares) {
        uint256 supply = totalSupply();
        uint256 assetsInPool = totalAssets();
        if (supply == 0 || assetsInPool == 0) return 0;
        return (assets * supply + (assetsInPool - 1)) / assetsInPool;
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
    function transferTo(address to, uint256 assets) external onlyCreditLine {
        asset.safeTransfer(to, assets);
    }
}
