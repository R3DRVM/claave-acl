// lender.ts - Conservative Lender Agent
// Deposits USDC into pool, monitors rates, and optimizes yield
import { ethers } from "ethers";
import {
  AgentLogger,
  MetricsCollector,
  loadConfig,
  retryWithBackoff,
  sleep,
  checkHealth,
  approveUSDC,
  formatUSDC,
  parseUSDC,
  USDC_ABI,
  POOL_ABI,
} from "./shared-utils";

const DEPOSIT_AMOUNT = parseUSDC("50000"); // 50,000 USDC
const MIN_RATE_BPS = 300; // 3% annual
const REDEPOSIT_RATE_BPS = 500; // 5% annual
const CHECK_INTERVAL_BLOCKS = 10;
const CHECK_INTERVAL_MS = 12000; // ~12 seconds per block on Base

class ConservativeLender {
  private logger: AgentLogger;
  private metrics: MetricsCollector;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private usdc: ethers.Contract;
  private pool: ethers.Contract;
  private isDeposited: boolean = false;
  private shares: bigint = 0n;
  private initialBalance: bigint = 0n;
  private running: boolean = true;

  constructor() {
    this.logger = new AgentLogger("lender");
    this.metrics = new MetricsCollector("lender");
    
    const config = loadConfig("LENDER");
    
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    this.usdc = new ethers.Contract(config.usdcAddress, USDC_ABI, this.wallet);
    this.pool = new ethers.Contract(config.poolAddress, POOL_ABI, this.wallet);
    
    this.logger.log("Conservative Lender initialized", {
      address: this.wallet.address,
      poolAddress: config.poolAddress,
    });
  }

  async start() {
    this.logger.log("🏦 Conservative Lender starting...");
    
    // Initial health check
    const healthy = await checkHealth(this.provider, this.logger);
    if (!healthy) {
      throw new Error("Health check failed");
    }

    // Record initial balance
    this.initialBalance = await this.usdc.balanceOf(this.wallet.address);
    this.logger.log(`Initial USDC balance: ${formatUSDC(this.initialBalance)}`);
    this.metrics.setCustomMetric("initialBalance", formatUSDC(this.initialBalance));

    // Perform initial deposit
    await this.deposit();

    // Start monitoring loop
    await this.monitorLoop();
  }

  async deposit() {
    try {
      this.logger.log(`Attempting to deposit ${formatUSDC(DEPOSIT_AMOUNT)} USDC...`);

      // Check balance
      const balance = await this.usdc.balanceOf(this.wallet.address);
      if (balance < DEPOSIT_AMOUNT) {
        this.logger.error("Insufficient USDC balance", { balance: formatUSDC(balance), needed: formatUSDC(DEPOSIT_AMOUNT) });
        return;
      }

      // Approve pool
      const approved = await approveUSDC(this.usdc, await this.pool.getAddress(), DEPOSIT_AMOUNT, this.logger);
      if (!approved) return;

      // Deposit
      const tx = await retryWithBackoff(async () => {
        return await this.pool.deposit(DEPOSIT_AMOUNT, this.wallet.address);
      });

      const receipt = await tx.wait();
      this.metrics.recordTx(true, receipt.gasUsed, receipt.gasUsed * receipt.gasPrice);

      // Get shares received
      this.shares = await this.pool.balanceOf(this.wallet.address);
      this.isDeposited = true;

      this.logger.success(`Deposited ${formatUSDC(DEPOSIT_AMOUNT)} USDC`, {
        shares: this.shares.toString(),
        txHash: receipt.hash,
      });

      this.metrics.setCustomMetric("deposited", true);
      this.metrics.setCustomMetric("shares", this.shares.toString());
      this.metrics.setCustomMetric("depositAmount", formatUSDC(DEPOSIT_AMOUNT));
    } catch (error) {
      this.logger.error("Failed to deposit", error);
      this.metrics.recordTx(false, 0n, 0n);
    }
  }

  async withdraw() {
    try {
      if (!this.isDeposited || this.shares === 0n) {
        this.logger.warn("Nothing to withdraw");
        return;
      }

      this.logger.log(`Withdrawing ${this.shares.toString()} shares...`);

      const tx = await retryWithBackoff(async () => {
        return await this.pool.redeem(this.shares, this.wallet.address, this.wallet.address);
      });

      const receipt = await tx.wait();
      this.metrics.recordTx(true, receipt.gasUsed, receipt.gasUsed * receipt.gasPrice);

      const assetsReceived = await this.usdc.balanceOf(this.wallet.address);
      
      this.isDeposited = false;
      this.shares = 0n;

      this.logger.success(`Withdrew shares for USDC`, {
        assetsReceived: formatUSDC(assetsReceived),
        txHash: receipt.hash,
      });

      this.metrics.setCustomMetric("deposited", false);
      this.metrics.setCustomMetric("shares", "0");
    } catch (error) {
      this.logger.error("Failed to withdraw", error);
      this.metrics.recordTx(false, 0n, 0n);
    }
  }

  async checkRate(): Promise<number> {
    try {
      // Get pool stats
      const totalAssets = await this.pool.totalAssets();
      const availableLiquidity = await this.pool.availableLiquidity();
      
      // Calculate implied utilization
      const borrowed = totalAssets - availableLiquidity;
      const utilization = totalAssets > 0n ? Number((borrowed * 10000n) / totalAssets) : 0;

      // Estimate rate based on utilization (mimics contract logic)
      // This is an approximation - actual rate may vary
      let estimatedRate = 200; // 2% base rate in bps

      if (utilization === 0) {
        estimatedRate = 200;
      } else if (utilization <= 8000) { // <= 80%
        estimatedRate = 200 + Math.floor((utilization / 8000) * 400);
      } else { // > 80%
        const excessUtil = utilization - 8000;
        estimatedRate = 200 + 400 + Math.floor((excessUtil / 2000) * 6000);
      }

      this.logger.log("Rate check", {
        totalAssets: formatUSDC(totalAssets),
        availableLiquidity: formatUSDC(availableLiquidity),
        borrowed: formatUSDC(borrowed),
        utilizationBps: utilization,
        estimatedRateBps: estimatedRate,
      });

      this.metrics.setCustomMetric("lastCheckUtilization", utilization);
      this.metrics.setCustomMetric("lastCheckRate", estimatedRate);

      return estimatedRate;
    } catch (error) {
      this.logger.error("Failed to check rate", error);
      return 0;
    }
  }

  async calculateYield(): Promise<bigint> {
    try {
      if (!this.isDeposited || this.shares === 0n) return 0n;

      const currentValue = await this.pool.previewRedeem(this.shares);
      const yieldEarned = currentValue > DEPOSIT_AMOUNT ? currentValue - DEPOSIT_AMOUNT : 0n;

      this.logger.log("Yield calculation", {
        shares: this.shares.toString(),
        currentValue: formatUSDC(currentValue),
        depositAmount: formatUSDC(DEPOSIT_AMOUNT),
        yieldEarned: formatUSDC(yieldEarned),
      });

      this.metrics.setCustomMetric("currentValue", formatUSDC(currentValue));
      this.metrics.setCustomMetric("yieldEarned", formatUSDC(yieldEarned));

      return yieldEarned;
    } catch (error) {
      this.logger.error("Failed to calculate yield", error);
      return 0n;
    }
  }

  async monitorLoop() {
    let blockCounter = 0;

    while (this.running) {
      try {
        blockCounter++;

        // Check rate every CHECK_INTERVAL_BLOCKS
        if (blockCounter % CHECK_INTERVAL_BLOCKS === 0) {
          const rate = await this.checkRate();
          const yieldEarned = await this.calculateYield();

          this.metrics.updateProfitLoss(yieldEarned);

          // Decision logic
          if (this.isDeposited && rate < MIN_RATE_BPS) {
            this.logger.warn(`Rate ${rate} bps below minimum ${MIN_RATE_BPS} bps, withdrawing...`);
            await this.withdraw();
          } else if (!this.isDeposited && rate >= REDEPOSIT_RATE_BPS) {
            this.logger.log(`Rate ${rate} bps above redeposit threshold ${REDEPOSIT_RATE_BPS} bps, depositing...`);
            await this.deposit();
          }
        }

        // Wait for next check
        await sleep(CHECK_INTERVAL_MS);
      } catch (error) {
        this.logger.error("Error in monitor loop", error);
        await sleep(CHECK_INTERVAL_MS * 2); // Back off on error
      }
    }
  }

  async shutdown() {
    this.logger.log("Shutting down...");
    this.running = false;

    // Withdraw if still deposited
    if (this.isDeposited) {
      await this.withdraw();
    }

    // Final metrics
    const finalBalance = await this.usdc.balanceOf(this.wallet.address);
    const totalProfit = finalBalance > this.initialBalance 
      ? finalBalance - this.initialBalance 
      : -(this.initialBalance - finalBalance);

    this.logger.log("Final summary", {
      initialBalance: formatUSDC(this.initialBalance),
      finalBalance: formatUSDC(finalBalance),
      totalProfit: formatUSDC(BigInt(totalProfit > 0 ? totalProfit : -totalProfit)),
      profitable: totalProfit > 0,
    });

    this.metrics.setCustomMetric("finalBalance", formatUSDC(finalBalance));
    this.metrics.setCustomMetric("totalProfit", formatUSDC(BigInt(totalProfit)));
  }
}

// Main execution
async function main() {
  const lender = new ConservativeLender();

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down gracefully...");
    await lender.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down gracefully...");
    await lender.shutdown();
    process.exit(0);
  });

  await lender.start();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
