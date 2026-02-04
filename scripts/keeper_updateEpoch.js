#!/usr/bin/env node

// Keeper script: batch updateEpoch() across multiple ACLs.
//
// Usage:
//   RPC_URL=https://rpc.monad.xyz PRIVATE_KEY=... node scripts/keeper_updateEpoch.js \
//     0xACL1 0xACL2
//
// Optional:
//   DRY_RUN=1  -> only simulates (no tx)

const { ethers } = require('ethers');

const RPC_URL = process.env.RPC_URL || 'https://rpc.monad.xyz';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const DRY_RUN = process.env.DRY_RUN === '1';

if (!PRIVATE_KEY) {
  console.error('Missing PRIVATE_KEY');
  process.exit(1);
}

const ACL_ABI = [
  'function updateEpoch() external',
  'function currentEpoch() view returns (uint64)',
  'function state() view returns (address borrower,address strategy,uint256 bond,uint256 debt,int256 score,uint256 failures,bool borrowDisabled,uint64 epoch,uint64 lastUpdatedBlock,uint256 lastEquity)',
];

function short(a) {
  return a.slice(0, 6) + '…' + a.slice(-4);
}

async function main() {
  const acls = process.argv.slice(2);
  if (acls.length === 0) {
    console.error('Provide at least one ACL address');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const net = await provider.getNetwork();
  console.log('keeper', wallet.address, 'chainId', net.chainId.toString(), 'dryRun', DRY_RUN);

  for (const addr of acls) {
    const acl = new ethers.Contract(addr, ACL_ABI, wallet);

    try {
      const [borrower, strategy, bond, debt, score, failures, disabled, epoch] = await acl.state();
      const cur = await acl.currentEpoch();

      console.log('\nACL', addr, 'borrower', short(borrower), 'strategy', strategy === ethers.ZeroAddress ? '—' : short(strategy));
      console.log('  epoch', epoch.toString(), '->', cur.toString(), 'disabled', disabled);
      console.log('  bond', bond.toString(), 'debt', debt.toString(), 'score', score.toString(), 'failures', failures.toString());

      if (DRY_RUN) {
        // simulate eligibility
        await acl.updateEpoch.staticCall();
        console.log('  ready: yes (staticCall ok)');
        continue;
      }

      // attempt tx; will revert if not ready
      const tx = await acl.updateEpoch();
      console.log('  tx', tx.hash);
      const rec = await tx.wait();
      console.log('  status', rec.status);
    } catch (e) {
      const msg = (e && (e.shortMessage || e.reason || e.message)) ? (e.shortMessage || e.reason || e.message) : String(e);
      if (msg.toLowerCase().includes('notready')) {
        console.log('  ready: no (NotReady)');
      } else {
        console.log('  error:', msg);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
