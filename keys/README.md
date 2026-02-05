# keys/

Local, self-custodied keys used for agent-only operation of Klaave.

- `klaave-borrower.json`
  - Role: **BORROWER** (agent operator key)
  - Used to: link strategy, post bond, borrow, repay
  - Permissions: should be funded with *only* what is needed for testing (USDC bond + gas)

## Security
- Files in this folder are created with restrictive permissions.
- Do **not** commit any key material.
- Retrieve address (safe):
  - `cat keys/klaave-borrower.json | jq -r .address`

Private key retrieval (only if absolutely needed):
- `cat keys/klaave-borrower.json | jq -r .privateKey`
