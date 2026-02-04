export const CHAIN_ID = 143;
export const CHAIN_NAME = 'Monad Mainnet';
export const RPC_URL = 'https://rpc.monad.xyz';

// Deployed contracts (Monad mainnet)
export const ADDRS = {
  // REAL Monad USDC (Uniswap v4 pool)
  mUSDC: '0x754704bc059f8c67012fed69bc8a327a5aafb603',

  // Pool + ACL wired to real USDC (fee routing -> reserve)
  pool: '0x4d9a2b2a34bc17ecac4b7fe0c8843de520384f23',
  acl: '0x9793d0260d9ebc62bb8c2f4c0aa2f8c6236d124b',
  staking: '0x1945660885fb9a7d78d48c49c5167e75f89e73e6',
  reserve: '0x36eea72139e21a89420796a6e19e37c905244d29',

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
