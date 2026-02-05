# Klaave (Claave) — Agent Credit Lines on Monad

Klaave is an **agent-native credit primitive**: lenders provide stablecoin liquidity, and autonomous agents borrow against a **bond + on-chain performance** feedback loop.

This repo contains a working Monad mainnet deployment and an “agents-first” toolkit (Foundry + CLI scripts) so other agents can:
- fund a wallet with real USDC (via Uniswap v4)
- seed pool liquidity
- post bond
- link a strategy address
- borrow and repay
- run epoch updates (keeper)

The UI is meant to be judge-friendly polish; the protocol is meant to be operated by agents.

---

## Vision

Autonomous agents need working capital to execute strategies. Today that usually means:
- custodial credit (not credible for agents)
- governance-heavy lending (slow, human-first)
- collateralized loans (capital inefficient)

Klaave aims for a different center:
- **Bonded accountability**: agents post a bond in the same asset they borrow.
- **On-chain performance**: credit expands/contracts based on the **strategy address’s asset balance delta per epoch**.
- **Auto-freeze safety**: sustained underperformance freezes borrowing.
- **Protocol reserve**: borrow fees accrue to a reserve contract (treasury primitive).
- **No oracle required for the core loop**: the main signal is a balance delta in the borrowed asset.

---

## High-level Flow

1) **Lenders deposit USDC** into `ACLPool` (receive shares).
2) **Borrower agent** links a `strategy` address (where borrowed funds go).
3) Borrower posts a **USDC bond**.
4) Borrower draws from credit line via `borrow(grossAmount)`.
   - A **borrow fee** is skimmed to `ProtocolReserve`.
   - Net amount is transferred to the strategy address.
5) Anyone (keeper agent) calls `updateEpoch()` periodically.
   - Measures performance as: `USDC.balanceOf(strategy) - lastEquity`.
   - Updates score, recomputes limit, and may freeze borrowing.

---

## Contracts

### Core
- `src/ACLPool.sol`
  - Minimal lender pool (share token) holding the borrowed asset.
  - `availableLiquidity()` returns USDC balance.
  - Note: patched to avoid a division-by-zero edge case if shares exist while assets are drained (agents must be able to re-seed liquidity after drawdowns).

### Credit lines
- `src/AgentCreditLine.sol`
  - Base credit line (bond + score + epoch updates + freeze).

- `src/AgentCreditLineKCLFee.sol`
  - Adds:
    - **KCL staking boost** to credit limit (utility staking, no emissions).
    - **Borrow fee routing** to a reserve address.

### Staking
- `src/KCLStaking.sol`
  - Stake KCL to boost credit multiplier.

### Treasury
- `src/ProtocolReserve.sol`
  - Minimal reserve contract (owner + `sweep(token,to,amount)`).
  - Fee routing is visible on-chain as direct USDC transfers into this contract.

---

## Mainnet Deployments (Monad, chainId 143)

### Current v1 stack (real USDC)
Deployed via `script/DeployRealUSDC_FeeReserve.s.sol`.

**v1 features (agent-built, agent-operated):**
- Borrow fee split: **lenders (pool)** + **protocol reserve**
- Strict default resolution: **permissionless bond slashing** when frozen or delinquent

- USDC (Monad): `0x754704bc059f8c67012fed69bc8a327a5aafb603`
- ACLPool: `0x824919C5487601acae94f00f003dAff29d66D1f6`
- KCLStaking: `0x078A76b8B85D423430d0f986b07e5ff2d69118b3`
- ProtocolReserve: `0xC6792eCe2248e48afEaEef0f8D5225d4B6Ea07d9`
- AgentCreditLineKCLFee: `0x70020AF7BEFa3d439532d92b0128032Da114dFd8`

Example borrow proving fee routing to reserve:
- Borrow tx (fee accrued + transferred to reserve): `0x5a43a12c38ec8048172215278ae5007dc8389f85737afb5eb90ba284d42bf1fd`

---

## Agent-first CLI Toolkit

### 1) Swap MON -> USDC (Uniswap v4)
Script: `scripts/swapUniV4_MON_USDC.js`

This uses Universal Router + a known v4 PoolKey for the MON/USDC pool.

```bash
cd claave-acl
RPC_URL=https://rpc.monad.xyz \
PRIVATE_KEY=... \
node scripts/swapUniV4_MON_USDC.js 2
```

### 2) Link strategy
By default we link the borrower EOA as strategy (agents can point it at a bot-controlled hot wallet later).

```bash
RPC_URL=https://rpc.monad.xyz \
PRIVATE_KEY=... \
ACL=0x70020AF7BEFa3d439532d92b0128032Da114dFd8 \
node scripts/linkStrategy.js
```

### 3) Seed pool liquidity, post bond, borrow
Example values are in raw token units (USDC on Monad uses 6 decimals).

```bash
RPC_URL=https://rpc.monad.xyz
PRIVATE_KEY=...
USDC=0x754704bc059f8c67012fed69bc8a327a5aafb603
POOL=0x824919C5487601acae94f00f003dAff29d66D1f6
ACL=0x70020AF7BEFa3d439532d92b0128032Da114dFd8

# deposit 50 USDC (50_000_000 in 6 decimals) etc. Adjust as needed.
cast send $USDC "approve(address,uint256)" $POOL 60000 --private-key $PRIVATE_KEY --rpc-url $RPC_URL
cast send $POOL "deposit(uint256,address)" 50000 <yourAddress> --private-key $PRIVATE_KEY --rpc-url $RPC_URL

# bond + borrow
cast send $USDC "approve(address,uint256)" $ACL 30000 --private-key $PRIVATE_KEY --rpc-url $RPC_URL
cast send $ACL "postBond(uint256)" 20000 --private-key $PRIVATE_KEY --rpc-url $RPC_URL
cast send $ACL "borrow(uint256)" 20000 --private-key $PRIVATE_KEY --rpc-url $RPC_URL
```

---

## Local development

```bash
cd claave-acl
forge test
```

Foundry config note:
- `foundry.toml` uses `via_ir = true` to avoid occasional “stack too deep” compilation issues.

---

## Deploy scripts

### Deploy a local demo (MockUSDC)
- `script/Deploy.s.sol`

### Deploy fee+reserve stack to real Monad USDC
- `script/DeployRealUSDC_FeeReserve.s.sol`

Example:
```bash
export RPC_URL=https://rpc.monad.xyz
export PRIVATE_KEY=...
export BORROWER=0x...
export USDC=0x754704bc059f8c67012fed69bc8a327a5aafb603
export KCL=0x0acbf18A86f4293C0B6af7087f4952D440097777

forge script script/DeployRealUSDC_FeeReserve.s.sol:DeployRealUSDC_FeeReserve \
  --rpc-url $RPC_URL \
  --broadcast
```

---

## Design choice: one pool per ACL

For this MVP we intentionally deploy **one `ACLPool` per credit line**.

Why this is the best default for judges and for agent operators:
- **Risk containment:** a compromised ACL cannot drain unrelated pools.
- **Clean accounting:** no cross-ACL liquidity coordination questions.
- **Simple operations:** an agent can deploy a self-contained “pool + staking + reserve + ACL” bundle.

Scaling path (future): a multi-ACL pool can be supported via an allowlist/registry that authorizes multiple credit line contracts. We’re not shipping that complexity in the MVP.

## Owner rotation / ops

Both `ACLPool` and `ProtocolReserve` support owner rotation.

Recommended production pattern:
- set `owner` to a multisig or an agent-controller contract
- optional time-delay on sensitive actions (e.g. `sweep`) if you want additional safety

## What’s next (UI is the last mile)

The protocol and agent workflows are live. Remaining items are product / judge experience:
- Polished frontend that makes the loop obvious:
  - deposit, bond, link, borrow, repay
  - reserve fee accrual
  - epoch updates + credit limit changes
- Keeper experience:
  - a simple “run updateEpoch for these ACLs” agent script
- Hardening:
  - parameter governance / safe defaults

---

## Disclaimer
This is hackathon-grade code running with real assets on Monad. It is not audited.
