// borrower.ts - Aggressive Borrower Agent
// Posts bond, borrows maximum, tests limits, tracks costs
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

const BOND_AMOUNT = parseUSDC("10000"); // 10,000 USDC
const BORROW_PERCENTAGE = 90; // Borrow 90% of credit limit
const CYCLE_DELAY_MS = 60000; // 1 minute between cycles
const PARTIAL_REPAY_PERCENTAGE = 50; // Repay 50% of debt

class AggressiveBorrower {
  private logger: AgentLogger;
  private metrics: MetricsCollector;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private usdc: ethers.Contract;
  private creditLine: ethers.Contract;
  private initialBalance: bigint = 0n;
  private totalFeesPaid: bigint = 0n;
  private running: boolean = true;
  private cycleCount: number = 0;

  constructor() {
    this.logger = new AgentLogger("borrower");
    this.metrics = new MetricsCollector("borrower");
    
    const config = loadConfig("BORROWER");
    
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    this.usdc = new ethers.Contract(config.usdcAddress, USDC_ABI, this.wallet);
    
    // Use first credit line
    if (config.creditLineAddresses.length === 0) {
      throw new Error("No credit line address configured");
    }
    this.creditLine = new ethers.Contract(
      config.creditLineAddresses[0],
      CREDIT_LINE_ABI,
      this.wallet
    );
    
    this.logger.log("Aggressive Borrower initialized", {
      address: this.wallet.address,
      creditLineAddress: config.creditLineAddresses[0],
    });
  }

  async start() {
    this.logger.log("📈 Aggressive Borrower starting...");
    
    // Health check
    const healthy = await checkHealth(this.provider, this.logger);
    if (!healthy) {
      throw new Error("Health check failed");
    }

    // Record initial balance
    this.initialBalance = await this.usdc.balanceOf(this.wallet.address);
    this.logger.log(`Initial USDC balance: ${formatUSDC(this.initialBalance)}`);
    this.metrics.setCustomMetric("initialBalance", formatUSDC(this.initialBalance));

    // Post bond
    await this.postBond();

    // Wait for bond to be processed
    await sleep(5000);

    // Link strategy (send borrowed funds to this wallet as the strategy)
    const clAddr = await this.creditLine.getAddress();
    await linkStrategy(clAddr, this.wallet, this.creditLine, this.wallet.address, this.logger);

    // Start borrow cycles
    await this.borrowCycles();
  }

  async postBond() {
    try {
      this.logger.log(`Posting bond of ${formatUSDC(BOND_AMOUNT)} USDC...`);

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
      
      this.logger.success(`Posted bond of ${formatUSDC(BOND_AMOUNT)} USDC`, {
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

  async borrow(amount: bigint) {
    try {
      this.logger.log(`Attempting to borrow ${formatUSDC(amount)} USDC...`);

      const availableToBorrow = await this.creditLine.availableToBorrow();
      if (amount > availableToBorrow) {
        this.logger.warn("Borrow amount exceeds available", {
          requested: formatUSDC(amount),
          available: formatUSDC(availableToBorrow),
        });
        return false;
      }

      const beforeBalance = await this.usdc.balanceOf(this.wallet.address);

      const tx = await retryWithBackoff(async () => {
        return await this.creditLine.borrow(amount);
      });

      const receipt = await tx.wait();
      this.metrics.recordTx(true, receipt.gasUsed, receipt.gasUsed * receipt.gasPrice);

      const afterBalance = await this.usdc.balanceOf(this.wallet.address);
      const netReceived = afterBalance - beforeBalance;
      const fee = amount - netReceived;

      this.totalFeesPaid += fee;

      this.logger.success(`Borrowed ${formatUSDC(amount)} USDC`, {
        netReceived: formatUSDC(netReceived),
        fee: formatUSDC(fee),
        feePercentage: ((Number(fee) / Number(amount)) * 100).toFixed(4),
        txHash: receipt.hash,
      });

      this.metrics.setCustomMetric("totalFeesPaid", formatUSDC(this.totalFeesPaid));
      return true;
    } catch (error) {
      this.logger.error("Failed to borrow", error);
      this.metrics.recordTx(false, 0n, 0n);
      return false;
    }
  }

  async attemptOverBorrow() {
    try {
      this.logger.log("Attempting to over-borrow (expect revert)...");

      const creditLimit = await this.creditLine.creditLimit();
      const debt = await this.creditLine.debt();
      const availableToBorrow = await this.creditLine.availableToBorrow();

      // Try to borrow 150% of available
      const overBorrowAmount = (availableToBorrow * 150n) / 100n;

      // If nothing is available, an "over-borrow" is meaningless (and may be 0).
      if (availableToBorrow === 0n || overBorrowAmount === 0n) {
        this.logger.log("Skipping over-borrow test (no available capacity)", {
          creditLimit: formatUSDC(creditLimit),
          currentDebt: formatUSDC(debt),
          availableToBorrow: formatUSDC(availableToBorrow),
        });
        this.metrics.setCustomMetric("overBorrowSkipped", true);
        return;
      }

      this.logger.log("Over-borrow attempt", {
        creditLimit: formatUSDC(creditLimit),
        currentDebt: formatUSDC(debt),
        availableToBorrow: formatUSDC(availableToBorrow),
        attemptingToBorrow: formatUSDC(overBorrowAmount),
      });

      try {
        const tx = await this.creditLine.borrow(overBorrowAmount);
        await tx.wait();

        this.logger.error("CRITICAL: Over-borrow succeeded (should have failed!)", {
          amount: formatUSDC(overBorrowAmount),
        });
        this.metrics.setCustomMetric("overBorrowBug", true);
      } catch (revertError: any) {
        this.logger.success("Over-borrow correctly reverted", {
          error: revertError.message,
        });
        this.metrics.setCustomMetric("overBorrowRevertsCorrectly", true);
      }
    } catch (error) {
      this.logger.error("Error in over-borrow test", error);
    }
  }

  async repay(amount: bigint) {
    try {
      this.logger.log(`Repaying ${formatUSDC(amount)} USDC...`);

      const balance = await this.usdc.balanceOf(this.wallet.address);
      if (balance < amount) {
        this.logger.warn("Insufficient balance for repayment", {
          balance: formatUSDC(balance),
          needed: formatUSDC(amount),
        });
        return false;
      }

      // Approve credit line
      const approved = await approveUSDC(
        this.usdc,
        await this.creditLine.getAddress(),
        amount,
        this.logger
      );
      if (!approved) return false;

      const tx = await retryWithBackoff(async () => {
        return await this.creditLine.repay(amount);
      });

      const receipt = await tx.wait();
      this.metrics.recordTx(true, receipt.gasUsed, receipt.gasUsed * receipt.gasPrice);

      const remainingDebt = await this.creditLine.debt();

      this.logger.success(`Repaid ${formatUSDC(amount)} USDC`, {
        remainingDebt: formatUSDC(remainingDebt),
        txHash: receipt.hash,
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to repay", error);
      this.metrics.recordTx(false, 0n, 0n);
      return false;
    }
  }

  async borrowCycles() {
    while (this.running) {
      try {
        this.cycleCount++;
        this.logger.log(`Starting borrow cycle #${this.cycleCount}`);

        // Get current state (minimal getters)
        const bond = await this.creditLine.bond();
        const debt = await this.creditLine.debt();
        const availableToBorrow = await this.creditLine.availableToBorrow();
        const borrowRate = await this.creditLine.currentBorrowRate();
        const utilization = await this.creditLine.currentUtilization();

        this.logger.log("Credit line state", {
          bond: formatUSDC(bond),
          debt: formatUSDC(debt),
          availableToBorrow: formatUSDC(availableToBorrow),
          borrowRate: `${borrowRate} bps`,
          utilization: `${Number(utilization) / 100}%`,
        });

        // Borrow maximum available
        if (availableToBorrow > 0n) {
          const borrowAmount = (availableToBorrow * BigInt(BORROW_PERCENTAGE)) / 100n;
          await this.borrow(borrowAmount);

          // Wait a bit
          await sleep(10000);

          // Test over-borrow
          await this.attemptOverBorrow();

          // Wait
          await sleep(10000);

          // Partial repayment
          const currentDebt = await this.creditLine.debt();
          if (currentDebt > 0n) {
            const repayAmount = (currentDebt * BigInt(PARTIAL_REPAY_PERCENTAGE)) / 100n;
            await this.repay(repayAmount);
          }
        }

        // Calculate effective borrowing cost
        const effectiveCost = this.totalFeesPaid > 0n
          ? ((Number(this.totalFeesPaid) / Number(this.initialBalance)) * 100).toFixed(4)
          : "0";

        this.logger.log(`Cycle #${this.cycleCount} complete`, {
          totalFeesPaid: formatUSDC(this.totalFeesPaid),
          effectiveCost: `${effectiveCost}%`,
        });

        this.metrics.setCustomMetric("cycleCount", this.cycleCount);
        this.metrics.setCustomMetric("effectiveBorrowingCost", effectiveCost);

        // Wait before next cycle
        await sleep(CYCLE_DELAY_MS);
      } catch (error) {
        this.logger.error("Error in borrow cycle", error);
        await sleep(CYCLE_DELAY_MS * 2);
      }
    }
  }

  async shutdown() {
    this.logger.log("Shutting down...");
    this.running = false;

    // Repay all debt
    try {
      const debt = await this.creditLine.debt();
      if (debt > 0n) {
        this.logger.log(`Repaying remaining debt: ${formatUSDC(debt)}`);
        await this.repay(debt);
      }
    } catch (error) {
      this.logger.error("Failed to repay on shutdown", error);
    }

    // Final summary
    const finalBalance = await this.usdc.balanceOf(this.wallet.address);
    const totalCost = this.initialBalance > finalBalance
      ? this.initialBalance - finalBalance
      : 0n;

    this.logger.log("Final summary", {
      initialBalance: formatUSDC(this.initialBalance),
      finalBalance: formatUSDC(finalBalance),
      totalFeesPaid: formatUSDC(this.totalFeesPaid),
      totalCost: formatUSDC(totalCost),
      cyclesCompleted: this.cycleCount,
    });

    this.metrics.setCustomMetric("finalBalance", formatUSDC(finalBalance));
  }
}

// Main execution
async function main() {
  const borrower = new AggressiveBorrower();

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down gracefully...");
    await borrower.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down gracefully...");
    await borrower.shutdown();
    process.exit(0);
  });

  await borrower.start();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
