# Klaave V2 Agent Testing Framework - Summary

## 📋 What Was Created

A complete autonomous agent testing framework for Klaave V2 protocol on Base Sepolia testnet.

### Core Components

#### 1. **Agent Scripts** (6 total)

| Agent | File | Purpose | USDC Required |
|-------|------|---------|---------------|
| Conservative Lender | `lender.ts` | Deposits 50K USDC, optimizes yield | 60,000 |
| Aggressive Borrower | `borrower.ts` | Max borrows, tests limits | 15,000 |
| Risk-Taking Borrower | `risky-borrower.ts` | Gets liquidated intentionally | 5,000 |
| Keeper/Liquidator | `liquidator.ts` | Monitors & liquidates positions | 10,000 |
| Arbitrage Agent | `arbitrage.ts` | Exploits rate differentials | 20,000 |
| Stress Tester | `stress-tester.ts` | Pushes system to limits | 150,000 |

**Total USDC needed**: 260,000 USDC

#### 2. **Coordinator** (`coordinator.ts`)

- Spawns all 6 agents as separate processes
- Monitors agent health every 30 seconds
- Auto-restarts crashed agents (max 3 attempts)
- Generates real-time dashboard every 10 seconds
- Handles graceful shutdown on Ctrl+C

#### 3. **Shared Utilities** (`shared-utils.ts`)

- Common functions for all agents
- Logging system (writes to `logs/`)
- Metrics collection (writes to `metrics/`)
- Retry logic with exponential backoff
- Contract ABIs
- Helper functions

#### 4. **Support Files**

- `README.md` - Complete setup and usage guide
- `.env.example` - Environment variable template
- `package.json` - Dependencies and scripts
- `quick-start.sh` - Interactive setup wizard
- `preflight-check.ts` - Pre-flight verification
- `TESTNET_ADDRESSES.md` - Contract address tracker

## 🎯 Test Coverage

### Agent 1: Conservative Lender
- ✅ ERC4626 deposit/withdraw
- ✅ Share price calculations
- ✅ Yield tracking
- ✅ Rate-based decisions (withdraw < 3%, deposit > 5%)
- ✅ Continuous monitoring

### Agent 2: Aggressive Borrower
- ✅ Bond posting
- ✅ Maximum borrowing
- ✅ Over-borrow prevention (expects revert)
- ✅ Partial repayments
- ✅ Multiple borrow cycles
- ✅ Effective cost tracking

### Agent 3: Risk-Taking Borrower
- ✅ Minimum bond
- ✅ Maximum leverage (80% credit limit)
- ✅ Trading loss simulation
- ✅ Health factor monitoring
- ✅ Liquidation event capture
- ✅ Attempts to borrow when unhealthy (expects revert)

### Agent 4: Keeper/Liquidator
- ✅ Multi-line monitoring (all 5 credit lines)
- ✅ Health factor calculation
- ✅ Liquidation execution (when HF < 1.0)
- ✅ 5% bonus verification
- ✅ Pool receives 95% verification
- ✅ Liquidation speed measurement
- ✅ Profitability tracking

### Agent 5: Arbitrage Agent
- ✅ Multiple credit line management (3 lines)
- ✅ Rate differential detection
- ✅ Borrow from lowest rate line
- ✅ Deposit to pool for yield
- ✅ Capital shifting
- ✅ Cross-line interaction testing

### Agent 6: Stress Tester
- ✅ Simultaneous credit line opening (5 lines)
- ✅ Maximum borrowing from all lines
- ✅ Pool drainage to 100% utilization
- ✅ Rate spike verification (should hit ~66%)
- ✅ Simultaneous operations
- ✅ Pool solvency checks
- ✅ Stuck funds detection
- ✅ Comprehensive test report

## 🔍 What Gets Tested

### Contract Functions
- `deposit()` / `withdraw()` / `redeem()` (Pool)
- `postBond()` / `borrow()` / `repay()` (Credit Line)
- `slashBond()` (Liquidation)
- `creditLimit()` / `availableToBorrow()` (Limits)
- `healthFactor()` / `isLiquidatable()` (Health)
- `currentBorrowRate()` / `currentUtilization()` (Rates)

### Edge Cases
- First depositor (minimum liquidity lock)
- Last withdrawer
- Zero utilization pool
- 100% utilization pool
- Over-borrowing attempts
- Borrowing when unhealthy
- Simultaneous liquidations
- Race conditions (borrow vs liquidate)
- Pool insolvency scenarios

### Dynamic Rate Curve
- 0% utilization → 2% annual rate
- 50% utilization → ~4% annual rate
- 80% utilization → ~6% annual rate
- 100% utilization → ~66% annual rate

### Economic Incentives
- Lender yield is positive
- Liquidations are profitable (5% bonus)
- Pool never loses money
- Borrowing costs are predictable
- Arbitrage opportunities exist

## 📊 Metrics Collected

### Per-Agent Metrics
- Total transactions
- Successful/failed transactions
- Total gas used & cost
- Profit/loss in USDC
- Agent-specific metrics:
  - Lender: yield earned, deposit/withdraw count
  - Borrower: fees paid, effective cost, cycles
  - Risky Borrower: liquidation time, bond slashed
  - Liquidator: bonuses earned, liquidation count
  - Arbitrage: arbitrage opportunities, rate differentials
  - Stress Tester: test pass/fail rate, edge cases found

### System Metrics
- Pool TVL over time
- Pool utilization over time
- Average borrow rate
- Total fees collected
- Total liquidations
- Largest health factor drop
- Fastest liquidation time

## 📈 Real-Time Dashboard

Located in `dashboard/dashboard.txt`, updated every 10 seconds:

```
===========================================================
  KLAAVE V2 AGENT TESTING DASHBOARD
===========================================================
Timestamp: 2026-02-06T12:00:00.000Z
Uptime: 3600s

AGENTS:
-----------------------------------------------------------
🟢 lender               | running    | 3600s | restarts: 0
🟢 borrower             | running    | 3598s | restarts: 0
🟢 risky-borrower       | running    | 3596s | restarts: 0
🟢 liquidator           | running    | 3594s | restarts: 0
🟢 arbitrage            | running    | 3592s | restarts: 0
🟢 stress-tester        | running    | 3590s | restarts: 0

POOL METRICS:
-----------------------------------------------------------
Total Assets:         150000.50 USDC
Available Liquidity:  75000.25 USDC
Utilization:          50.00%
Borrow Rate:          400 bps

AGGREGATE METRICS:
-----------------------------------------------------------
Total Transactions:   245
Successful:           243
Failed:               2
Total Gas Used:       12500000
```

## 🚀 Quick Start

1. **Install dependencies**:
   ```bash
   cd scripts/agents
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   nano .env  # Fill in addresses and keys
   ```

3. **Run preflight check**:
   ```bash
   npx tsx preflight-check.ts
   ```

4. **Start simulation**:
   ```bash
   ./quick-start.sh
   # OR
   npx tsx coordinator.ts
   ```

## ✅ Success Criteria

The system passes when:
- ✅ All agents run 48+ hours without crashes
- ✅ Zero unexpected reverts (only expected test reverts)
- ✅ Pool remains solvent (TVL ≥ total debt)
- ✅ Liquidations execute within 5 minutes
- ✅ Rates follow expected curve (2% → 66%)
- ✅ Gas costs are acceptable
- ✅ No funds stuck or lost
- ✅ Transaction success rate > 95%

## 🐛 What Gets Caught

This framework will catch:
- Race conditions between borrowers and liquidators
- Pool insolvency scenarios
- Incorrect health factor calculations
- Liquidation failures or delays
- Rate curve miscalculations
- Share price manipulation attempts
- Reentrancy vulnerabilities
- Integer overflow/underflow
- Access control issues
- Edge case failures

## 📁 Output Structure

```
claave-acl/
├── scripts/agents/
│   ├── lender.ts
│   ├── borrower.ts
│   ├── risky-borrower.ts
│   ├── liquidator.ts
│   ├── arbitrage.ts
│   ├── stress-tester.ts
│   ├── coordinator.ts
│   ├── shared-utils.ts
│   ├── preflight-check.ts
│   ├── quick-start.sh
│   ├── README.md
│   ├── .env.example
│   └── package.json
├── logs/
│   ├── lender-<timestamp>.log
│   ├── borrower-<timestamp>.log
│   └── ... (one per agent)
├── metrics/
│   ├── lender-metrics.json
│   ├── borrower-metrics.json
│   └── ... (one per agent)
├── dashboard/
│   ├── dashboard.json
│   └── dashboard.txt
└── reports/
    └── final-report-<timestamp>.txt
```

## 🔧 Technical Stack

- **Language**: TypeScript
- **Runtime**: Node.js v18+ with tsx
- **Library**: ethers.js v6
- **Network**: Base Sepolia testnet
- **Contracts**: Solidity 0.8.24

## 📝 Next Steps

1. **Deploy contracts to Base Sepolia**
   - Run deployment script
   - Update TESTNET_ADDRESSES.md

2. **Fund agent wallets**
   - Get testnet ETH from faucet
   - Mint test USDC

3. **Run preflight check**
   - Verify all setup correct

4. **Start 48-hour simulation**
   - Launch coordinator
   - Monitor dashboard

5. **Analyze results**
   - Review final report
   - Check all metrics
   - Fix any bugs found

6. **Re-test if needed**
   - Run again until clean

7. **Deploy to mainnet**
   - Monad + Base mainnet
   - Announce V2 launch 🚀

## 🎉 Status

**✅ FRAMEWORK COMPLETE**

All 6 agents created with:
- Full autonomous operation
- Error handling & recovery
- Metrics collection
- Real-time monitoring
- Comprehensive testing

**Ready for Base Sepolia testnet deployment and 48-hour simulation!**

---

**Created**: 2026-02-06  
**Version**: 1.0  
**Status**: Ready for Testing
