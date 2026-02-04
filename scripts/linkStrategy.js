#!/usr/bin/env node

const { ethers } = require('ethers');

const RPC_URL = process.env.RPC_URL || 'https://rpc.monad.xyz';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ACL = process.env.ACL;
const STRATEGY = process.env.STRATEGY; // default: wallet.address

if (!PRIVATE_KEY || !ACL) {
  console.error('Usage: RPC_URL=... PRIVATE_KEY=... ACL=0x... [STRATEGY=0x...] node scripts/linkStrategy.js');
  process.exit(1);
}

const ACL_ABI = ['function linkStrategy(address strategy, bytes sig)'];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const strategy = STRATEGY || wallet.address;

  const raw = ethers.solidityPackedKeccak256(
    ['string', 'address', 'address', 'address'],
    ['ACL_LINK', ACL, wallet.address, strategy]
  );

  const sig = await wallet.signMessage(ethers.getBytes(raw));

  const acl = new ethers.Contract(ACL, ACL_ABI, wallet);
  const tx = await acl.linkStrategy(strategy, sig);
  console.log('tx', tx.hash);
  const rec = await tx.wait();
  console.log('status', rec.status);
  console.log('strategy', strategy);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
