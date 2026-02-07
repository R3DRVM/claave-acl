# Klaave V2 – Base Sepolia Testnet Addresses

**Deployed:** 2026-02-06  
**Network:** Base Sepolia (chainId 84532)  
**Deployer:** 0xfd1813536D26b4C68de4a0501eDf7F5F61993Cbd  

## Core Contracts
- **Mock USDC:** 0xACB11ab0a9Da405f128aeF74eF2b6A6637D5a165
- **KCL Staking:** 0xaf159Db69661aed23e2cedA1fcCa6B05E02627c1
- **ACL Pool (ERC4626):** 0xBF2D0B30a36cEbC2639D1F215B60c0Bc09a72Aba
- **Protocol Reserve:** 0xd8D2017E2086EDdF459d16c7DD6812ccAA9349DC
- **AgentCreditLineKCLFee (primary, registered in pool):** 0xbFeEBDe8dbB083bbe18AfB43580Bc9dD89e5a534
- **AgentCreditLineKCLFee (extra, NOT registered):** 0xd78d81D46994848f6DA78a8969b7f0cdd37e59e0
- **AgentCreditLineKCLFee (extra, NOT registered):** 0xdf39b85EA6a0c089b44997cE4c07f8A237cAfD26

## Agent Wallets (Real, locally generated)
- Agent 1: 0x83eeEEC831250c5EA0bb5159F8614cD2ae701598
- Agent 2 (borrower bound): 0x9236da3EB6Fc9684b94D3cAA988e3c422054e395
- Agent 3: 0xB637DAC4742d0Af99e356f35615A93785E3b3e8F
- Agent 4: 0x1aD6f270b00E3aA62b4A03321483790bee034a96
- Agent 5: 0xFf31a876563104A40e4d0B373001344685369f55
- Agent 6: 0x3b9af4d1F306ab7FAAD428BeA449E8D20457b2A0

## Explorer Links
- Base Sepolia Explorer: https://sepolia.basescan.org/

## Notes
- Pool initialized with **100,000 USDC** liquidity.
- Test USDC minted: **200,000 USDC** across the 6 agent wallets.
- Minimum liquidity lock: **1,000 shares** (anti-inflation).

## Local Wallet Material
Wallet JSON (contains private keys) stored locally at:
- `scripts/agents/agent-wallets.json`

⚠️ Do not commit that file.
