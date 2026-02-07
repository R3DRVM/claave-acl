// shared-utils.ts - Common utilities for all agents
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AgentConfig {
  name: string;
  rpcUrl: string;
  privateKey: string;
  poolAddress: string;
  creditLineAddresses: string[];
  usdcAddress: string;
  kclStakingAddress: string;
  reserveAddress: string;
}

export interface AgentMetrics {
  agentName: string;
  startTime: number;
  totalTxs: number;
  successfulTxs: number;
  failedTxs: number;
  totalGasUsed: bigint;
  totalGasCost: bigint;
  profitLoss: bigint; // in USDC units
  customMetrics: Record<string, any>;
}

export class AgentLogger {
  private logFile: string;
  private agentName: string;

  constructor(agentName: string) {
    this.agentName = agentName;
    const logsDir = path.join(__dirname, "../../logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    this.logFile = path.join(logsDir, `${agentName}-${Date.now()}.log`);
  }

  log(message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      agent: this.agentName,
      message,
      data,
    };
    const logLine = JSON.stringify(logEntry) + "\n";
    
    console.log(`[${timestamp}] [${this.agentName}] ${message}`, data || "");
    fs.appendFileSync(this.logFile, logLine);
  }

  error(message: string, error: any) {
    this.log(`ERROR: ${message}`, {
      error: error.message || error,
      stack: error.stack,
    });
  }

  success(message: string, data?: any) {
    this.log(`✅ ${message}`, data);
  }

  warn(message: string, data?: any) {
    this.log(`⚠️ ${message}`, data);
  }
}

export class MetricsCollector {
  private metrics: AgentMetrics;
  private metricsFile: string;

  constructor(agentName: string) {
    this.metrics = {
      agentName,
      startTime: Date.now(),
      totalTxs: 0,
      successfulTxs: 0,
      failedTxs: 0,
      totalGasUsed: 0n,
      totalGasCost: 0n,
      profitLoss: 0n,
      customMetrics: {},
    };

    const metricsDir = path.join(__dirname, "../../metrics");
    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }
    this.metricsFile = path.join(metricsDir, `${agentName}-metrics.json`);
  }

  recordTx(success: boolean, gasUsed: bigint, gasCost: bigint) {
    this.metrics.totalTxs++;
    if (success) {
      this.metrics.successfulTxs++;
    } else {
      this.metrics.failedTxs++;
    }
    this.metrics.totalGasUsed += gasUsed;
    this.metrics.totalGasCost += gasCost;
    this.save();
  }

  updateProfitLoss(delta: bigint) {
    this.metrics.profitLoss += delta;
    this.save();
  }

  setCustomMetric(key: string, value: any) {
    this.metrics.customMetrics[key] = value;
    this.save();
  }

  getMetrics(): AgentMetrics {
    return { ...this.metrics };
  }

  private save() {
    const data = JSON.stringify(this.metrics, (_, v) =>
      typeof v === "bigint" ? v.toString() : v
    , 2);
    fs.writeFileSync(this.metricsFile, data);
  }
}

// Retry logic for RPC failures
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  
  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ABIs for contracts
export const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

export const POOL_ABI = [
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)",
  "function balanceOf(address) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function availableLiquidity() view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
];

export const CREDIT_LINE_ABI = [
  "function postBond(uint256 amount)",
  "function borrow(uint256 grossAmount)",
  "function repay(uint256 amount)",
  "function creditLimit() view returns (uint256)",
  "function availableToBorrow() view returns (uint256)",
  "function currentBorrowRate() view returns (uint256)",
  "function currentUtilization() view returns (uint256)",
  "function healthFactor() view returns (uint256)",
  "function isLiquidatable() view returns (bool)",
  "function slashBond(uint256 amount)",
  "function linkStrategy(address strategy, bytes sig)",
  "function updateEpoch()",
  "function debt() view returns (uint256)",
  "function bond() view returns (uint256)",
  "function slashable() view returns (bool)",
  "function isDelinquent() view returns (bool)",
];

// Helper to format USDC amounts
export function formatUSDC(amount: bigint): string {
  return ethers.formatUnits(amount, 6);
}

// Helper to parse USDC amounts
export function parseUSDC(amount: string): bigint {
  return ethers.parseUnits(amount, 6);
}

// Health check function
export async function checkHealth(
  provider: ethers.Provider,
  logger: AgentLogger
): Promise<boolean> {
  try {
    const blockNumber = await provider.getBlockNumber();
    logger.log(`Health check passed. Current block: ${blockNumber}`);
    return true;
  } catch (error) {
    logger.error("Health check failed", error);
    return false;
  }
}

// Approve USDC spending
export async function approveUSDC(
  usdc: ethers.Contract,
  spender: string,
  amount: bigint,
  logger: AgentLogger
): Promise<boolean> {

  try {
    const tx = await usdc.approve(spender, amount);
    await tx.wait();
    logger.success(`Approved ${formatUSDC(amount)} USDC for ${spender}`);
    return true;
  } catch (error) {
    logger.error("Failed to approve USDC", error);
    return false;
  }
}

// Link strategy for a credit line.
// AgentCreditLineKCLFee requires the borrower to self-sign a digest:
// keccak256("ACL_LINK", creditLine, borrower, strategy)
export async function linkStrategy(
  creditLineAddress: string,
  borrowerWallet: ethers.Wallet,
  creditLine: ethers.Contract,
  strategyAddress: string,
  logger: AgentLogger
): Promise<boolean> {
  try {
    const digest = ethers.keccak256(
      ethers.solidityPacked(
        ["string", "address", "address", "address"],
        ["ACL_LINK", creditLineAddress, borrowerWallet.address, strategyAddress]
      )
    );

    const sig = await borrowerWallet.signMessage(ethers.getBytes(digest));
    const tx = await creditLine.linkStrategy(strategyAddress, sig);
    await tx.wait();

    logger.success("Linked strategy", { creditLineAddress, strategyAddress });
    return true;
  } catch (error) {
    logger.error("Failed to link strategy", error);
    return false;
  }
}

// Load config from environment
export function loadConfig(agentName: string): AgentConfig {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL;
  const privateKey = process.env[`${agentName.toUpperCase()}_PRIVATE_KEY`];
  const poolAddress = process.env.POOL_ADDRESS;
  const creditLineAddresses = (process.env.CREDIT_LINE_ADDRESSES || "").split(",");
  const usdcAddress = process.env.USDC_ADDRESS;
  const kclStakingAddress = process.env.KCL_STAKING_ADDRESS;
  const reserveAddress = process.env.RESERVE_ADDRESS;

  if (!rpcUrl || !privateKey || !poolAddress || !usdcAddress) {
    throw new Error(`Missing required environment variables for ${agentName}`);
  }

  return {
    name: agentName,
    rpcUrl,
    privateKey,
    poolAddress,
    creditLineAddresses,
    usdcAddress,
    kclStakingAddress: kclStakingAddress || "",
    reserveAddress: reserveAddress || "",
  };
}
