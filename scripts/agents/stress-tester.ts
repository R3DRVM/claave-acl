// stress-tester.ts - Stress Tester Agent
// Max borrows all credit lines, drains pool to 100% utilization, causes rate spike
import { ethers } from "ethers";
import {
  AgentLogger,
  MetricsCollector,
  loadConfig,
  retryWithBackoff,
  sleep,
  checkHealth,
  approveUSDC,
  linkStrategy,
  formatUSDC,
  parseUSDC,
  USDC_ABI,
  POOL_ABI,
  CREDIT_LINE_ABI,
} from "./shared-utils";

const BOND_PER_LINE = parseUSDC("5000"); // 5,000 USDC bond per credit line
const MAX_BORROW_ATTEMPTS = 5;
const STRESS_CYCLE_DELAY_MS = 300000; // 5 minutes between stress cycles
const TARGET_UTILIZATION_BPS = 9900; // 99% utilization target

class StressTester {
  private logger: AgentLogger;
  private metrics: MetricsCollector;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private usdc: ethers.Contract;
  private pool: ethers.Contract;
  private creditLines: ethers.Contract[] = [];
  private initialBalance: bigint = 0n;
  private running: boolean = true;
  private totalBorrowed: bigint = 0n;
  private totalBonds: bigint = 0n;

  constructor() {
    this.logger = new AgentLogger("stress-tester");
    this.metrics = new MetricsCollector("stress-tester");
    
    const config = loadConfig("STRESS_TESTER");
    
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    this.usdc = new ethers.Contract(config.usdcAddress, USDC_ABI, this.wallet);
    this.pool = new ethers.Contract(config.poolAddress, POOL_ABI, this.wallet);
    
    // In our testnet setup, each credit line has a single borrower.
    // Stress tester can only operate on credit lines where *it* is the borrower.
    // We pick the last configured address (deployed for this wallet).
    const addrs = config.creditLineAddresses.filter(a => a && a !== "");
    const chosen = addrs.length ? addrs[addrs.length - 1] : "";
    if (chosen) {
      this.creditLines.push(new ethers.Contract(chosen, CREDIT_LINE_ABI, this.wallet));
    }
    
    this.logger.log("Stress Tester initialized", {
      address: this.wallet.address,
      creditLines: this.creditLines.length,
    });
  }

  async start() {
    this.logger.log("💥 Stress Tester starting...");
    
    // Initial health check
    const healthy = await checkHealth(this.provider, this.logger);
    if (!healthy) {
      throw new Error("Health check failed");
    }

    // Record initial balance
    this.initialBalance = await this.usdc.balanceOf(this.wallet.address);
    this.logger.log(`Initial USDC balance: ${formatUSDC(this.initialBalance)}`);
    this.metrics.setCustomMetric("initialBalance", formatUSDC(this.initialBalance));

    // Start stress testing loop
    await this.stressLoop();
  }

  async postBonds() {
    this.logger.log(`Posting bonds to ${this.creditLines.length} credit lines...`);
    
    for (let i = 0; i < this.creditLines.length; i++) {
      try {
        const creditLine = this.creditLines[i];
        const address = await creditLine.getAddress();
        
        // Check if already bonded
        const bonded = await creditLine.bond();
        if (bonded > 0n) {
          this.logger.log(`Credit line ${i} already has bond: ${formatUSDC(bonded)}`);
          this.totalBonds += bonded;
          // Ensure strategy is linked (required before borrowing)
          await linkStrategy(address, this.wallet, creditLine, this.wallet.address, this.logger);
          continue;
        }

        // Approve and post bond
        const approved = await approveUSDC(this.usdc, address, BOND_PER_LINE, this.logger);
        if (!approved) continue;

        const tx = await retryWithBackoff(async () => {
          return await creditLine.postBond(BOND_PER_LINE);
        });

        const receipt = await tx.wait();
        this.metrics.recordTx(true, receipt.gasUsed, receipt.gasUsed * receipt.gasPrice);
        this.totalBonds += BOND_PER_LINE;

        // Ensure strategy is linked (required before borrowing)
        await linkStrategy(address, this.wallet, creditLine, this.wallet.address, this.logger);

        this.logger.success(`Posted bond to credit line ${i}`, {
          amount: formatUSDC(BOND_PER_LINE),
          txHash: receipt.hash,
        });
      } catch (error) {
        this.logger.error(`Failed to post bond to credit line ${i}`, error);
        this.metrics.recordTx(false, 0n, 0n);
      }
    }

    this.metrics.setCustomMetric("totalBonds", formatUSDC(this.totalBonds));
  }

  async maxBorrowAllLines() {
    this.logger.log("🔥 MAX BORROWING ALL CREDIT LINES...");
    
    const poolLiquidityBefore = await this.pool.availableLiquidity();
    this.logger.log(`Pool liquidity before: ${formatUSDC(poolLiquidityBefore)}`);

    for (let i = 0; i < this.creditLines.length; i++) {
      try {
        const creditLine = this.creditLines[i];
        
        // Get available to borrow
        const available = await creditLine.availableToBorrow();
        if (available === 0n) {
          this.logger.warn(`Credit line ${i} has no borrowing capacity`);
          continue;
        }

        // Borrow maximum available
        this.logger.log(`Borrowing ${formatUSDC(available)} from credit line ${i}...`);
        
        const tx = await retryWithBackoff(async () => {
          return await creditLine.borrow(available);
        });

        const receipt = await tx.wait();
        this.metrics.recordTx(true, receipt.gasUsed, receipt.gasUsed * receipt.gasPrice);
        this.totalBorrowed += available;

        this.logger.success(`Borrowed from credit line ${i}`, {
          amount: formatUSDC(available),
          txHash: receipt.hash,
        });

        // Check pool utilization
        const poolLiquidity = await this.pool.availableLiquidity();
        const totalAssets = await this.pool.totalAssets();
        const utilization = totalAssets > 0n 
          ? Number((totalAssets - poolLiquidity) * 10000n / totalAssets)
          : 0;

        this.logger.log(`Pool utilization: ${utilization / 100}%`, {
          availableLiquidity: formatUSDC(poolLiquidity),
          totalAssets: formatUSDC(totalAssets),
        });

        this.metrics.setCustomMetric("currentUtilization", utilization);

        // Stop if we've reached target utilization
        if (utilization >= TARGET_UTILIZATION_BPS) {
          this.logger.success(`🎯 Target utilization ${TARGET_UTILIZATION_BPS / 100}% reached!`);
          break;
        }
      } catch (error) {
        this.logger.error(`Failed to borrow from credit line ${i}`, error);
        this.metrics.recordTx(false, 0n, 0n);
      }
    }

    this.metrics.setCustomMetric("totalBorrowed", formatUSDC(this.totalBorrowed));

    // Log final pool state
    const poolLiquidityAfter = await this.pool.availableLiquidity();
    const totalAssets = await this.pool.totalAssets();
    const finalUtilization = totalAssets > 0n 
      ? Number((totalAssets - poolLiquidityAfter) * 10000n / totalAssets)
      : 0;

    this.logger.success("🔥 STRESS TEST COMPLETE", {
      poolLiquidityBefore: formatUSDC(poolLiquidityBefore),
      poolLiquidityAfter: formatUSDC(poolLiquidityAfter),
      totalBorrowed: formatUSDC(this.totalBorrowed),
      finalUtilization: `${finalUtilization / 100}%`,
    });
  }

  async checkBorrowRate() {
    try {
      // Get pool stats
      const totalAssets = await this.pool.totalAssets();
      const availableLiquidity = await this.pool.availableLiquidity();
      
      const borrowed = totalAssets - availableLiquidity;
      const utilization = totalAssets > 0n ? Number((borrowed * 10000n) / totalAssets) : 0;

      // Estimate rate based on utilization
      let estimatedRate = 200; // 2% base
      if (utilization === 0) {
        estimatedRate = 200;
      } else if (utilization <= 8000) {
        estimatedRate = 200 + Math.floor((utilization / 8000) * 400);
      } else {
        const excessUtil = utilization - 8000;
        estimatedRate = 200 + 400 + Math.floor((excessUtil / 2000) * 6000);
      }

      this.logger.log("📊 Borrow Rate Check", {
        utilization: `${utilization / 100}%`,
        estimatedRate: `${estimatedRate / 100}%`,
        totalAssets: formatUSDC(totalAssets),
        borrowed: formatUSDC(borrowed),
        available: formatUSDC(availableLiquidity),
      });

      this.metrics.setCustomMetric("currentRate", estimatedRate);

      return estimatedRate;
    } catch (error) {
      this.logger.error("Failed to check borrow rate", error);
      return 0;
    }
  }

  async partialRepayAll() {
    this.logger.log("💰 Partially repaying all credit lines...");
    
    for (let i = 0; i < this.creditLines.length; i++) {
      try {
        const creditLine = this.creditLines[i];
        const debt = await creditLine.debt();
        
        if (debt === 0n) {
          this.logger.log(`Credit line ${i} has no debt`);
          continue;
        }

        // Repay 25% of debt
        const repayAmount = debt / 4n;
        
        this.logger.log(`Repaying ${formatUSDC(repayAmount)} to credit line ${i}...`);
        
        const approved = await approveUSDC(
          this.usdc, 
          await creditLine.getAddress(), 
          repayAmount, 
          this.logger
        );
        if (!approved) continue;

        const tx = await retryWithBackoff(async () => {
          return await creditLine.repay(repayAmount);
        });

        const receipt = await tx.wait();
        this.metrics.recordTx(true, receipt.gasUsed, receipt.gasUsed * receipt.gasPrice);

        this.logger.success(`Repaid to credit line ${i}`, {
          amount: formatUSDC(repayAmount),
          txHash: receipt.hash,
        });
      } catch (error) {
        this.logger.error(`Failed to repay credit line ${i}`, error);
        this.metrics.recordTx(false, 0n, 0n);
      }
    }
  }

  async stressLoop() {
    let cycleCount = 0;

    while (this.running) {
      try {
        cycleCount++;
        this.logger.log(`\n═══ STRESS CYCLE ${cycleCount} ═══\n`);

        // Step 1: Post bonds to all lines (if not already done)
        await this.postBonds();

        // Step 2: Max borrow all lines
        await this.maxBorrowAllLines();

        // Step 3: Check rate (should spike to ~66% at 100% util)
        await this.checkBorrowRate();

        // Step 4: Wait for metrics
        await sleep(60000); // 1 minute

        // Step 5: Partial repay to reduce utilization
        await this.partialRepayAll();

        // Step 6: Check rate again (should decrease)
        await this.checkBorrowRate();

        // Wait before next cycle
        this.logger.log(`\nWaiting ${STRESS_CYCLE_DELAY_MS / 1000}s before next stress cycle...`);
        await sleep(STRESS_CYCLE_DELAY_MS);
      } catch (error) {
        this.logger.error("Error in stress loop", error);
        await sleep(STRESS_CYCLE_DELAY_MS);
      }
    }
  }

  async shutdown() {
    this.logger.log("Shutting down...");
    this.running = false;

    // Try to repay all debts
    for (let i = 0; i < this.creditLines.length; i++) {
      try {
        const creditLine = this.creditLines[i];
        const debt = await creditLine.debt();
        
        if (debt === 0n) continue;

        const balance = await this.usdc.balanceOf(this.wallet.address);
        const repayAmount = balance < debt ? balance : debt;

        if (repayAmount > 0n) {
          this.logger.log(`Final repay to credit line ${i}: ${formatUSDC(repayAmount)}`);
          
          const approved = await approveUSDC(
            this.usdc, 
            await creditLine.getAddress(), 
            repayAmount, 
            this.logger
          );
          if (!approved) continue;

          const tx = await creditLine.repay(repayAmount);
          await tx.wait();
        }
      } catch (error) {
        this.logger.error(`Failed final repay to credit line ${i}`, error);
      }
    }

    // Final metrics
    const finalBalance = await this.usdc.balanceOf(this.wallet.address);
    const totalCost = this.initialBalance > finalBalance 
      ? this.initialBalance - finalBalance 
      : 0n;

    this.logger.log("Final summary", {
      initialBalance: formatUSDC(this.initialBalance),
      finalBalance: formatUSDC(finalBalance),
      totalBondsPosted: formatUSDC(this.totalBonds),
      totalBorrowed: formatUSDC(this.totalBorrowed),
      totalCost: formatUSDC(totalCost),
    });

    this.metrics.setCustomMetric("finalBalance", formatUSDC(finalBalance));
    this.metrics.setCustomMetric("totalCost", formatUSDC(totalCost));
  }
}

// Main execution
async function main() {
  const stressTester = new StressTester();

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down gracefully...");
    await stressTester.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down gracefully...");
    await stressTester.shutdown();
    process.exit(0);
  });

  await stressTester.start();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
