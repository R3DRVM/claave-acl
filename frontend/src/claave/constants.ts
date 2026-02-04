export const CHAIN_ID = 143;
export const CHAIN_NAME = 'Monad Mainnet';
export const RPC_URL = 'https://rpc.monad.xyz';

// Deployed contracts (Monad mainnet)
export const ADDRS = {
  // REAL Monad USDC (Monorail)
  mUSDC: '0x7547c8b7ca89f85c90c7e0f8269c44d8c7afb603',

  // NEW pool + ACL wired to real USDC
  pool: '0x4A057A5D5E961850516C633eEBdad144CEf3878F',
  acl: '0x8331f61f97f61480FE6B9fADD5d24B84F6DD3321',
  staking: '0x4d2BCb2d9eBb1cC748a4D9365011B328AAFc0eE2',

  // Legacy mock strategy (used only for simulated PnL path)
  strategyMock: '0x479E93b34340BF3C6D6b45a18944F1cbFe7D7A4e',

  tokenKCL: '0x0acbf18A86f4293C0B6af7087f4952D440097777',
  kclPool: '0x9fCdcbDC1d0F7e687eb73E7B8C1DBF5bB21c5441'
} as const;

export const EXPLORER = {
  address: (a: string) => `https://monadvision.com/address/${a}`,
  tx: (h: string) => `https://monadvision.com/tx/${h}`,
  nadToken: (a: string) => `https://nad.fun/tokens/${a}`
};
