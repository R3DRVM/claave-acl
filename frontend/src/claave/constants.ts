export const CHAIN_ID = 143;
export const CHAIN_NAME = 'Monad Mainnet';
export const RPC_URL = 'https://rpc.monad.xyz';

// Deployed contracts (Monad mainnet)
export const ADDRS = {
  // REAL Monad USDC (Uniswap v4 pool)
  mUSDC: '0x754704bc059f8c67012fed69bc8a327a5aafb603',

  // Pool + ACL wired to real USDC
  pool: '0x7ffd11ae91d0fe1c889bad7939ad12d8fd4a63dc',
  acl: '0xdb83d43de1131fafc972a24519a6a86b6bd4fdef',
  staking: '0x6786bc60d21bfa863da4e39fe53d39c952ab3214',

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
