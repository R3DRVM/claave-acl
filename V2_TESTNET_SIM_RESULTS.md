# Klaave V2 — Base Sepolia Testnet Simulation Results

**Last updated:** 2026-02-06/07 (PT)
**Network:** Base Sepolia (chainId 84532)

## Deployed contracts (Base Sepolia)
- MockUSDC: `0xACB11ab0a9Da405f128aeF74eF2b6A6637D5a165`
- KCLStaking: `0xaf159Db69661aed23e2cedA1fcCa6B05E02627c1`
- ACLPool (ERC4626): `0xBF2D0B30a36cEbC2639D1F215B60c0Bc09a72Aba`
- ProtocolReserve: `0xd8D2017E2086EDdF459d16c7DD6812ccAA9349DC`
- AgentCreditLineKCLFee (primary, registered in pool): `0xbFeEBDe8dbB083bbe18AfB43580Bc9dD89e5a534`
- AgentCreditLineKCLFee (extra, NOT registered): `0xd78d81D46994848f6DA78a8969b7f0cdd37e59e0`
- AgentCreditLineKCLFee (extra, NOT registered): `0xdf39b85EA6a0c089b44997cE4c07f8A237cAfD26`

## Architecture note (important)
`ACLPool` supports **exactly one registered credit line**, and only that registered credit line can move pool funds (`transferTo` is `onlyCreditLine`). Extra credit lines are useful for testing/agent scripts, but they cannot borrow unless the pool’s registered credit line is swapped.

## Agent simulation (clean pass)
To avoid false failures from borrower-binding constraints, the coordinator ran:
- lender
- borrower (bound to the registered line)
- liquidator (monitoring)

### Confirmed successful onchain actions
Borrower (wallet `0x9236…`) executed:
- `postBond(10,000e6)` ✅
  - tx: `0xd2a09c89e053e5c415a2fcc032d073c72850ea064e955c7fe0f203af2d207281`
- `linkStrategy(strategy=borrowerWallet)` ✅
- `borrow(72,000e6 gross)` ✅
  - tx: `0x8a7885fe0692bbc99d3c2befabca52396da25ee2c8ba533b30607a3f7698fd77`
- `repay(36,000e6)` ✅
  - tx: `0xff505019ce38c31a9caee6a81e8848dd399494f10ae304c04ae16aef09825472`

### State sanity check
- Onchain `debt()` after repay: **36,000 USDC**

### Pool metrics moved as expected
- Utilization increased (example snapshot: ~36%)
- Estimated borrow rate increased (example snapshot: ~3.8%)
- Pool total assets increased slightly due to fees.

## Known follow-ups
- Agent script: over-borrow test should skip when `availableToBorrow == 0` (patched).
- If we want true multi-agent borrower behavior, we should implement either:
  - one pool per borrower, OR
  - credit line swapping orchestration in the coordinator.
