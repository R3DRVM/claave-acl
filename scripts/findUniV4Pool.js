#!/usr/bin/env node

const { ethers } = require('ethers');

const RPC = process.env.RPC_URL || 'https://rpc.monad.xyz';

// Uniswap v4 Monad deployments (from docs.uniswap.org/contracts/v4/deployments#monad-143)
const POOL_MANAGER = '0x188d586DdCF52439676cA21a244753FA19f9ea8E';
const STATE_VIEW = '0x77395F3b2E73aE90843717371294Fa97CC419d64';

// Tokens (Monad)
const USDC = '0x7547c8b7ca89f85c90c7e0f8269c44d8c7afb603';
const NATIVE = ethers.ZeroAddress; // Currency(0) represents native (MON)
// WMON uncertain; keep for extra search
const WMON = '0x03bd3dd6534d52b5412e4d17f4c3bc1c5f15433a';

const STATEVIEW_ABI = [
  'function getLiquidity(bytes32 poolId) view returns (uint128)',
  'function getSlot0(bytes32 poolId) view returns (uint160,int24,uint24,uint24)'
];

function sortPair(a, b) {
  return BigInt(a.toLowerCase()) < BigInt(b.toLowerCase()) ? [a, b] : [b, a];
}

function poolId(currency0, currency1, fee, tickSpacing, hooks) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  // PoolKey is 5 * 32-byte slots; Currency is address-like.
  const enc = coder.encode(
    ['address', 'address', 'uint24', 'int24', 'address'],
    [currency0, currency1, fee, tickSpacing, hooks]
  );
  return ethers.keccak256(enc);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const stateView = new ethers.Contract(STATE_VIEW, STATEVIEW_ABI, provider);

  const hooks = ethers.ZeroAddress;

  const pairs = [
    { name: 'USDC/NATIVE', a: USDC, b: NATIVE },
    { name: 'USDC/WMON', a: USDC, b: WMON },
  ];

  const fees = [100, 500, 3000, 10000, 20000, 50000, 100000, 0x800000];
  const tickSpacings = [1, 2, 5, 10, 20, 30, 60, 100, 120, 200, 300, 600];

  for (const pair of pairs) {
    const [c0, c1] = sortPair(pair.a, pair.b);
    console.log(`Searching pools for ${pair.name}...`);
    console.log({ c0, c1 });

    for (const fee of fees) {
      for (const ts of tickSpacings) {
        const id = poolId(c0, c1, fee, ts, hooks);
        let liq;
        try {
          liq = await stateView.getLiquidity(id);
        } catch {
          continue;
        }
        if (liq > 0n) {
          const slot0 = await stateView.getSlot0(id);
          console.log('FOUND');
          console.log({ pair: pair.name, fee, tickSpacing: ts, poolId: id, liquidity: liq.toString(), slot0 });
          return;
        }
      }
    }
  }

  console.log('No pool found with tested params. Likely requires non-zero hooks and/or dynamic fee pools.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
