#!/usr/bin/env node
/*
  Keeper runner: batch updateEpoch() across a list of ACLs.

  Usage:
    RPC_URL=https://rpc.monad.xyz PRIVATE_KEY=... node scripts/keeper_run.js
    RPC_URL=... PRIVATE_KEY=... TARGETS=keeper/targets.json node scripts/keeper_run.js
*/

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const TARGETS_PATH = process.env.TARGETS || path.join(__dirname, "..", "keeper", "targets.json");
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!RPC_URL) throw new Error("RPC_URL required");
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY required");

const abi = [
  "function updateEpoch() external",
  "function currentEpoch() view returns (uint64)",
  "function state() view returns (address borrower,address strategy,uint256 bond,uint256 debt,int256 score,uint256 failures,bool borrowDisabled,uint64 epoch,uint64 lastUpdatedBlock,uint256 lastEquity)"
];

async function main() {
  const raw = fs.readFileSync(TARGETS_PATH, "utf8");
  const targets = JSON.parse(raw);
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`keeper_run: chainId=${targets.chainId} acls=${targets.acls.length}`);

  for (const aclAddr of targets.acls) {
    const acl = new ethers.Contract(aclAddr, abi, wallet);
    try {
      const st = await acl.state();
      const eNow = await acl.currentEpoch();
      const eLast = st.epoch;
      const ready = eNow > eLast;
      console.log(`ACL ${aclAddr} epoch=${eLast} now=${eNow} ready=${ready} frozen=${st.borrowDisabled} debt=${st.debt}`);
      if (!ready) continue;

      const tx = await acl.updateEpoch();
      console.log(`  tx ${tx.hash}`);
      await tx.wait();
    } catch (err) {
      console.log(`  failed ${aclAddr}: ${err.message || err}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
