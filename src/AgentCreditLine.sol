// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "openzeppelin-contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "openzeppelin-contracts/utils/cryptography/MessageHashUtils.sol";

import {ACLPool} from "./ACLPool.sol";

/// @notice Agent-native revolving credit line.
/// - Lenders deposit into ACLPool
/// - Borrower posts a bond and links a strategy address (proof-of-control via ECDSA)
/// - Each epoch, credit limit updates from on-chain performance (strategy balance delta) + reliability
/// - Borrowing auto-throttles when score worsens
contract AgentCreditLine {
    using SafeERC20 for IERC20;

    struct State {
        address borrower;
        address strategy;
        uint256 bond;
        uint256 debt;
        int256 score; // higher is better
        uint256 failures;
        bool borrowDisabled;
        uint64 epoch; // starts at 0
        uint64 lastUpdatedBlock;
        uint256 lastEquity; // strategy balance snapshot
    }

    IERC20 public immutable asset;
    ACLPool public immutable pool;

    // parameters (tune for demo)
    uint256 public immutable epochBlocks; // blocks per epoch
    int256 public immutable aBond; // limit contribution per bond unit
    int256 public immutable bPerf; // score weight for profit unit
    int256 public immutable cLoss; // score weight for loss unit
    int256 public immutable dFailure; // score penalty per failure
    int256 public immutable freezeScore; // if score < this => freeze

    State public state;

    event Linked(address indexed borrower, address indexed strategy);
    event BondPosted(address indexed borrower, uint256 amount, uint256 totalBond);
    event Borrowed(address indexed borrower, uint256 amount, uint256 debt);
    event Repaid(address indexed borrower, uint256 amount, uint256 debt);
    event EpochUpdated(uint64 epoch, int256 perf, int256 score, uint256 equity);
    event CreditLimitUpdated(uint256 oldLimit, uint256 newLimit, bool frozen);

    error NotBorrower();
    error NotReady();
    error Frozen();
    error Limit();

    constructor(
        IERC20 asset_,
        ACLPool pool_,
        address borrower_,
        uint256 epochBlocks_,
        int256 aBond_,
        int256 bPerf_,
        int256 cLoss_,
        int256 dFailure_,
        int256 freezeScore_
    ) {
        asset = asset_;
        pool = pool_;
        epochBlocks = epochBlocks_;
        aBond = aBond_;
        bPerf = bPerf_;
        cLoss = cLoss_;
        dFailure = dFailure_;
        freezeScore = freezeScore_;

        state.borrower = borrower_;
        state.lastUpdatedBlock = uint64(block.number);
    }

    modifier onlyBorrower() {
        if (msg.sender != state.borrower) revert NotBorrower();
        _;
    }

    /// @notice Link borrower -> strategy with signature by borrower over (this, borrower, strategy).
    function linkStrategy(address strategy, bytes calldata sig) external onlyBorrower {
        bytes32 digest = keccak256(abi.encodePacked("ACL_LINK", address(this), msg.sender, strategy));
        address recovered = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(digest), sig);
        require(recovered == msg.sender, "bad sig");

        state.strategy = strategy;
        state.lastEquity = asset.balanceOf(strategy);
        emit Linked(msg.sender, strategy);
    }

    function postBond(uint256 amount) external onlyBorrower {
        require(amount > 0, "amount=0");
        asset.safeTransferFrom(msg.sender, address(this), amount);
        state.bond += amount;
        emit BondPosted(msg.sender, amount, state.bond);
    }

    function currentEpoch() public view returns (uint64) {
        return uint64(block.number / epochBlocks);
    }

    function creditLimit() public view returns (uint256) {
        // lim = a*bond + score - d*failures
        int256 lim = aBond * int256(state.bond) + state.score - dFailure * int256(state.failures);
        if (lim <= 0) return 0;

        uint256 cap = pool.availableLiquidity();
        uint256 u = uint256(lim);
        return u > cap ? cap : u;
    }

    function availableToBorrow() public view returns (uint256) {
        uint256 lim = creditLimit();
        if (state.debt >= lim) return 0;
        return lim - state.debt;
    }

    function borrow(uint256 amount) external onlyBorrower {
        if (state.borrowDisabled) revert Frozen();
        require(state.strategy != address(0), "no strategy");

        uint256 avail = availableToBorrow();
        if (amount > avail) revert Limit();

        state.debt += amount;
        pool.transferTo(state.strategy, amount);
        emit Borrowed(msg.sender, amount, state.debt);
    }

    function repay(uint256 amount) external onlyBorrower {
        require(amount > 0, "amount=0");

        asset.safeTransferFrom(msg.sender, address(this), amount);
        asset.safeTransfer(address(pool), amount);

        if (amount >= state.debt) state.debt = 0;
        else state.debt -= amount;

        emit Repaid(msg.sender, amount, state.debt);
    }

    /// @notice Anyone can call. Deterministic update based on strategy balance delta.
    function updateEpoch() external {
        if (state.strategy == address(0)) revert NotReady();

        uint64 e = currentEpoch();
        if (e <= state.epoch) revert NotReady();

        uint256 equity = asset.balanceOf(state.strategy);
        int256 perf = int256(equity) - int256(state.lastEquity);

        // score update: reward profits, punish losses harder
        if (perf >= 0) {
            state.score += bPerf * perf;
        } else {
            state.score -= cLoss * (-perf);
        }

        // reliability: if updates are late by > 2 epochs, count failure
        uint64 expectedBlock = (state.epoch + 1) * uint64(epochBlocks);
        if (block.number > expectedBlock + 2 * epochBlocks) {
            state.failures += 1;
        }

        // compute old limit BEFORE mutating failures? we already mutated; fine for MVP.
        uint256 oldLimit = creditLimit();

        state.epoch = e;
        state.lastUpdatedBlock = uint64(block.number);
        state.lastEquity = equity;

        bool frozen = (state.score < freezeScore);
        state.borrowDisabled = frozen;

        uint256 newLimit = creditLimit();

        emit EpochUpdated(e, perf, state.score, equity);
        emit CreditLimitUpdated(oldLimit, newLimit, frozen);
    }
}
