#!/usr/bin/env node

const { ethers } = require('ethers');

const RPC = process.env.RPC_URL || 'https://rpc.monad.xyz';

// Uniswap v4 Monad deployments
const POOL_MANAGER = '0x188d586ddcf52439676ca21a244753fa19f9ea8e';

const USDC = '0x7547c8b7ca89f85c90c7e0f8269c44d8c7afb603';

const INIT_SIG = 'Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)';
const TOPIC0 = ethers.id(INIT_SIG);

const ABI = [
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)'
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const iface = new ethers.Interface(ABI);

  const latest = await provider.getBlockNumber();

  // RPC limits eth_getLogs to small block ranges on this endpoint.
  // We'll scan in 100-block chunks, widening if needed.
  const ranges = [
    5_000,
    25_000,
    100_000,
  ];

  const usdcTopic = ethers.zeroPadValue(USDC, 32);

  for (const span of ranges) {
    const fromBlock = Math.max(0, latest - span);
    console.log(`Scanning Initialize logs from ${fromBlock} -> ${latest} (span ${span})...`);

    const logs = [];
    const step = 100; // hard limit from rpc

    for (let start = fromBlock; start <= latest; start += step) {
      const end = Math.min(latest, start + step - 1);

      const [logs0, logs1] = await Promise.all([
        provider.getLogs({
          address: POOL_MANAGER,
          fromBlock: start,
          toBlock: end,
          topics: [TOPIC0, null, usdcTopic],
        }),
        provider.getLogs({
          address: POOL_MANAGER,
          fromBlock: start,
          toBlock: end,
          topics: [TOPIC0, null, null, usdcTopic],
        }),
      ]);

      logs.push(...logs0, ...logs1);
    }

    logs.sort((a, b) => a.blockNumber - b.blockNumber);
    console.log(`Found ${logs.length} pools involving USDC in this range.`);

    if (logs.length === 0) continue;

    for (const l of logs.slice(-30)) {
      const ev = iface.parseLog(l);
      const { id, currency0, currency1, fee, tickSpacing, hooks } = ev.args;
      console.log({
        blockNumber: l.blockNumber,
        txHash: l.transactionHash,
        poolId: id,
        currency0,
        currency1,
        fee: Number(fee),
        tickSpacing: Number(tickSpacing),
        hooks,
      });
    }

    console.log('Done.');
    return;
  }

  console.log('No USDC pools found in scanned ranges. Either USDC not used on v4 pools, or need to scan further back.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
