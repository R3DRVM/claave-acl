// risky-borrower.ts - Risk-Taking Borrower Agent
// Deposits minimum bond, borrows max, simulates losses, gets liquidated
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
  CREDIT_LINE_ABI,
} from "./shared-utils";

const BOND_AMOUNT = parseUSDC("1000"); // Minimum bond: 1,000 USDC
const BORROW_PERCENTAGE = 80; // Borrow 80% of credit limit
const LOSS_SIMULATION_PERCENTAGE = 40; // Burn 40% of borrowed funds
const HEALTH_CHECK_INTERVAL_MS = 15000; // Check health every 15 seconds

class RiskyBorrower {
  private logger: AgentLogger;
  private metrics: MetricsCollector;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private usdc: ethers.Contract;
  private creditLine: ethers.Contract;
  private initialBalance: bigint = 0n;
  private running: boolean = true;
  private liquidated: boolean = false;

  constructor() {
    this.logger = new AgentLogger("risky-borrower");
    this.metrics = new MetricsCollector("risky-borrower");
    
    const config = loadConfig("RISKY_BORROWER");
    
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    this.usdc = new ethers.Contract(config.usdcAddress, USDC_ABI, this.wallet);
    
    // In test deployments we may only have 1 fully-configured credit line.
    // Prefer a non-primary credit line if present; otherwise fall back to the first.
    const idx = config.creditLineAddresses.length >= 2 ? 1 : 0;
    const chosen = config.creditLineAddresses[idx];

    this.creditLine = new ethers.Contract(chosen, CREDIT_LINE_ABI, this.wallet);

    this.logger.log("Risk-Taking Borrower initialized", {
      address: this.wallet.address,
      creditLineAddress: chosen,
    });
  }

  async start() {
    this.logger.log("🎲 Risk-Taking Borrower starting...");
    
    // Health check
    const healthy = await checkHealth(this.provider, this.logger);
    if (!healthy) {
      throw new Error("Health check failed");
    }

    // Record initial balance
    this.initialBalance = await this.usdc.balanceOf(this.wallet.address);
    this.logger.log(`Initial USDC balance: ${formatUSDC(this.initialBalance)}`);
    this.metrics.setCustomMetric("initialBalance", formatUSDC(this.initialBalance));

    // Post minimal bond
    await this.postBond();

    // Wait for bond to be processed
    await sleep(5000);

    // Link strategy (send borrowed funds to this wallet as the strategy)
    const clAddr = await this.creditLine.getAddress();
    await linkStrategy(clAddr, this.wallet, this.creditLine, this.wallet.address, this.logger);

    // Borrow near maximum
    await this.borrowMaximum();

    // Simulate trading losses
    await this.simulateLosses();

    // Monitor health until liquidation
    await this.monitorHealth();
  }

  async postBond() {
    try {
      this.logger.log(`Posting minimal bond of ${formatUSDC(BOND_AMOUNT)} USDC...`);

      const balance = await this.usdc.balanceOf(this.wallet.address);
      if (balance < BOND_AMOUNT) {
        throw new Error(`Insufficient balance: ${formatUSDC(balance)}`);
      }

      // Approve credit line
      const approved = await approveUSDC(
        this.usdc,
        await this.creditLine.getAddress(),
        BOND_AMOUNT,
        this.logger
      );
      if (!approved) throw new Error("Failed to approve USDC");

      // Post bond
      const tx = await retryWithBackoff(async () => {
        return await this.creditLine.postBond(BOND_AMOUNT);
      });

      const receipt = await tx.wait();
      this.metrics.recordTx(true, receipt.gasUsed, receipt.gasUsed * receipt.gasPrice);

      // Check credit limit
      const creditLimit = await this.creditLine.creditLimit();
      
      this.logger.success(`Posted minimal bond of ${formatUSDC(BOND_AMOUNT)} USDC`, {
        creditLimit: formatUSDC(creditLimit),
        txHash: receipt.hash,
      });

      this.metrics.setCustomMetric("bondPosted", formatUSDC(BOND_AMOUNT));
      this.metrics.setCustomMetric("creditLimit", formatUSDC(creditLimit));
    } catch (error) {
      this.logger.error("Failed to post bond", error);
      this.metrics.recordTx(false, 0n, 0n);
      throw error;
    }
  }

  async borrowMaximum() {
    try {
      const availableToBorrow = await this.creditLine.availableToBorrow();
      const borrowAmount = (availableToBorrow * BigInt(BORROW_PERCENTAGE)) / 100n;

      this.logger.log(`Borrowing ${BORROW_PERCENTAGE}% of credit limit: ${formatUSDC(borrowAmount)} USDC...`);

      const beforeBalance = await this.usdc.balanceOf(this.wallet.address);

      const tx = await retryWithBackoff(async () => {
        return await this.creditLine.borrow(borrowAmount);
      });

      const receipt = await tx.wait();
      this.metrics.recordTx(true, receipt.gasUsed, receipt.gasUsed * receipt.gasPrice);

      const afterBalance = await this.usdc.balanceOf(this.wallet.address);
      const netReceived = afterBalance - beforeBalance;
      const fee = borrowAmount - netReceived;

      // Check health factor
      const healthFactor = await this.creditLine.healthFactor();
      const healthFactorPercent = Number(healthFactor) / 1e18 * 100;

      this.logger.success(`Borrowed ${formatUSDC(borrowAmount)} USDC`, {
        netReceived: formatUSDC(netReceived),
        fee: formatUSDC(fee),
        healthFactor: healthFactorPercent.toFixed(2) + "%",
        txHash: receipt.hash,
      });

      this.metrics.setCustomMetric("borrowed", formatUSDC(borrowAmount));
      this.metrics.setCustomMetric("initialHealthFactor", healthFactorPercent.toFixed(2));
    } catch (error) {
      this.logger.error("Failed to borrow", error);
      this.metrics.recordTx(false, 0n, 0n);
      throw error;
    }
  }

  async simulateLosses() {
    try {
      const balance = await this.usdc.balanceOf(this.wallet.address);
      const lossAmount = (balance * BigInt(LOSS_SIMULATION_PERCENTAGE)) / 100n;

      this.logger.warn(`Simulating trading losses by burning ${formatUSDC(lossAmount)} USDC...`);

      // "Burn" USDC by sending to zero address (simulates trading loss)
      const tx = await this.usdc.transfer(ethers.ZeroAddress, lossAmount);
      const receipt = await tx.wait();

      const afterBalance = await this.usdc.balanceOf(this.wallet.address);
      const healthFactor = await this.creditLine.healthFactor();
      const healthFactorPercent = Number(healthFactor) / 1e18 * 100;

      this.logger.warn(`Simulated loss of ${formatUSDC(lossAmount)} USDC`, {
        remainingBalance: formatUSDC(afterBalance),
        healthFactor: healthFactorPercent.toFixed(2) + "%",
        txHash: receipt.hash,
      });

      this.metrics.setCustomMetric("lossesSimulated", formatUSDC(lossAmount));
      this.metrics.setCustomMetric("healthFactorAfterLoss", healthFactorPercent.toFixed(2));
    } catch (error) {
      this.logger.error("Failed to simulate losses", error);
    }
  }

  async attemptBorrowWhenUnhealthy() {
    try {
      this.logger.log("Attempting to borrow when unhealthy (expect revert)...");

      const availableToBorrow = await this.creditLine.availableToBorrow();
      
      if (availableToBorrow === 0n) {
        this.logger.success("Available to borrow is 0 (correct behavior)");
        this.metrics.setCustomMetric("unhealthyBorrowBlocked", true);
        return;
      }

      // Try to borrow anyway
      try {
        const tx = await this.creditLine.borrow(availableToBorrow);
        await tx.wait();
        
        this.logger.error("CRITICAL: Unhealthy borrow succeeded (should have failed!)", {
          amount: formatUSDC(availableToBorrow),
        });
        this.metrics.setCustomMetric("unhealthyBorrowBug", true);
      } catch (revertError: any) {
        this.logger.success("Unhealthy borrow correctly reverted", {
          error: revertError.message,
        });
        this.metrics.setCustomMetric("unhealthyBorrowBlocked", true);
      }
    } catch (error) {
      this.logger.error("Error in unhealthy borrow test", error);
    }
  }

  async monitorHealth() {
    this.logger.log("Monitoring health factor until liquidation...");

    while (this.running && !this.liquidated) {
      try {
        const bond = await this.creditLine.bond();
        const debt = await this.creditLine.debt();
        const healthFactor = await this.creditLine.healthFactor();
        const healthFactorPercent = (Number(healthFactor) / 1e18) * 100;
        const isLiquidatable = await this.creditLine.isLiquidatable();

        this.logger.log("Health check", {
          bond: formatUSDC(bond),
          debt: formatUSDC(debt),
          healthFactor: healthFactorPercent.toFixed(2) + "%",
          isLiquidatable,
        });

        this.metrics.setCustomMetric("currentHealthFactor", healthFactorPercent.toFixed(2));
        this.metrics.setCustomMetric("isLiquidatable", isLiquidatable);

        // If health factor < 150%, try to borrow (should fail)
        if (healthFactorPercent < 150) {
          await this.attemptBorrowWhenUnhealthy();
        }

        // If liquidatable, wait for liquidator
        if (isLiquidatable) {
          this.logger.warn("⚠️ Position is now liquidatable! Waiting for liquidator...");
          this.metrics.setCustomMetric("liquidatable", true);
          
          // Wait for liquidation event
          await this.waitForLiquidation();
          break;
        }

        await sleep(HEALTH_CHECK_INTERVAL_MS);
      } catch (error) {
        this.logger.error("Error monitoring health", error);
        await sleep(HEALTH_CHECK_INTERVAL_MS * 2);
      }
    }
  }

  async waitForLiquidation() {
    this.logger.log("Waiting for liquidation event...");
    
    const startTime = Date.now();
    const maxWaitTime = 300000; // 5 minutes max

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const bondBefore = await this.creditLine.bond();
        const debtBefore = await this.creditLine.debt();

        await sleep(10000); // Check every 10 seconds

        const bondAfter = await this.creditLine.bond();
        const debtAfter = await this.creditLine.debt();

        // Check if bond was slashed or debt reduced (liquidation occurred)
        if (bondAfter < bondBefore || debtAfter < debtBefore) {
          this.liquidated = true;
          const liquidationTime = (Date.now() - startTime) / 1000;

          this.logger.warn("🔨 LIQUIDATED!", {
            bondBefore: formatUSDC(bondBefore),
            bondAfter: formatUSDC(bondAfter),
            slashed: formatUSDC(bondBefore - bondAfter),
            debtBefore: formatUSDC(debtBefore),
            debtAfter: formatUSDC(debtAfter),
            liquidationTimeSeconds: liquidationTime,
          });

          this.metrics.setCustomMetric("liquidated", true);
          this.metrics.setCustomMetric("liquidationTime", liquidationTime);
          this.metrics.setCustomMetric("bondSlashed", formatUSDC(bondBefore - bondAfter));
          break;
        }
      } catch (error) {
        this.logger.error("Error waiting for liquidation", error);
      }
    }

    if (!this.liquidated) {
      this.logger.error("Liquidation timeout - no liquidator acted within 5 minutes");
      this.metrics.setCustomMetric("liquidationTimeout", true);
    }
  }

  async shutdown() {
    this.logger.log("Shutting down...");
    this.running = false;

    // Final summary
    const finalBalance = await this.usdc.balanceOf(this.wallet.address);
    const totalLoss = this.initialBalance > finalBalance
      ? this.initialBalance - finalBalance
      : 0n;

    this.logger.log("Final summary", {
      initialBalance: formatUSDC(this.initialBalance),
      finalBalance: formatUSDC(finalBalance),
      totalLoss: formatUSDC(totalLoss),
      liquidated: this.liquidated,
    });

    this.metrics.setCustomMetric("finalBalance", formatUSDC(finalBalance));
    this.metrics.setCustomMetric("totalLoss", formatUSDC(totalLoss));
  }
}

// Main execution
async function main() {
  const riskyBorrower = new RiskyBorrower();

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down gracefully...");
    await riskyBorrower.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down gracefully...");
    await riskyBorrower.shutdown();
    process.exit(0);
  });

  await riskyBorrower.start();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
