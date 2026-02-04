#!/usr/bin/env node
/*
  Nad.fun direct launch (API + router.create) — same flow as create-coin UI.

  1) POST https://api.nadapp.net/metadata/image        (raw image bytes)
  2) POST https://api.nadapp.net/metadata/metadata     (json)
  3) POST https://api.nadapp.net/token/salt            (json)
  4) Call BONDING_CURVE_ROUTER.create(params) with msg.value = deployFee + initialBuyMon

  Network: Monad mainnet (chainId 143)
*/

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const RPC_URL = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const PRIVATE_KEY = process.env.MONAD_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('Missing MONAD_PRIVATE_KEY');
  process.exit(1);
}

// nad.fun constants (from create-coin bundle)
const BONDING_CURVE_ROUTER = '0x6F6B8F1a20703309951a5127c45B49b1CD981A22';
const BONDING_CURVE = '0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE';

const ROUTER_ABI = [
  {
    type: 'function',
    name: 'create',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        internalType: 'struct IBondingCurveRouter.TokenCreationParams',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'tokenURI', type: 'string' },
          { name: 'amountOut', type: 'uint256' },
          { name: 'salt', type: 'bytes32' },
          { name: 'actionId', type: 'uint8' },
        ],
      },
    ],
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'pool', type: 'address' },
    ],
    stateMutability: 'payable',
  },
];

const CURVE_ABI = [
  {
    type: 'function',
    name: 'feeConfig',
    inputs: [],
    outputs: [
      { name: 'deployFeeAmount', type: 'uint256' },
      { name: 'graduateFeeAmount', type: 'uint256' },
      { name: 'protocolFee', type: 'uint24' },
    ],
    stateMutability: 'view',
  },
];

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${await res.text()}`);
  return await res.json();
}

async function uploadImage(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const ct = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

  const res = await fetch('https://api.nadapp.net/metadata/image', {
    method: 'POST',
    headers: { 'Content-Type': ct },
    body: buf,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} upload image: ${await res.text()}`);
  return await res.json();
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const NAME = process.env.TOKEN_NAME || 'Klaave Credit Line';
  const SYMBOL = process.env.TOKEN_SYMBOL || 'KCL';
  const DESCRIPTION = process.env.TOKEN_DESCRIPTION ||
    'Klaave is agent-native credit: autonomous agents post bond, earn a score from on-chain performance, and get a revolving credit line that auto-throttles when they underperform. Built by agents for agents on Monad.';

  const WEBSITE = process.env.TOKEN_WEBSITE || 'https://github.com/R3DRVM/claave-acl';
  const TWITTER = process.env.TOKEN_TWITTER || 'https://x.com/Klawbster_bot';
  const TELEGRAM = process.env.TOKEN_TELEGRAM || '';

  const IMAGE_PATH = process.env.TOKEN_IMAGE || '/Users/redrum/.clawdbot/media/inbound/54b5b896-0e70-4524-a580-8aeb0b65ef45.jpg';

  const initialBuyMon = process.env.INITIAL_BUY_MON ? Number(process.env.INITIAL_BUY_MON) : 0.2;

  console.log('Deployer:', wallet.address);
  console.log('ChainId:', (await provider.getNetwork()).chainId.toString());

  const curve = new ethers.Contract(BONDING_CURVE, CURVE_ABI, provider);
  const [deployFeeAmount] = await curve.feeConfig();

  console.log('Uploading image…');
  const img = await uploadImage(IMAGE_PATH);

  console.log('Uploading metadata…');
  const meta = await postJson('https://api.nadapp.net/metadata/metadata', {
    name: NAME,
    symbol: SYMBOL,
    description: DESCRIPTION,
    image_uri: img.image_uri,
    website: WEBSITE,
    twitter: TWITTER,
    telegram: TELEGRAM,
    is_nsfw: false,
  });

  console.log('Generating salt…');
  const saltResp = await postJson('https://api.nadapp.net/token/salt', {
    creator: wallet.address,
    metadata_uri: meta.metadata_uri,
    name: meta.metadata.name,
    symbol: meta.metadata.symbol,
  });

  const router = new ethers.Contract(BONDING_CURVE_ROUTER, ROUTER_ABI, wallet);

  const value = deployFeeAmount + ethers.parseEther(initialBuyMon.toString());

  console.log('Creating coin on-chain…');
  const tx = await router.create(
    {
      name: NAME,
      symbol: SYMBOL,
      tokenURI: meta.metadata_uri,
      amountOut: 0n,
      salt: saltResp.salt,
      actionId: 1,
    },
    { value }
  );

  console.log('tx:', tx.hash);
  const rec = await tx.wait();
  console.log('status:', rec.status);
  console.log('metadata_uri:', meta.metadata_uri);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
