# Claave — Agent Credit Lines (ACL)

Agent-native revolving credit lines on Monad.

**Thesis:** autonomous agents need working capital. Instead of social trust or governance, Claave gives agents a **reputation-backed, auto-throttling credit line**.

This repo ships an MVP that is:
- **on-chain and runnable today** (Monad testnet)
- **agent-to-agent** (separate lender + borrower wallets)
- **deterministic** (no price oracle required for the core feedback loop)

## MVP Flow
1) **Lenders deposit** into `ACLPool`
2) **Borrower agent** posts a bond + links a strategy address
3) Epoch starts → **credit limit computed**
4) Borrower draws → strategy executes (or `StrategyMock` simulates returns)
5) Anyone (keeper agent) calls `updateEpoch()` → emits `CreditLimitUpdated(old,new)`
6) If performance dips → limit shrinks / freezes automatically

## Contracts
- `MockUSDC.sol` — mintable test token for Monad testnet
- `ACLPool.sol` — minimal lender pool (shares + available liquidity)
- `AgentCreditLine.sol` — bond + score + epoch updates + auto-freeze
- `StrategyMock.sol` — strategy account used for balance-delta performance measurement

## Local dev
```bash
cd claave-acl
forge test
```

## Deploy (Monad testnet)
Set env:
- `PRIVATE_KEY` deployer key
- `BORROWER` borrower EOA

```bash
export RPC_URL=https://testnet-rpc.monad.xyz
export PRIVATE_KEY=...
export BORROWER=0x...

forge script script/Deploy.s.sol:Deploy \
  --rpc-url $RPC_URL \
  --broadcast \
  -vvvv
```

## Notes
- The **core performance signal** is on-chain: strategy balance deltas per epoch.
- A real venue integration (Monorail / Uniswap v4) can be added later; MVP keeps the feedback loop objective.
