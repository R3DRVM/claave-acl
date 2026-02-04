#!/usr/bin/env node

const { ethers } = require('ethers');

const RPC = process.env.RPC_URL || 'https://rpc.monad.xyz';
const POOL_MANAGER = '0x188d586ddcf52439676ca21a244753fa19f9ea8e';

const INIT_SIG = 'Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)';
const TOPIC0 = ethers.id(INIT_SIG);

const ABI = [
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)'
];

async function main() {
  const poolId = process.argv[2];
  if (!poolId || !poolId.startsWith('0x') || poolId.length !== 66) {
    console.error('Usage: node scripts/findUniV4InitByPoolId.js <poolId-bytes32>');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const iface = new ethers.Interface(ABI);

  const latest = await provider.getBlockNumber();
  const idTopic = ethers.zeroPadValue(poolId, 32);

  // scan backwards in small chunks due to rpc 100-block limit
  const step = 100;
  const maxSpan = 2_000_000; // safety

  let scanned = 0;
  let end = latest;

  while (end >= 0 && scanned <= maxSpan) {
    const start = Math.max(0, end - step + 1);
    const logs = await provider.getLogs({
      address: POOL_MANAGER,
      fromBlock: start,
      toBlock: end,
      topics: [TOPIC0, idTopic],
    });

    if (logs.length > 0) {
      // Should only be one
      const l = logs[0];
      const ev = iface.parseLog(l);
      const { id, currency0, currency1, fee, tickSpacing, hooks, sqrtPriceX96, tick } = ev.args;

      console.log('FOUND');
      console.log({
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        poolId: id,
        currency0,
        currency1,
        fee: Number(fee),
        tickSpacing: Number(tickSpacing),
        hooks,
        sqrtPriceX96: sqrtPriceX96.toString(),
        tick: Number(tick),
      });
      return;
    }

    scanned += (end - start + 1);
    end = start - 1;

    if (scanned % 5_000 === 0) {
      console.log(`scanned ~${scanned} blocks... (latest=${latest}, currentEnd=${end})`);
    }
  }

  console.log('Not found in scanned span. Increase maxSpan or provide a closer fromBlock.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
