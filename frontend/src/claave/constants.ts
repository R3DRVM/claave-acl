export const CHAIN_ID = 143;
export const CHAIN_NAME = 'Monad Mainnet';
export const RPC_URL = 'https://rpc.monad.xyz';

// Deployed contracts (Monad mainnet)
export const ADDRS = {
  mUSDC: '0x5F185EB21779f330994024251Fa2730d19A7F6B7',
  pool: '0x804ED3eCFbB42d8197a9490369d2dF2719800d63',
  acl: '0x663a0e0910698b6B9e21015A0fEB234E1e6270D1',
  strategyMock: '0x479E93b34340BF3C6D6b45a18944F1cbFe7D7A4e',
  tokenKCL: '0x0acbf18A86f4293C0B6af7087f4952D440097777',
  kclPool: '0x9fCdcbDC1d0F7e687eb73E7B8C1DBF5bB21c5441'
} as const;

export const EXPLORER = {
  address: (a: string) => `https://monadvision.com/address/${a}`,
  tx: (h: string) => `https://monadvision.com/tx/${h}`,
  nadToken: (a: string) => `https://nad.fun/tokens/${a}`
};
