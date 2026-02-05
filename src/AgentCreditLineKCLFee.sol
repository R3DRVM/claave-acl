// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "openzeppelin-contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "openzeppelin-contracts/utils/cryptography/MessageHashUtils.sol";

import {ACLPool} from "./ACLPool.sol";
import {KCLStaking} from "./KCLStaking.sol";

/// @notice Agent-native revolving credit line with:
/// - KCL staking -> credit limit boost
/// - Borrow fee -> protocol reserve (Olympus-style treasury primitive)
contract AgentCreditLineKCLFee {
    using SafeERC20 for IERC20;

    struct State {
        address borrower;
        address strategy;
        uint256 bond;
        uint256 debt;
        int256 score;
        uint256 failures;
        bool borrowDisabled;
        uint64 epoch;
        uint64 lastUpdatedBlock;
        uint256 lastEquity;
    }

    IERC20 public immutable asset;
    ACLPool public immutable pool;
    KCLStaking public immutable staking;

    address public immutable reserve;
    uint16 public immutable borrowFeeBps; // e.g. 50 = 0.50%
    uint16 public immutable lendersFeeShareBps; // share of fee sent to pool (0-10000)
    uint256 public feesAccrued;
    uint256 public feesToLendersAccrued;

    uint256 public immutable epochBlocks;
    int256 public immutable aBond;
    int256 public immutable bPerf;
    int256 public immutable cLoss;
    int256 public immutable dFailure;
    int256 public immutable freezeScore;

    uint256 public immutable kclTarget;
    uint256 public immutable maxBoostBps;

    State public state;

    event Linked(address indexed borrower, address indexed strategy);
    event BondPosted(address indexed borrower, uint256 amount, uint256 totalBond);
    event Borrowed(address indexed borrower, uint256 grossAmount, uint256 fee, uint256 netAmount, uint256 debt);
    event FeeSplit(uint256 toReserve, uint256 toLenders);
    event Repaid(address indexed borrower, uint256 amount, uint256 debt);
    event EpochUpdated(uint64 epoch, int256 perf, int256 score, uint256 equity);
    event CreditLimitUpdated(uint256 oldLimit, uint256 newLimit, bool frozen, uint256 boostBps);
    event FeeAccrued(uint256 fee, uint256 totalFees);
    event BondSlashed(address indexed caller, uint256 amount, uint256 newBond, uint256 newDebt);

    error NotBorrower();
    error NotReady();
    error Frozen();
    error Limit();
    error NotSlashable();

    constructor(
        IERC20 asset_,
        ACLPool pool_,
        KCLStaking staking_,
        address borrower_,
        address reserve_,
        uint16 borrowFeeBps_,
        uint16 lendersFeeShareBps_,
        uint256 epochBlocks_,
        int256 aBond_,
        int256 bPerf_,
        int256 cLoss_,
        int256 dFailure_,
        int256 freezeScore_,
        uint256 kclTarget_,
        uint256 maxBoostBps_
    ) {
        asset = asset_;
        pool = pool_;
        staking = staking_;
        state.borrower = borrower_;
        reserve = reserve_;
        borrowFeeBps = borrowFeeBps_;
        lendersFeeShareBps = lendersFeeShareBps_;

        epochBlocks = epochBlocks_;
        aBond = aBond_;
        bPerf = bPerf_;
        cLoss = cLoss_;
        dFailure = dFailure_;
        freezeScore = freezeScore_;

        kclTarget = kclTarget_;
        maxBoostBps = maxBoostBps_;

        state.lastUpdatedBlock = uint64(block.number);
    }

    modifier onlyBorrower() {
        if (msg.sender != state.borrower) revert NotBorrower();
        _;
    }

    function currentEpoch() public view returns (uint64) {
        return uint64(block.number / epochBlocks);
    }

    function boostBps(address who) public view returns (uint256) {
        if (kclTarget == 0 || maxBoostBps == 0) return 0;
        uint256 s = staking.staked(who);
        if (s == 0) return 0;
        if (s >= kclTarget) return maxBoostBps;
        return (s * maxBoostBps) / kclTarget;
    }

    function _rawLimit() internal view returns (int256) {
        return aBond * int256(state.bond) + state.score - dFailure * int256(state.failures);
    }

    function creditLimit() public view returns (uint256) {
        int256 lim = _rawLimit();
        if (lim <= 0) return 0;

        uint256 bps = boostBps(state.borrower);
        uint256 u = uint256(lim);
        u = (u * (10_000 + bps)) / 10_000;

        uint256 cap = pool.availableLiquidity();
        return u > cap ? cap : u;
    }

    function availableToBorrow() public view returns (uint256) {
        uint256 lim = creditLimit();
        if (state.debt >= lim) return 0;
        return lim - state.debt;
    }

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

    function borrow(uint256 grossAmount) external onlyBorrower {
        if (state.borrowDisabled) revert Frozen();
        require(state.strategy != address(0), "no strategy");

        uint256 avail = availableToBorrow();
        if (grossAmount > avail) revert Limit();

        uint256 fee = (grossAmount * borrowFeeBps) / 10_000;
        uint256 net = grossAmount - fee;

        state.debt += grossAmount;

        if (fee > 0) {
            uint256 toLenders = (fee * lendersFeeShareBps) / 10_000;
            uint256 toReserve = fee - toLenders;

            if (toReserve > 0) {
                pool.transferTo(reserve, toReserve);
            }
            if (toLenders > 0) {
                // increase pool assets directly (lenders benefit via share price)
                pool.transferTo(address(pool), toLenders);
                feesToLendersAccrued += toLenders;
            }

            feesAccrued += fee;
            emit FeeAccrued(fee, feesAccrued);
            emit FeeSplit(toReserve, toLenders);
        }

        pool.transferTo(state.strategy, net);
        emit Borrowed(msg.sender, grossAmount, fee, net, state.debt);
    }

    function repay(uint256 amount) external onlyBorrower {
        require(amount > 0, "amount=0");
        asset.safeTransferFrom(msg.sender, address(this), amount);
        asset.safeTransfer(address(pool), amount);

        if (amount >= state.debt) state.debt = 0;
        else state.debt -= amount;

        emit Repaid(msg.sender, amount, state.debt);
    }

    function isDelinquent() public view returns (bool) {
        // delinquent if we are more than 2 epochs behind
        uint64 e = currentEpoch();
        return (e > state.epoch + 2);
    }

    function slashable() public view returns (bool) {
        // strict rule: only slash when there is outstanding debt and either
        // (a) the line is frozen, or (b) the borrower is delinquent on updates.
        if (state.debt == 0) return false;
        return state.borrowDisabled || isDelinquent();
    }

    /// @notice Anyone can slash bond to repay debt when the borrower is frozen or delinquent.
    /// Slashed funds go directly to the pool, reducing debt 1:1.
    function slashBond(uint256 amount) external {
        if (!slashable()) revert NotSlashable();
        require(amount > 0, "amount=0");

        uint256 a = amount;
        if (a > state.bond) a = state.bond;
        if (a > state.debt) a = state.debt;

        state.bond -= a;
        state.debt -= a;

        asset.safeTransfer(address(pool), a);

        emit BondSlashed(msg.sender, a, state.bond, state.debt);
    }

    function updateEpoch() external {
        if (state.strategy == address(0)) revert NotReady();

        uint64 e = currentEpoch();
        if (e <= state.epoch) revert NotReady();

        uint256 equity = asset.balanceOf(state.strategy);
        int256 perf = int256(equity) - int256(state.lastEquity);

        if (perf >= 0) state.score += bPerf * perf;
        else state.score -= cLoss * (-perf);

        uint64 expectedBlock = (state.epoch + 1) * uint64(epochBlocks);
        if (block.number > expectedBlock + 2 * epochBlocks) state.failures += 1;

        uint256 oldLimit = creditLimit();

        state.epoch = e;
        state.lastUpdatedBlock = uint64(block.number);
        state.lastEquity = equity;

        bool frozen = (state.score < freezeScore);
        state.borrowDisabled = frozen;

        uint256 newLimit = creditLimit();
        uint256 bps = boostBps(state.borrower);

        emit EpochUpdated(e, perf, state.score, equity);
        emit CreditLimitUpdated(oldLimit, newLimit, frozen, bps);
    }
}
