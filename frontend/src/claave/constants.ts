import deployment from "../../../deployments/monad-mainnet.json";

export const CHAIN_ID = deployment.chain.chainId;
export const CHAIN_NAME = `${deployment.chain.name} Mainnet`;
export const RPC_URL = deployment.chain.rpcUrl;

// Deployed contracts (Monad mainnet)
export const ADDRS = {
  // REAL Monad USDC (Uniswap v4 pool)
  mUSDC: deployment.asset.address,

  // Pool + ACL wired to real USDC
  pool: deployment.contracts.aclPool,
  acl: deployment.contracts.agentCreditLine,
  staking: deployment.contracts.kclStaking,
  reserve: deployment.contracts.protocolReserve,

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
