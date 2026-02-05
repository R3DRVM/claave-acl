# Klaave Progress

## MVP (shipping now)
- [x] Monad mainnet deployment (real USDC)
- [x] Pool hardening: `transferTo` restricted to `creditLine`
- [x] Borrow fee routing to reserve contract
- [x] Keeper script (batch `updateEpoch`)
- [x] UI demo rail + tx proof links
- [x] Human-friendly UI modes (Lend / Borrow / Keeper)

## v1 Completeness (to win)
### Protocol economics
- [ ] Borrow fee split: lenders + reserve (lender yield)
- [ ] Display lender yield / fee flow clearly in UI

### Default resolution
- [ ] Bond slashing / debt offset path (simple, on-chain)
- [ ] Clear rules for when slashing is allowed

### Ops
- [ ] Deployments registry (`deployments/monad-mainnet.json`) as source of truth
- [ ] Keeper targets registry + one-command runner

### UX polish
- [ ] Klaave token image used as logo
- [ ] Newb-proof copy + guardrails on inputs (max buttons, disable until ready)

## Multi-chain expansion
- [ ] Solana program spec (accounts + instructions)
- [ ] Solana devnet prototype

## Notes
- Goal: v1 should be defensible as a complete protocol in a 2 minute demo.
