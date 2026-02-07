// preflight-check.ts - Verify setup before running agents
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

const results: CheckResult[] = [];

function check(name: string, passed: boolean, message: string) {
  results.push({ name, passed, message });
  const icon = passed ? "✅" : "❌";
  console.log(`${icon} ${name}: ${message}`);
}

async function main() {
  console.log("🔍 Klaave V2 Agent Testing - Pre-flight Check\n");

  // 1. Check environment variables
  console.log("1. Checking environment variables...");
  
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL;
  check("RPC URL", !!rpcUrl, rpcUrl || "Not set");

  const usdcAddress = process.env.USDC_ADDRESS;
  check("USDC Address", !!usdcAddress && usdcAddress !== "0x0000000000000000000000000000000000000000", 
    usdcAddress || "Not set");

  const poolAddress = process.env.POOL_ADDRESS;
  check("Pool Address", !!poolAddress && poolAddress !== "0x0000000000000000000000000000000000000000",
    poolAddress || "Not set");

  const creditLineAddresses = process.env.CREDIT_LINE_ADDRESSES?.split(",") || [];
  // For our compressed 2-hour simulation, 1 credit line is sufficient.
  check("Credit Lines", creditLineAddresses.length >= 1,
    `${creditLineAddresses.length} configured`);

  const privateKeys = [
    process.env.LENDER_PRIVATE_KEY,
    process.env.BORROWER_PRIVATE_KEY,
    process.env.RISKY_BORROWER_PRIVATE_KEY,
    process.env.LIQUIDATOR_PRIVATE_KEY,
    process.env.ARBITRAGE_PRIVATE_KEY,
    process.env.STRESS_TESTER_PRIVATE_KEY,
  ];

  const validKeys = privateKeys.filter(k => k && k !== "0x0000000000000000000000000000000000000000000000000000000000000000");
  check("Private Keys", validKeys.length === 6, `${validKeys.length}/6 configured`);

  console.log();

  // 2. Check RPC connectivity
  if (rpcUrl) {
    console.log("2. Checking RPC connectivity...");
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const blockNumber = await provider.getBlockNumber();
      const network = await provider.getNetwork();
      
      check("RPC Connection", true, `Connected to block ${blockNumber}`);
      check("Network", network.chainId === 84532n, `Chain ID: ${network.chainId} (Base Sepolia: 84532)`);
    } catch (error: any) {
      check("RPC Connection", false, `Failed: ${error.message}`);
    }
    console.log();
  }

  // 3. Check contract deployments
  if (rpcUrl && usdcAddress && poolAddress) {
    console.log("3. Checking contract deployments...");
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      // Check USDC
      const usdcCode = await provider.getCode(usdcAddress);
      check("USDC Contract", usdcCode !== "0x", usdcAddress);

      // Check Pool
      const poolCode = await provider.getCode(poolAddress);
      check("Pool Contract", poolCode !== "0x", poolAddress);

      // Check Credit Lines
      for (let i = 0; i < Math.min(5, creditLineAddresses.length); i++) {
        const clCode = await provider.getCode(creditLineAddresses[i]);
        check(`Credit Line #${i + 1}`, clCode !== "0x", creditLineAddresses[i]);
      }
    } catch (error: any) {
      check("Contract Check", false, `Failed: ${error.message}`);
    }
    console.log();
  }

  // 4. Check agent wallet balances
  if (rpcUrl && usdcAddress && validKeys.length > 0) {
    console.log("4. Checking agent wallet balances...");
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const usdcABI = [
        "function balanceOf(address) view returns (uint256)",
      ];

      const agentNames = ["Lender", "Borrower", "Risky Borrower", "Liquidator", "Arbitrage", "Stress Tester"];
      // Compressed sim requirements (we can mint more on demand).
      const requiredBalances = [20000, 15000, 5000, 5000, 20000, 30000]; // in USDC

      for (let i = 0; i < validKeys.length; i++) {
        const wallet = new ethers.Wallet(privateKeys[i]!, provider);
        const address = wallet.address;

        // Check ETH balance
        const ethBalance = await provider.getBalance(address);
        const ethBalanceEth = ethers.formatEther(ethBalance);
        const hasEnoughEth = ethBalance > ethers.parseEther("0.00001"); // Compressed sim: enough for a few txs
        
        check(`${agentNames[i]} ETH`, hasEnoughEth, 
          `${address.slice(0, 10)}... has ${parseFloat(ethBalanceEth).toFixed(4)} ETH`);

        // Check USDC balance
        const usdc = new ethers.Contract(usdcAddress, usdcABI, provider);
        const usdcBalance = await usdc.balanceOf(address);
        const usdcBalanceFormatted = ethers.formatUnits(usdcBalance, 6);
        const hasEnoughUsdc = parseFloat(usdcBalanceFormatted) >= requiredBalances[i];

        check(`${agentNames[i]} USDC`, hasEnoughUsdc,
          `${parseFloat(usdcBalanceFormatted).toFixed(2)} USDC (need ${requiredBalances[i]})`);
      }
    } catch (error: any) {
      check("Balance Check", false, `Failed: ${error.message}`);
    }
    console.log();
  }

  // 5. Check pool liquidity
  if (rpcUrl && poolAddress) {
    console.log("5. Checking pool liquidity...");
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const poolABI = [
        "function totalAssets() view returns (uint256)",
        "function availableLiquidity() view returns (uint256)",
      ];

      const pool = new ethers.Contract(poolAddress, poolABI, provider);
      const totalAssets = await pool.totalAssets();
      const availableLiquidity = await pool.availableLiquidity();

      const totalAssetsFormatted = ethers.formatUnits(totalAssets, 6);
      const availableLiquidityFormatted = ethers.formatUnits(availableLiquidity, 6);

      check("Pool Total Assets", totalAssets > 0n, `${totalAssetsFormatted} USDC`);
      check("Pool Liquidity", availableLiquidity > 0n, `${availableLiquidityFormatted} USDC available`);
    } catch (error: any) {
      check("Pool Check", false, `Failed: ${error.message}`);
    }
    console.log();
  }

  // Summary
  console.log("=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));

  const totalChecks = results.length;
  const passedChecks = results.filter(r => r.passed).length;
  const failedChecks = totalChecks - passedChecks;

  console.log(`Total Checks: ${totalChecks}`);
  console.log(`Passed: ${passedChecks} ✅`);
  console.log(`Failed: ${failedChecks} ❌`);
  console.log();

  if (failedChecks === 0) {
    console.log("🎉 All checks passed! Ready to run agents.");
    console.log("\nTo start the simulation:");
    console.log("  npx tsx coordinator.ts");
  } else {
    console.log("⚠️ Some checks failed. Please fix the issues above before running agents.");
    console.log("\nFailed checks:");
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.message}`);
    });
  }

  process.exit(failedChecks > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
