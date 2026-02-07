// arbitrage.ts - Arbitrage Agent
// Opens multiple credit lines, arbitrages rate differentials
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
  POOL_ABI,
} from "./shared-utils";

const BOND_PER_LINE = parseUSDC("5000"); // 5,000 USDC per line
const NUM_LINES = 3; // Open 3 credit lines
const MIN_RATE_DIFFERENTIAL_BPS = 100; // 1% minimum spread
const CHECK_INTERVAL_MS = 30000; // Check every 30 seconds
const BORROW_PERCENTAGE = 70; // Borrow 70% of credit limit

interface CreditLineState {
  index: number;
  address: string;
  bond: bigint;
  debt: bigint;
  creditLimit: bigint;
  availableToBorrow: bigint;
  borrowRate: number;
  utilization: number;
}

class ArbitrageAgent {
  private logger: AgentLogger;
  private metrics: MetricsCollector;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private usdc: ethers.Contract;
  private pool: ethers.Contract;
  private creditLines: ethers.Contract[];
  private initialBalance: bigint = 0n;
  private totalArbitrageProfit: bigint = 0n;
  private running: boolean = true;

  constructor() {
    this.logger = new AgentLogger("arbitrage");
    this.metrics = new MetricsCollector("arbitrage");
    
    const config = loadConfig("ARBITRAGE");
    
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    this.usdc = new ethers.Contract(config.usdcAddress, USDC_ABI, this.wallet);
    this.pool = new ethers.Contract(config.poolAddress, POOL_ABI, this.wallet);
    
    // In some deployments only 1 credit line is truly usable (pool can only register one).
    // For a compressed sim, we degrade gracefully and just reuse the first address.
    const want = NUM_LINES;
    const have = config.creditLineAddresses.length;
    const addresses = have >= want
      ? config.creditLineAddresses.slice(0, want)
      : Array.from({ length: want }, () => config.creditLineAddresses[0]);

    this.creditLines = addresses.map((address) => new ethers.Contract(address, CREDIT_LINE_ABI, this.wallet));

    this.logger.log("Arbitrage Agent initialized", {
      address: this.wallet.address,
      lines: want,
      creditLineAddresses: addresses,
      note: have >= want ? undefined : `Only ${have} credit line address(es) provided; reusing first for all ${want}.`,
    });
  }

  async start() {
    this.logger.log("🔄 Arbitrage Agent starting...");
    
    // Health check
    const healthy = await checkHealth(this.provider, this.logger);
    if (!healthy) {
      throw new Error("Health check failed");
    }

    // Record initial balance
    this.initialBalance = await this.usdc.balanceOf(this.wallet.address);
    this.logger.log(`Initial USDC balance: ${formatUSDC(this.initialBalance)}`);
    this.metrics.setCustomMetric("initialBalance", formatUSDC(this.initialBalance));

    // Open all credit lines
    await this.openCreditLines();

    // Wait for bonds to be processed
    await sleep(10000);

    // Start arbitrage loop
    await this.arbitrageLoop();
  }

  async openCreditLines() {
    this.logger.log(`Opening ${NUM_LINES} credit lines with ${formatUSDC(BOND_PER_LINE)} USDC each...`);

    for (let i = 0; i < this.creditLines.length; i++) {
      try {
        const creditLine = this.creditLines[i];
        const address = await creditLine.getAddress();

        this.logger.log(`Posting bond to credit line ${i + 1}/${NUM_LINES} at ${address}...`);

        // Approve
        const approved = await approveUSDC(
          this.usdc,
          address,
          BOND_PER_LINE,
          this.logger
        );
        if (!approved) continue;

        // Post bond
        const tx = await retryWithBackoff(async () => {
          return await creditLine.postBond(BOND_PER_LINE);
        });

        const receipt = await tx.wait();
        this.metrics.recordTx(true, receipt.gasUsed, receipt.gasUsed * receipt.gasPrice);

        const creditLimit = await creditLine.creditLimit();
        
        this.logger.success(`Opened credit line ${i + 1}/${NUM_LINES}`, {
          address,
          bond: formatUSDC(BOND_PER_LINE),
          creditLimit: formatUSDC(creditLimit),
          txHash: receipt.hash,
        });

        await sleep(3000); // Wait between each
      } catch (error) {
        this.logger.error(`Failed to open credit line ${i + 1}`, error);
        this.metrics.recordTx(false, 0n, 0n);
      }
    }

    this.metrics.setCustomMetric("creditLinesOpened", NUM_LINES);
  }

  async getCreditLineState(index: number): Promise<CreditLineState | null> {
    try {
      const creditLine = this.creditLines[index];
      const address = await creditLine.getAddress();
      const bond = await creditLine.bond();
      const debt = await creditLine.debt();
      const creditLimit = await creditLine.creditLimit();
      const availableToBorrow = await creditLine.availableToBorrow();
      const borrowRate = await creditLine.currentBorrowRate();
      const utilization = await creditLine.currentUtilization();

      return {
        index,
        address,
        bond,
        debt,
        creditLimit,
        availableToBorrow,
        borrowRate: Number(borrowRate),
        utilization: Number(utilization),
      };
    } catch (error) {
      this.logger.error(`Error getting state for line ${index}`, error);
      return null;
    }
  }

  async borrowFromLine(creditLine: ethers.Contract, amount: bigint): Promise<boolean> {
    try {
      const address = await creditLine.getAddress();
      this.logger.log(`Borrowing ${formatUSDC(amount)} USDC from ${address}...`);

      const beforeBalance = await this.usdc.balanceOf(this.wallet.address);

      const tx = await retryWithBackoff(async () => {
        return await creditLine.borrow(amount);
      });

      const receipt = await tx.wait();
      this.metrics.recordTx(true, receipt.gasUsed, receipt.gasUsed * receipt.gasPrice);

      const afterBalance = await this.usdc.balanceOf(this.wallet.address);
      const netReceived = afterBalance - beforeBalance;
      const fee = amount - netReceived;

      this.logger.success(`Borrowed ${formatUSDC(amount)} USDC`, {
        netReceived: formatUSDC(netReceived),
        fee: formatUSDC(fee),
        txHash: receipt.hash,
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to borrow", error);
      this.metrics.recordTx(false, 0n, 0n);
      return false;
    }
  }

  async repayToLine(creditLine: ethers.Contract, amount: bigint): Promise<boolean> {
    try {
      const address = await creditLine.getAddress();
      this.logger.log(`Repaying ${formatUSDC(amount)} USDC to ${address}...`);

      // Approve
      const approved = await approveUSDC(this.usdc, address, amount, this.logger);
      if (!approved) return false;

      const tx = await retryWithBackoff(async () => {
        return await creditLine.repay(amount);
      });

      const receipt = await tx.wait();
      this.metrics.recordTx(true, receipt.gasUsed, receipt.gasUsed * receipt.gasPrice);

      this.logger.success(`Repaid ${formatUSDC(amount)} USDC`, {
        txHash: receipt.hash,
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to repay", error);
      this.metrics.recordTx(false, 0n, 0n);
      return false;
    }
  }

  async depositToPool(amount: bigint): Promise<bigint> {
    try {
      this.logger.log(`Depositing ${formatUSDC(amount)} USDC to pool for yield...`);

      // Approve
      const approved = await approveUSDC(
        this.usdc,
        await this.pool.getAddress(),
        amount,
        this.logger
      );
      if (!approved) return 0n;

      const tx = await retryWithBackoff(async () => {
        return await this.pool.deposit(amount, this.wallet.address);
      });

      const receipt = await tx.wait();
      this.metrics.recordTx(true, receipt.gasUsed, receipt.gasUsed * receipt.gasPrice);

      const shares = await this.pool.balanceOf(this.wallet.address);

      this.logger.success(`Deposited ${formatUSDC(amount)} USDC to pool`, {
        shares: shares.toString(),
        txHash: receipt.hash,
      });

      return shares;
    } catch (error) {
      this.logger.error("Failed to deposit to pool", error);
      this.metrics.recordTx(false, 0n, 0n);
      return 0n;
    }
  }

  async arbitrageLoop() {
    let cycleCount = 0;

    while (this.running) {
      try {
        cycleCount++;
        this.logger.log(`Arbitrage cycle #${cycleCount}`);

        // Get all credit line states
        const states: CreditLineState[] = [];
        for (let i = 0; i < this.creditLines.length; i++) {
          const state = await this.getCreditLineState(i);
          if (state) {
            states.push(state);
          }
        }

        if (states.length === 0) {
          this.logger.warn("No credit line states available");
          await sleep(CHECK_INTERVAL_MS);
          continue;
        }

        // Log all states
        this.logger.log("Credit line states:");
        for (const state of states) {
          this.logger.log(`  Line ${state.index + 1}: ${state.address.slice(0, 10)}...`, {
            bond: formatUSDC(state.bond),
            debt: formatUSDC(state.debt),
            available: formatUSDC(state.availableToBorrow),
            rate: `${state.borrowRate} bps`,
            utilization: `${state.utilization / 100}%`,
          });
        }

        // Find lowest and highest rates
        const sorted = [...states].sort((a, b) => a.borrowRate - b.borrowRate);
        const lowestRateLine = sorted[0];
        const highestRateLine = sorted[sorted.length - 1];
        const rateDiff = highestRateLine.borrowRate - lowestRateLine.borrowRate;

        this.logger.log("Rate analysis", {
          lowestRate: `${lowestRateLine.borrowRate} bps`,
          highestRate: `${highestRateLine.borrowRate} bps`,
          differential: `${rateDiff} bps`,
        });

        // Arbitrage if differential is profitable
        if (rateDiff >= MIN_RATE_DIFFERENTIAL_BPS && lowestRateLine.availableToBorrow > 0n) {
          this.logger.log(`Profitable arbitrage opportunity detected! (${rateDiff} bps spread)`);

          // Borrow from lowest rate line
          const borrowAmount = (lowestRateLine.availableToBorrow * BigInt(BORROW_PERCENTAGE)) / 100n;
          const borrowed = await this.borrowFromLine(this.creditLines[lowestRateLine.index], borrowAmount);

          if (borrowed) {
            await sleep(5000);

            // Deposit to pool for yield
            const balance = await this.usdc.balanceOf(this.wallet.address);
            if (balance > 0n) {
              await this.depositToPool(balance);
            }

            // Track arbitrage
            this.metrics.setCustomMetric("lastArbitrageDiff", rateDiff);
            this.metrics.setCustomMetric("arbitrageOpportunities", cycleCount);
          }
        } else {
          this.logger.log("No profitable arbitrage opportunities");
        }

        this.metrics.setCustomMetric("cycleCount", cycleCount);

        await sleep(CHECK_INTERVAL_MS);
      } catch (error) {
        this.logger.error("Error in arbitrage loop", error);
        await sleep(CHECK_INTERVAL_MS * 2);
      }
    }
  }

  async shutdown() {
    this.logger.log("Shutting down...");
    this.running = false;

    // Repay all debts
    for (let i = 0; i < this.creditLines.length; i++) {
      try {
        const state = await this.getCreditLineState(i);
        if (state && state.debt > 0n) {
          this.logger.log(`Repaying debt on line ${i + 1}...`);
          await this.repayToLine(this.creditLines[i], state.debt);
        }
      } catch (error) {
        this.logger.error(`Failed to repay line ${i + 1} on shutdown`, error);
      }
    }

    // Withdraw from pool
    try {
      const shares = await this.pool.balanceOf(this.wallet.address);
      if (shares > 0n) {
        this.logger.log("Withdrawing from pool...");
        const tx = await this.pool.redeem(shares, this.wallet.address, this.wallet.address);
        await tx.wait();
      }
    } catch (error) {
      this.logger.error("Failed to withdraw from pool", error);
    }

    // Final summary
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
  const arbitrage = new ArbitrageAgent();

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down gracefully...");
    await arbitrage.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down gracefully...");
    await arbitrage.shutdown();
    process.exit(0);
  });

  await arbitrage.start();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
