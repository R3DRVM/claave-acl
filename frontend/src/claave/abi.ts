// Minimal ABIs used by the frontend

export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

export const ACLPOOL_ABI = [
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function availableLiquidity() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
  'event Deposit(address indexed lender, uint256 assets, uint256 shares)',
  'event Withdraw(address indexed lender, uint256 assets, uint256 shares)'
];

export const STAKING_ABI = [
  'function kcl() view returns (address)',
  'function staked(address) view returns (uint256)',
  'function stake(uint256 amount)',
  'function unstake(uint256 amount)',
  'event Staked(address indexed user, uint256 amount, uint256 total)',
  'event Unstaked(address indexed user, uint256 amount, uint256 remaining)'
];

export const ACL_ABI = [
  'function asset() view returns (address)',
  'function pool() view returns (address)',
  'function epochBlocks() view returns (uint256)',
  'function freezeScore() view returns (int256)',
  'function creditLimit() view returns (uint256)',
  'function availableToBorrow() view returns (uint256)',
  'function currentEpoch() view returns (uint64)',
  'function linkStrategy(address strategy, bytes sig)',
  'function postBond(uint256 amount)',
  'function borrow(uint256 amount)',
  'function repay(uint256 amount)',
  'function updateEpoch()',
  'function state() view returns (address borrower,address strategy,uint256 bond,uint256 debt,int256 score,uint256 failures,bool borrowDisabled,uint64 epoch,uint64 lastUpdatedBlock,uint256 lastEquity)',
  'event Linked(address indexed borrower, address indexed strategy)',
  'event BondPosted(address indexed borrower, uint256 amount, uint256 totalBond)',
  'event Borrowed(address indexed borrower, uint256 amount, uint256 debt)',
  'event Repaid(address indexed borrower, uint256 amount, uint256 debt)',
  'event EpochUpdated(uint64 epoch, int256 perf, int256 score, uint256 equity)',
  'event CreditLimitUpdated(uint256 oldLimit, uint256 newLimit, bool frozen)'
];

export const STRATEGYMOCK_ABI = [
  'function owner() view returns (address)',
  'function balance() view returns (uint256)',
  'function simulatePnL(int256 pnl)',
  'function sweep(address to, uint256 amount)',
  'event SimulatedReturn(int256 pnl, uint256 newBalance)'
];
