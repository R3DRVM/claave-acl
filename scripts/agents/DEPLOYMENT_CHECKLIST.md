# V2 Agent Testing Deployment Checklist

Complete this checklist before running the 48-hour simulation.

## Pre-Deployment

### 1. Contract Deployment
- [ ] Deploy Mock USDC to Base Sepolia
- [ ] Deploy KCL Staking contract
- [ ] Deploy Protocol Reserve
- [ ] Deploy ACL Pool (ERC4626)
- [ ] Deploy 5x AgentCreditLineKCLFee instances
- [ ] Verify all contracts on Basescan
- [ ] Update `TESTNET_ADDRESSES.md` with deployed addresses

### 2. Initial Pool Setup
- [ ] Mint 100,000 USDC to pool for initial liquidity
- [ ] Verify pool has liquidity: `cast call $POOL_ADDRESS "totalAssets()(uint256)" --rpc-url base-sepolia`
- [ ] Set credit line addresses in pool (if needed)

### 3. Agent Wallet Setup
- [ ] Generate 6 new wallets (one per agent):
  ```bash
  cast wallet new  # Run 6 times, save addresses & keys
  ```
- [ ] Fund each wallet with testnet ETH (for gas):
  - Get from Base Sepolia faucet: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
  - Each wallet needs ~0.05 ETH

### 4. Agent Wallet Funding (USDC)
- [ ] Mint USDC to Lender wallet: 60,000 USDC
  ```bash
  cast send $USDC_ADDRESS "mint(address,uint256)" $LENDER_ADDRESS 60000000000 --rpc-url base-sepolia --private-key $DEPLOYER_KEY
  ```
- [ ] Mint USDC to Borrower wallet: 15,000 USDC
  ```bash
  cast send $USDC_ADDRESS "mint(address,uint256)" $BORROWER_ADDRESS 15000000000 --rpc-url base-sepolia --private-key $DEPLOYER_KEY
  ```
- [ ] Mint USDC to Risky Borrower wallet: 5,000 USDC
  ```bash
  cast send $USDC_ADDRESS "mint(address,uint256)" $RISKY_BORROWER_ADDRESS 5000000000 --rpc-url base-sepolia --private-key $DEPLOYER_KEY
  ```
- [ ] Mint USDC to Liquidator wallet: 10,000 USDC
  ```bash
  cast send $USDC_ADDRESS "mint(address,uint256)" $LIQUIDATOR_ADDRESS 10000000000 --rpc-url base-sepolia --private-key $DEPLOYER_KEY
  ```
- [ ] Mint USDC to Arbitrage wallet: 20,000 USDC
  ```bash
  cast send $USDC_ADDRESS "mint(address,uint256)" $ARBITRAGE_ADDRESS 20000000000 --rpc-url base-sepolia --private-key $DEPLOYER_KEY
  ```
- [ ] Mint USDC to Stress Tester wallet: 150,000 USDC
  ```bash
  cast send $USDC_ADDRESS "mint(address,uint256)" $STRESS_TESTER_ADDRESS 150000000000 --rpc-url base-sepolia --private-key $DEPLOYER_KEY
  ```

## Configuration

### 5. Environment Setup
- [ ] Copy `.env.example` to `.env`:
  ```bash
  cd scripts/agents
  cp .env.example .env
  ```
- [ ] Fill in all contract addresses in `.env`
- [ ] Fill in all agent private keys in `.env`
- [ ] Verify RPC URL is correct (use private RPC if possible)

### 6. Dependencies
- [ ] Install Node.js v18+ if not already installed
- [ ] Install dependencies:
  ```bash
  cd scripts/agents
  npm install
  ```

### 7. Pre-flight Check
- [ ] Run preflight check:
  ```bash
  npx tsx preflight-check.ts
  ```
- [ ] Fix any failed checks
- [ ] Re-run until all checks pass ✅

## Testing Basic Operations

### 8. Manual Contract Testing
- [ ] Test pool deposit:
  ```bash
  cast send $POOL_ADDRESS "deposit(uint256,address)" 1000000000 $YOUR_ADDRESS --rpc-url base-sepolia --private-key $YOUR_KEY
  ```
- [ ] Test pool withdraw:
  ```bash
  cast send $POOL_ADDRESS "redeem(uint256,address,address)" <shares> $YOUR_ADDRESS $YOUR_ADDRESS --rpc-url base-sepolia --private-key $YOUR_KEY
  ```
- [ ] Test credit line bond posting:
  ```bash
  # Approve USDC first
  cast send $USDC_ADDRESS "approve(address,uint256)" $CREDIT_LINE_ADDRESS 1000000000 --rpc-url base-sepolia --private-key $YOUR_KEY
  
  # Post bond
  cast send $CREDIT_LINE_ADDRESS "postBond(uint256)" 1000000000 --rpc-url base-sepolia --private-key $YOUR_KEY
  ```
- [ ] Test borrow:
  ```bash
  cast send $CREDIT_LINE_ADDRESS "borrow(uint256)" 500000000 --rpc-url base-sepolia --private-key $YOUR_KEY
  ```
- [ ] Test repay:
  ```bash
  # Approve USDC first
  cast send $USDC_ADDRESS "approve(address,uint256)" $CREDIT_LINE_ADDRESS 500000000 --rpc-url base-sepolia --private-key $YOUR_KEY
  
  # Repay
  cast send $CREDIT_LINE_ADDRESS "repay(uint256)" 500000000 --rpc-url base-sepolia --private-key $YOUR_KEY
  ```

## Launch

### 9. Dry Run (Short Duration)
- [ ] Run coordinator for 5 minutes to verify everything works:
  ```bash
  timeout 300 npx tsx coordinator.ts
  ```
- [ ] Check that all agents started successfully
- [ ] Verify logs are being written to `../../logs/`
- [ ] Verify metrics are being written to `../../metrics/`
- [ ] Verify dashboard updates in `../../dashboard/dashboard.txt`

### 10. Full 48-Hour Simulation
- [ ] Start coordinator in screen/tmux session (so it survives disconnects):
  ```bash
  # Start screen session
  screen -S klaave-agents
  
  # Inside screen, run coordinator
  cd scripts/agents
  npx tsx coordinator.ts
  
  # Detach with Ctrl+A, D
  ```
- [ ] Monitor dashboard periodically:
  ```bash
  watch -n 10 cat dashboard/dashboard.txt
  ```
- [ ] Check logs if any agent crashes
- [ ] Note start time: _______________

## Monitoring

### 11. During Simulation
- [ ] Check dashboard every 4-6 hours
- [ ] Verify pool remains solvent
- [ ] Verify liquidations are happening (risky borrower should get liquidated)
- [ ] Check for any stuck agents (status not "running")
- [ ] Monitor gas costs (should be reasonable)
- [ ] Take screenshots of dashboard at key milestones

### 12. Key Events to Watch For
- [ ] Risky borrower gets liquidated (should happen within ~1 hour)
- [ ] Lender withdraws when rate drops below 3%
- [ ] Lender re-deposits when rate goes above 5%
- [ ] Pool reaches 100% utilization (stress tester)
- [ ] Rate spikes to ~66% at 100% utilization
- [ ] Arbitrage opportunities detected and exploited
- [ ] All stress tests pass

## Post-Simulation

### 13. Results Analysis
- [ ] Stop coordinator gracefully (Ctrl+C or `kill -TERM <pid>`)
- [ ] Wait for agents to shut down cleanly
- [ ] Collect final report from `../../reports/final-report-*.txt`
- [ ] Review all agent logs in `../../logs/`
- [ ] Review all metrics in `../../metrics/`
- [ ] Calculate aggregate statistics:
  - Total transactions
  - Success rate
  - Total gas used
  - Liquidation count
  - Pool final state

### 14. Success Validation
- [ ] All agents ran for 48+ hours without critical errors
- [ ] Transaction success rate > 95%
- [ ] Pool remained solvent (TVL ≥ total debt)
- [ ] Liquidations executed successfully
- [ ] Rates followed expected curve
- [ ] No funds stuck or lost
- [ ] Gas costs acceptable

### 15. Bug Fixes (if needed)
- [ ] Document all bugs found
- [ ] Fix bugs in contracts
- [ ] Re-deploy to testnet
- [ ] Re-run simulation
- [ ] Repeat until clean

### 16. Mainnet Preparation
- [ ] All tests passed ✅
- [ ] Smart contract audit completed (if needed)
- [ ] Deploy to Monad mainnet
- [ ] Deploy to Base mainnet
- [ ] Announce V2 launch 🚀

## Emergency Contacts

If something goes wrong:
- Logs directory: `../../logs/`
- Metrics directory: `../../metrics/`
- Dashboard: `../../dashboard/dashboard.txt`
- Stop coordinator: `kill -TERM <pid>` or Ctrl+C

## Notes

Date Started: _______________  
Date Completed: _______________  
Total Runtime: _______________  
Issues Encountered: _______________  
Resolution: _______________

---

**Use this checklist to ensure nothing is missed during deployment and simulation!**
