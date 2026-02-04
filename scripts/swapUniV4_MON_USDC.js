#!/usr/bin/env node

// Swap MON -> USDC on Uniswap v4 (Monad) via Universal Router, using known pool key.
// This mints real USDC into the caller wallet (msgSender).
//
// Usage:
//   RPC_URL=https://rpc.monad.xyz PRIVATE_KEY=... node scripts/swapUniV4_MON_USDC.js 0.05
//
// amount argument is in MON.

const { ethers } = require('ethers');

const RPC_URL = process.env.RPC_URL || 'https://rpc.monad.xyz';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('Missing PRIVATE_KEY');
  process.exit(1);
}

// Uniswap v4 Monad deployments (chain 143)
const UNIVERSAL_ROUTER = '0x0d97dc33264bfc1c226207428a79b26757fb9dc3';

// PoolKey for MON/USDC v4 pool (provided by user via Uniswap pool link)
const POOL_KEY = {
  currency0: ethers.ZeroAddress, // native MON
  currency1: '0x754704bc059f8c67012fed69bc8a327a5aafb603', // USDC
  fee: 500,
  tickSpacing: 10,
  hooks: ethers.ZeroAddress,
};

// v4-periphery action ids
const ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
const ACTION_SETTLE_ALL = 0x0c;
const ACTION_TAKE_ALL = 0x0f;

async function main() {
  const amountMon = process.argv[2] ? Number(process.argv[2]) : 0.05;
  if (!Number.isFinite(amountMon) || amountMon <= 0) throw new Error('amount must be >0');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const net = await provider.getNetwork();

  console.log('from', wallet.address);
  console.log('chainId', net.chainId.toString());

  const amountIn = ethers.parseEther(amountMon.toString());

  // Encode params for SWAP_EXACT_IN_SINGLE
  // struct ExactInputSingleParams { PoolKey poolKey; bool zeroForOne; uint128 amountIn; uint128 amountOutMinimum; bytes hookData; }
  const swapParams = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      'tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)',
      'bool',
      'uint128',
      'uint128',
      'bytes'
    ],
    [
      [POOL_KEY.currency0, POOL_KEY.currency1, POOL_KEY.fee, POOL_KEY.tickSpacing, POOL_KEY.hooks],
      true, // zeroForOne: currency0 (MON) -> currency1 (USDC)
      amountIn,
      0n,
      '0x'
    ]
  );

  // SETTLE_ALL(Currency currency, uint256 maxAmount)
  const settleParams = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256'],
    [POOL_KEY.currency0, amountIn]
  );

  // TAKE_ALL(Currency currency, uint256 minAmount)
  const takeParams = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256'],
    [POOL_KEY.currency1, 0]
  );

  const actions = ethers.hexlify(Uint8Array.from([
    ACTION_SWAP_EXACT_IN_SINGLE,
    ACTION_SETTLE_ALL,
    ACTION_TAKE_ALL
  ]));

  const unlockData = ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes', 'bytes[]'],
    [actions, [swapParams, settleParams, takeParams]]
  );

  // Universal Router command for V4_SWAP is 0x10
  const commands = '0x10';

  const iface = new ethers.Interface([
    'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'
  ]);

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  const data = iface.encodeFunctionData('execute', [commands, [unlockData], deadline]);

  const tx = await wallet.sendTransaction({
    to: UNIVERSAL_ROUTER,
    data,
    value: amountIn,
  });

  console.log('tx', tx.hash);
  const rec = await tx.wait();
  console.log('status', rec.status);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
