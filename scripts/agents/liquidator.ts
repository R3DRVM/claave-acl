// liquidator.ts - Keeper/Liquidator Bot
// Monitors all credit lines, liquidates unhealthy positions, tracks profits
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
  CREDIT_LINE_ABI,
} from "./shared-utils";

const CHECK_INTERVAL_MS = 15000; // Check every 15 seconds (5 blocks)
const MIN_PROFIT_USDC = parseUSDC("1"); // Only liquidate if profit > $1

interface PositionInfo {
  address: string;
  bond: bigint;
  debt: bigint;
  healthFactor: bigint;
  isLiquidatable: boolean;
}

class LiquidatorBot {
  private logger: AgentLogger;
  private metrics: MetricsCollector;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private usdc: ethers.Contract;
  private creditLines: ethers.Contract[];
  private initialBalance: bigint = 0n;
  private totalBonusEarned: bigint = 0n;
  private liquidationCount: number = 0;
  private running: boolean = true;

  constructor() {
    this.logger = new AgentLogger("liquidator");
    this.metrics = new MetricsCollector("liquidator");
    
    const config = loadConfig("LIQUIDATOR");
    
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    this.usdc = new ethers.Contract(config.usdcAddress, USDC_ABI, this.wallet);
    
    // Monitor all 5 credit lines
    if (config.creditLineAddresses.length === 0) {
      throw new Error("No credit line addresses configured");
    }
    
    this.creditLines = config.creditLineAddresses.map(
      (address) => new ethers.Contract(address, CREDIT_LINE_ABI, this.wallet)
    );
    
    this.logger.log("Liquidator Bot initialized", {
      address: this.wallet.address,
      monitoringLines: config.creditLineAddresses.length,
      creditLineAddresses: config.creditLineAddresses,
    });
  }

  async start() {
    this.logger.log("🔨 Liquidator Bot starting...");
    
    // Health check
    const healthy = await checkHealth(this.provider, this.logger);
    if (!healthy) {
      throw new Error("Health check failed");
    }

    // Record initial balance
    this.initialBalance = await this.usdc.balanceOf(this.wallet.address);
    this.logger.log(`Initial USDC balance: ${formatUSDC(this.initialBalance)}`);
    this.metrics.setCustomMetric("initialBalance", formatUSDC(this.initialBalance));
    this.metrics.setCustomMetric("monitoringCreditLines", this.creditLines.length);

    // Start monitoring loop
    await this.monitorLoop();
  }

  async checkPosition(creditLine: ethers.Contract, index: number): Promise<PositionInfo | null> {
    try {
      const address = await creditLine.getAddress();
      const bond = await creditLine.bond();
      const debt = await creditLine.debt();

      // Skip if no debt
      if (debt === 0n) {
        return null;
      }

      const healthFactor = await creditLine.healthFactor();
      const isLiquidatable = await creditLine.isLiquidatable();

      return {
        address,
        bond,
        debt,
        healthFactor,
        isLiquidatable,
      };
    } catch (error) {
      this.logger.error(`Error checking position ${index}`, error);
      return null;
    }
  }

  async liquidatePosition(creditLine: ethers.Contract, position: PositionInfo) {
    try {
      this.logger.warn(`Liquidating position at ${position.address}...`, {
        bond: formatUSDC(position.bond),
        debt: formatUSDC(position.debt),
        healthFactor: (Number(position.healthFactor) / 1e18 * 100).toFixed(2) + "%",
      });

      // Calculate expected bonus (5% of slashed amount)
      const slashAmount = position.debt < position.bond ? position.debt : position.bond;
      const expectedBonus = (slashAmount * 500n) / 10000n; // 5%

      // Only liquidate if bonus is worth it
      if (expectedBonus < MIN_PROFIT_USDC) {
        this.logger.warn("Liquidation bonus too small, skipping", {
          expectedBonus: formatUSDC(expectedBonus),
          minimum: formatUSDC(MIN_PROFIT_USDC),
        });
        return;
      }

      const beforeBalance = await this.usdc.balanceOf(this.wallet.address);
      const startTime = Date.now();

      // Execute liquidation
      const tx = await retryWithBackoff(async () => {
        return await creditLine.slashBond(slashAmount);
      });

      const receipt = await tx.wait();
      const liquidationTime = (Date.now() - startTime) / 1000;

      this.metrics.recordTx(true, receipt.gasUsed, receipt.gasUsed * receipt.gasPrice);

      const afterBalance = await this.usdc.balanceOf(this.wallet.address);
      const actualBonus = afterBalance - beforeBalance;

      this.totalBonusEarned += actualBonus;
      this.liquidationCount++;

      this.logger.success(`Liquidated position at ${position.address}`, {
        slashedAmount: formatUSDC(slashAmount),
        bonusReceived: formatUSDC(actualBonus),
        expectedBonus: formatUSDC(expectedBonus),
        liquidationTimeSeconds: liquidationTime.toFixed(2),
        gasUsed: receipt.gasUsed.toString(),
        txHash: receipt.hash,
      });

      this.metrics.setCustomMetric("totalBonusEarned", formatUSDC(this.totalBonusEarned));
      this.metrics.setCustomMetric("liquidationCount", this.liquidationCount);
      this.metrics.setCustomMetric("averageLiquidationTime", liquidationTime.toFixed(2));

      // Verify pool received correct amount
      await this.verifyPoolReceived(slashAmount, actualBonus);
    } catch (error: any) {
      this.logger.error("Failed to liquidate position", error);
      this.metrics.recordTx(false, 0n, 0n);
      
      // Check if already liquidated by someone else
      if (error.message && error.message.includes("NotSlashable")) {
        this.logger.warn("Position already liquidated by another keeper");
        this.metrics.setCustomMetric("missedLiquidations", 
          (this.metrics.getMetrics().customMetrics.missedLiquidations || 0) + 1
        );
      }
    }
  }

  async verifyPoolReceived(slashedAmount: bigint, bonusReceived: bigint) {
    try {
      // Pool should receive slashedAmount - bonusReceived
      const poolReceived = slashedAmount - bonusReceived;
      const bonusPercentage = Number(bonusReceived * 10000n / slashedAmount) / 100;

      this.logger.log("Liquidation split verification", {
        totalSlashed: formatUSDC(slashedAmount),
        toPool: formatUSDC(poolReceived),
        toLiquidator: formatUSDC(bonusReceived),
        bonusPercentage: bonusPercentage.toFixed(2) + "%",
      });

      // Verify 5% bonus
      if (bonusPercentage < 4.9 || bonusPercentage > 5.1) {
        this.logger.error("Bonus percentage incorrect!", {
          expected: "5%",
          actual: bonusPercentage.toFixed(2) + "%",
        });
        this.metrics.setCustomMetric("incorrectBonusDetected", true);
      } else {
        this.metrics.setCustomMetric("bonusVerified", true);
      }
    } catch (error) {
      this.logger.error("Failed to verify pool received amount", error);
    }
  }

  async monitorLoop() {
    let checkCount = 0;

    while (this.running) {
      try {
        checkCount++;
        const currentBlock = await this.provider.getBlockNumber();
        
        this.logger.log(`Health check #${checkCount} at block ${currentBlock}`);

        const positions: PositionInfo[] = [];

        // Check all credit lines
        for (let i = 0; i < this.creditLines.length; i++) {
          const position = await this.checkPosition(this.creditLines[i], i);
          if (position) {
            positions.push(position);
          }
        }

        if (positions.length > 0) {
          this.logger.log(`Found ${positions.length} active positions`);

          // Sort by health factor (lowest first)
          positions.sort((a, b) => 
            Number(a.healthFactor - b.healthFactor)
          );

          // Log all positions
          for (const pos of positions) {
            this.logger.log(`Position ${pos.address.slice(0, 10)}...`, {
              bond: formatUSDC(pos.bond),
              debt: formatUSDC(pos.debt),
              healthFactor: (Number(pos.healthFactor) / 1e18 * 100).toFixed(2) + "%",
              liquidatable: pos.isLiquidatable,
            });
          }

          // Liquidate unhealthy positions
          for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];
            if (pos.isLiquidatable) {
              await this.liquidatePosition(this.creditLines[i], pos);
              await sleep(5000); // Wait between liquidations
            }
          }
        } else {
          this.logger.log("No active positions to monitor");
        }

        this.metrics.setCustomMetric("totalChecks", checkCount);
        this.metrics.setCustomMetric("activePositions", positions.length);

        await sleep(CHECK_INTERVAL_MS);
      } catch (error) {
        this.logger.error("Error in monitor loop", error);
        await sleep(CHECK_INTERVAL_MS * 2);
      }
    }
  }

  async shutdown() {
    this.logger.log("Shutting down...");
    this.running = false;

    // Final summary
    const finalBalance = await this.usdc.balanceOf(this.wallet.address);
    const totalProfit = finalBalance > this.initialBalance
      ? finalBalance - this.initialBalance
      : 0n;

    this.logger.log("Final summary", {
      initialBalance: formatUSDC(this.initialBalance),
      finalBalance: formatUSDC(finalBalance),
      totalBonusEarned: formatUSDC(this.totalBonusEarned),
      totalProfit: formatUSDC(totalProfit),
      liquidationCount: this.liquidationCount,
      profitPerLiquidation: this.liquidationCount > 0 
        ? formatUSDC(totalProfit / BigInt(this.liquidationCount))
        : "0",
    });

    this.metrics.setCustomMetric("finalBalance", formatUSDC(finalBalance));
    this.metrics.setCustomMetric("totalProfit", formatUSDC(totalProfit));
  }
}

// Main execution
async function main() {
  const liquidator = new LiquidatorBot();

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down gracefully...");
    await liquidator.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down gracefully...");
    await liquidator.shutdown();
    process.exit(0);
  });

  await liquidator.start();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
