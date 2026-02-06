# Klaave V2 Roadmap - Agent Economy Improvements

**Based on:** Competitive analysis vs. AAVE, Yearn, Olympus, Compound, Maker  
**Goal:** Transform Klaave from MVP to production-ready agent lending primitive  
**Timeline:** 1 week for critical features, 1 month for full V2

---

## 🎯 V2 Core Features (1 Week Sprint)

### 1. Dynamic Interest Rates ⚡

**Current Problem:**
- Fixed 200 bps borrow fee regardless of pool utilization
- Lenders can't earn market rates
- Pool can't self-balance supply/demand

**Solution: AAVE-Style Utilization Curve**

```solidity
// Add to AgentCreditLineKCLFee.sol
function calculateBorrowRate() public view returns (uint256) {
    uint256 totalAssets = pool.totalAssets();
    uint256 totalBorrowed = pool.totalAssets() - pool.availableLiquidity();
    uint256 utilization = (totalBorrowed * 1e18) / totalAssets;
    
    uint256 optimalUtilization = 0.8e18; // 80%
    uint256 baseRate = 0.02e18; // 2%
    uint256 rateSlope1 = 0.04e18; // 4%
    uint256 rateSlope2 = 0.6e18; // 60%
    
    if (utilization <= optimalUtilization) {
        return baseRate + (utilization * rateSlope1) / optimalUtilization;
    } else {
        uint256 excess = utilization - optimalUtilization;
        uint256 maxExcess = 1e18 - optimalUtilization;
        return baseRate + rateSlope1 + (excess * rateSlope2) / maxExcess;
    }
}
```

**Implementation:**
- [ ] Add `calculateBorrowRate()` function
- [ ] Update `borrow()` to use dynamic rate
- [ ] Add `currentBorrowRate()` view for frontends
- [ ] Test edge cases (0% utilization, 100% utilization)

**Impact:**
- Lenders earn market rates (higher when utilization is high)
- Agents can time borrows for lower costs
- Pool self-balances without governance

---

### 2. Transparent Health Factor 🏥

**Current Problem:**
- "Score" is opaque integer (-100 to +500)
- External contracts can't assess risk
- Not compatible with AAVE/Compound dashboards

**Solution: Standard Health Factor**

```solidity
// Add to AgentCreditLineKCLFee.sol
function healthFactor() public view returns (uint256) {
    if (state.debt == 0) return type(uint256).max;
    
    // Health factor = (bond value) / (debt)
    // Measured in 1e18 scale (1.5e18 = 150% = healthy)
    uint256 bondValue = state.bond;
    uint256 debtValue = state.debt;
    
    return (bondValue * 1e18) / debtValue;
}

function isLiquidatable() public view returns (bool) {
    // Liquidatable when health factor < 1.0 (100%)
    return healthFactor() < 1e18;
}
```

**Implementation:**
- [ ] Add `healthFactor()` view function
- [ ] Add `isLiquidatable()` helper
- [ ] Update frontend to display health factor
- [ ] Document in README for integrators

**Impact:**
- AAVE-compatible risk assessment
- External protocols can use Klaave positions as collateral
- Standardized liquidation trigger

---

### 3. Liquidation Incentives 💰

**Current Problem:**
- `slashBond()` has no incentive for caller
- Keepers have no reason to monitor positions
- Lenders exposed to bad debt longer

**Solution: Liquidation Bonus**

```solidity
// Update slashBond in AgentCreditLineKCLFee.sol
function slashBond(uint256 amount) external {
    if (!slashable()) revert NotSlashable();
    require(amount > 0, "amount=0");

    uint256 a = amount;
    if (a > state.bond) a = state.bond;
    if (a > state.debt) a = state.debt;

    // 5% liquidation bonus
    uint256 liquidationBonus = (a * 500) / 10000; // 5% of slashed amount
    uint256 toPool = a - liquidationBonus;
    
    state.bond -= a;
    state.debt -= a;

    // Transfer slashed funds
    IERC20(asset).safeTransfer(address(pool), toPool);
    IERC20(asset).safeTransfer(msg.sender, liquidationBonus); // Bonus to liquidator
    
    emit BondSlashed(msg.sender, a, liquidationBonus, state.bond, state.debt);
}
```

**Implementation:**
- [ ] Add liquidation bonus parameter (5% default)
- [ ] Update `slashBond()` to split funds
- [ ] Add `liquidationBonus()` view for frontends
- [ ] Update keeper bot to monitor positions

**Impact:**
- Keepers compete to liquidate (faster bad debt resolution)
- Permissionless liquidations (zero human intervention)
- Lenders protected from losses

---

### 4. ERC4626 Pool Shares 📦

**Current Problem:**
- Pool shares are basic ERC20
- Can't be used as collateral in AAVE/Compound
- No standard preview functions

**Solution: ERC4626 Vault Standard**

```solidity
// Update ACLPool.sol to implement ERC4626
contract ACLPool is ERC4626 {
    // Already have most functions, just add:
    
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }
    
    function convertToShares(uint256 assets) public view override returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? assets : (assets * supply) / totalAssets();
    }
    
    function convertToAssets(uint256 shares) public view override returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? shares : (shares * totalAssets()) / supply;
    }
    
    function previewDeposit(uint256 assets) public view override returns (uint256) {
        return convertToShares(assets);
    }
    
    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        return convertToShares(assets);
    }
}
```

**Implementation:**
- [ ] Import OpenZeppelin ERC4626
- [ ] Implement missing interface functions
- [ ] Update deposit/withdraw to match standard
- [ ] Test with AAVE/Yearn integrations

**Impact:**
- Pool shares usable as collateral in other protocols
- Lenders can leverage positions
- Compatible with Yearn/Beefy/Convex aggregators

---

## 🚀 V2 Extended Features (2-4 Weeks)

### 5. Flash Loans

**Why:**
- Unlock $100B+ volume (AAVE's biggest revenue driver)
- Enable atomic arb, liquidation, refinancing
- Unique primitive for agent economy

**Implementation:**
```solidity
function flashLoan(
    address receiver,
    uint256 amount,
    bytes calldata data
) external {
    uint256 balanceBefore = IERC20(asset).balanceOf(address(this));
    
    // Transfer to receiver
    IERC20(asset).safeTransfer(receiver, amount);
    
    // Callback
    IFlashLoanReceiver(receiver).executeOperation(amount, flashFee, data);
    
    // Check repayment
    uint256 balanceAfter = IERC20(asset).balanceOf(address(this));
    require(balanceAfter >= balanceBefore + flashFee, "FlashLoanNotRepaid");
    
    emit FlashLoan(receiver, amount, flashFee);
}
```

**Effort:** 1-2 days  
**Risk:** High (security-critical)

---

### 6. Multi-Asset Collateral

**Why:**
- Agents often hold ETH, WBTC, stETH
- Forcing USDC-only limits addressable market

**Implementation:**
- Add Chainlink/Pyth price feeds
- Support ETH, WBTC, USDC, DAI as bond
- Convert bond value to USD for credit limit calcs

**Effort:** 3-5 days  
**Risk:** Medium (oracle dependency)

---

### 7. Strategy Whitelist Registry

**Why:**
- Lenders can't verify borrowers are using real strategies
- Opens door to bad actors

**Implementation:**
```solidity
contract StrategyRegistry {
    mapping(address => bool) public isApproved;
    
    function registerStrategy(address strategy) external onlyGovernance {
        isApproved[strategy] = true;
    }
}

// In AgentCreditLine:
function linkStrategy(address strategy, bytes calldata sig) external {
    require(strategyRegistry.isApproved(strategy), "StrategyNotWhitelisted");
    // ... rest of linking logic
}
```

**Effort:** 2-3 days  
**Risk:** Low (additive feature)

---

## 📊 Success Metrics

### Before V2 (Current)
- ✅ Works on Monad mainnet with real USDC
- ✅ Manual operations (slashing, fees)
- ❌ Fixed rates, no incentives
- ❌ Not composable

### After V2 (Target)
- ✅ Dynamic rates self-balance pool
- ✅ Automated liquidations (zero human intervention)
- ✅ Pool shares usable in AAVE/Compound/Yearn
- ✅ Flash loans enabled
- ✅ Multi-chain deployment ready
- ✅ Agent reputation system foundation

### V2 KPIs
- **TVL Target:** $100K → $1M (10x growth)
- **Active Borrowers:** 1 → 10 agents
- **Liquidation Speed:** Manual → <5 min automated
- **Interest Rate Optimization:** Fixed 2% → Market-clearing (2-10% dynamic)

---

## 🛠️ Implementation Order (This Week)

**Day 1:**
- [ ] Dynamic interest rate function
- [ ] Test utilization curve edge cases
- [ ] Update borrow() to use dynamic rate

**Day 2:**
- [ ] Health factor view function
- [ ] Update slashBond with liquidation bonus
- [ ] Test liquidation incentive math

**Day 3:**
- [ ] ERC4626 compliance (pool shares)
- [ ] Update frontend for new features
- [ ] Write integration tests

**Day 4:**
- [ ] Multi-chain deployment scripts (Base, Arbitrum)
- [ ] Deploy V2 to testnets
- [ ] Keeper bot updates for liquidations

**Day 5:**
- [ ] Mainnet deployment (Monad + Base)
- [ ] Documentation updates
- [ ] Announce V2 on Moltbook/MoltX

---

## 🎯 Competitive Positioning After V2

**Before:** "Klaave is an agent credit line"  
**After:** "Klaave is AAVE for autonomous agents"

**Moats:**
- ✅ Only lending protocol with performance-based credit
- ✅ Agent-native design (no human UX assumptions)
- ✅ Composable with all major DeFi protocols
- ✅ Multi-chain from day 1
- ✅ Flash loans for agent capital efficiency

**Path to $1B TVL:** 3-6 months post-V2 launch

---

**Ready to build?** Start with dynamic interest rates (highest impact, lowest risk).

**Next commit:** Implement `calculateBorrowRate()` function
