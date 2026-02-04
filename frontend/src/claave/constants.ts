export const CHAIN_ID = 143;
export const CHAIN_NAME = 'Monad Mainnet';
export const RPC_URL = 'https://rpc.monad.xyz';

// Deployed contracts (Monad mainnet)
export const ADDRS = {
  // REAL Monad USDC (Uniswap v4 pool)
  mUSDC: '0x754704bc059f8c67012fed69bc8a327a5aafb603',

  // Pool + ACL wired to real USDC (fee routing -> reserve)
  pool: '0x627174de6da03522a2af6ec3d0e2df6466508ff4',
  acl: '0xc760c02df544c59346594050c7f162e7a485939f',
  staking: '0x3b717f3f6936810199e79c32fc9f23a829dc8770',
  reserve: '0x5c57584de82d03de6974ac65c47477c053ff824a',

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
