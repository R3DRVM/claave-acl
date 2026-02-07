# Klaave V2 Autonomous Agent Testing

This directory contains 6 autonomous agent scripts designed to test Klaave V2 protocol for 48 hours on Base Sepolia testnet.

## 🤖 Agents

### 1. **lender.ts** - Conservative Lender
- **Strategy:** Yield optimization
- **Behavior:**
  - Deposits 50,000 USDC into pool
  - Monitors borrow rates continuously
  - Withdraws when rate < 3% APR
  - Re-deposits when rate > 5% APR
  - Tracks yield earned
- **Tests:** Pool deposits, withdrawals, share calculations, rate monitoring

### 2. **borrower.ts** - Aggressive Borrower
- **Strategy:** Maximum leverage
- **Behavior:**
  - Posts 10,000 USDC bond
  - Borrows 90% of credit limit
  - Performs multiple borrow/repay cycles
  - Tests borrowing limits
  - Tracks effective borrowing cost
- **Tests:** Bond posting, borrowing, repayment, dynamic rates, credit limits

### 3. **risky-borrower.ts** - Risk-Taking Borrower
- **Strategy:** Push system to liquidation
- **Behavior:**
  - Posts minimum bond (low collateral)
  - Borrows near maximum (80% of limit)
  - Simulates losses by burning USDC
  - Becomes unhealthy (Health Factor < 1.0)
  - Gets liquidated
- **Tests:** Liquidation triggers, health factor calculation, underwater positions

### 4. **liquidator.ts** - Keeper Bot
- **Strategy:** Liquidation monitoring
- **Behavior:**
  - Monitors all 5 credit lines every 5 blocks
  - Checks `healthFactor()` on each line
  - Calls `slashBond()` when HF < 1.0
  - Tracks 5% liquidation bonuses earned
  - Tests liquidator profitability
- **Tests:** Liquidation execution, timing, bonuses, keeper economics

### 5. **arbitrage.ts** - Arbitrage Agent
- **Strategy:** Cross-line rate arbitrage
- **Behavior:**
  - Opens 3 credit lines simultaneously
  - Borrows from lowest rate line
  - Deposits borrowed USDC for yield
  - Tests cross-line interactions
  - Measures arbitrage opportunities
- **Tests:** Multi-line operations, rate differences, gas costs vs profit

### 6. **stress-tester.ts** - Stress Tester
- **Strategy:** System stress testing
- **Behavior:**
  - Posts bonds to ALL credit lines
  - Max borrows from all lines simultaneously
  - Drains pool to 100% utilization
  - Causes rate spike to 66%+ APR
  - Tests emergency scenarios
  - Partial repayments to cycle utilization
- **Tests:** High utilization, rate spikes, system limits, recovery

## 🎛️ Coordinator

**coordinator.ts** - Agent Manager & Dashboard
- Spawns all 6 agents as child processes
- Monitors agent health (checks every 30s)
- Auto-restarts crashed agents (up to 10 restarts)
- Collects metrics from all agents
- Displays real-time dashboard (updates every 60s)
- Tracks pool stats (TVL, utilization, rates)
- Aggregates transaction counts, gas costs
- Graceful shutdown handling

## 📦 Installation

### Prerequisites
- Node.js 18+ and npm/yarn
- Funded testnet wallets (6 different private keys)
- Base Sepolia RPC URL
- Deployed Klaave V2 contracts on testnet

### Install Dependencies
```bash
cd scripts/agents
npm install ethers@^6.0.0
npm install tsx -D
```

## ⚙️ Configuration

### 1. Copy Environment Template
```bash
cp .env.example .env
```

### 2. Configure Environment Variables
Edit `.env` with your testnet deployment details:

```bash
# RPC
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# Contract Addresses (from testnet deployment)
POOL_ADDRESS=0x...
USDC_ADDRESS=0x...
KCL_STAKING_ADDRESS=0x...
RESERVE_ADDRESS=0x...

# Credit Line Addresses (comma-separated)
CREDIT_LINE_ADDRESSES=0x...,0x...,0x...,0x...,0x...

# Agent Private Keys (separate wallet for each agent)
LENDER_PRIVATE_KEY=0x...
BORROWER_PRIVATE_KEY=0x...
RISKY_BORROWER_PRIVATE_KEY=0x...
LIQUIDATOR_PRIVATE_KEY=0x...
ARBITRAGE_PRIVATE_KEY=0x...
STRESS_TESTER_PRIVATE_KEY=0x...
```

### 3. Fund Agent Wallets

Each agent needs testnet USDC:
- **Lender:** 50,000 USDC (deposit amount)
- **Borrower:** 15,000 USDC (bond + gas)
- **Risky Borrower:** 5,000 USDC (min bond + gas)
- **Liquidator:** 1,000 USDC (gas only)
- **Arbitrage:** 20,000 USDC (3x bonds + gas)
- **Stress Tester:** 30,000 USDC (bonds for all lines)

Get testnet USDC from deployed mock contract:
```bash
# Mint testnet USDC to agent addresses
forge script script/MintTestUSDC.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
```

## 🚀 Running Agents

### Option 1: Run Coordinator (Recommended)
Starts all agents at once with monitoring:
```bash
npm run coordinator
# or
npx tsx coordinator.ts
```

### Option 2: Run Individual Agents
For testing or debugging:
```bash
npx tsx lender.ts
npx tsx borrower.ts
npx tsx risky-borrower.ts
npx tsx liquidator.ts
npx tsx arbitrage.ts
npx tsx stress-tester.ts
```

### Option 3: Run in Background (48-hour test)
```bash
# Using screen (recommended for long-running)
screen -S klaave-agents
npm run coordinator
# Detach: Ctrl+A, D

# Check status
screen -r klaave-agents

# Or using nohup
nohup npm run coordinator > coordinator.log 2>&1 &
```

## 📊 Monitoring

### Live Dashboard
The coordinator displays a live dashboard with:
- Pool stats (TVL, utilization, borrow rate)
- Agent statuses (running/crashed/stopped)
- Transaction counts and success rates
- Gas usage per agent
- Aggregate metrics

### Log Files
Individual agent logs saved to `logs/`:
```bash
tail -f logs/lender-*.log
tail -f logs/liquidator-*.log
```

### Metrics Files
JSON metrics saved to `metrics/`:
```bash
cat metrics/lender-metrics.json | jq
cat metrics/borrower-metrics.json | jq
```

### Dashboard Snapshots
Latest dashboard snapshot saved to `dashboard/latest.json`:
```bash
cat dashboard/latest.json | jq
```

## 🛠️ Troubleshooting

### Agent Crashes
- **Check logs:** `tail -f logs/<agent-name>-*.log`
- **Check balance:** Ensure agent wallet has sufficient testnet USDC
- **RPC issues:** Verify `BASE_SEPOLIA_RPC_URL` is responsive
- **Contract addresses:** Verify all addresses in `.env` are correct

### Coordinator Not Starting
- **Missing env vars:** Run `npm run test-env` to validate config
- **Permission errors:** Ensure logs/metrics/dashboard directories are writable
- **Port conflicts:** Check no other coordinator instances running

### Liquidations Not Triggering
- **Risky borrower not unhealthy yet:** Takes time for HF to drop below 1.0
- **Liquidator wallet empty:** Needs gas for transactions
- **Timing:** Liquidator checks every 5 blocks (~60 seconds)

### Pool Utilization Not Reaching 100%
- **Insufficient capital:** Stress tester needs enough bonds to borrow all liquidity
- **Credit limits:** May hit per-line credit limits before draining pool
- **Expected:** Some liquidity may remain if credit limits cap borrowing

## 📈 Expected Results (48-Hour Test)

### Success Criteria
- ✅ All 6 agents run for 48 hours without fatal crashes
- ✅ Pool remains solvent (TVL ≥ total debt) at all times
- ✅ Liquidations execute within 5 minutes of HF < 1.0
- ✅ Dynamic rates respond correctly to utilization changes
- ✅ No unexpected reverts (except expected ones like over-borrowing)
- ✅ No stuck funds in any contract

### Expected Metrics
- **Transactions:** 5,000+ total across all agents
- **Success Rate:** >98% (excluding intentional failures)
- **Liquidations:** 10-20 successful liquidations
- **Utilization:** Peaks at 95-100% during stress tests
- **Rates:** Range from 2% (low util) to 66% (100% util)
- **Gas Costs:** ~$50-100 in testnet ETH equivalent

### Known Failure Cases (Expected)
- Borrower hitting credit limit → Expected revert
- Risky borrower becoming liquidatable → Intentional
- Arbitrage agent finding no profitable opportunities → Possible
- Stress tester draining pool completely → Intentional

## 🔍 Validation Checklist

Before 48-hour run, verify:
- [ ] All 6 agent wallets funded with sufficient testnet USDC
- [ ] All 6 agent wallets have testnet ETH for gas
- [ ] Contract addresses in `.env` are correct
- [ ] RPC endpoint is stable and responsive
- [ ] Coordinator starts without errors
- [ ] All agents show "running" status in dashboard
- [ ] First transactions from each agent succeed
- [ ] Logs are being written to `logs/` directory
- [ ] Metrics are being collected in `metrics/` directory

## 🚨 Emergency Shutdown

Graceful shutdown (allows agents to repay debts):
```bash
# If running in terminal
Ctrl+C

# If running in screen
screen -r klaave-agents
Ctrl+C

# If running in background
pkill -SIGTERM -f coordinator.ts
```

Force shutdown (immediate stop):
```bash
pkill -SIGKILL -f coordinator.ts
pkill -SIGKILL -f "lender.ts|borrower.ts|risky-borrower.ts|liquidator.ts|arbitrage.ts|stress-tester.ts"
```

## 📝 Notes

- **Testnet Only:** These agents are designed for testnet. DO NOT use on mainnet.
- **Private Keys:** Keep agent private keys secure. They control testnet funds.
- **RPC Rate Limits:** Free RPCs may rate-limit. Consider paid RPC for 48-hour tests.
- **Gas Prices:** Agents use default gas settings. May need adjustment if testnet congested.
- **Randomness:** Agents have some randomness to simulate realistic behavior.

## 🎯 Next Steps After 48 Hours

1. **Analyze Results:** Review all logs and metrics
2. **Check Pool Solvency:** Verify pool accounting balanced
3. **Review Liquidations:** Confirm all liquidations executed correctly
4. **Calculate Costs:** Sum gas costs and borrowing fees
5. **Identify Issues:** Document any bugs or unexpected behavior
6. **Generate Report:** Summarize findings for mainnet go/no-go decision

## 📚 Additional Resources

- **Klaave V2 Docs:** [Link to documentation]
- **Contract Source:** `../../src/`
- **Deployment Scripts:** `../../script/`
- **Test Suite:** `../../test/`

## 🤝 Support

Issues or questions? Check:
1. Logs in `logs/` directory
2. Metrics in `metrics/` directory
3. Contract events on BaseScan testnet explorer
4. Discord support channel [if available]
