// coordinator.ts - Agent Coordinator & Metrics Dashboard
// Spawns all 6 agents, monitors health, restarts crashed agents, collects metrics
import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface AgentProcess {
  name: string;
  process: ChildProcess | null;
  startTime: number;
  restarts: number;
  status: "running" | "stopped" | "crashed";
  lastOutput: string;
}

interface AggregateMetrics {
  timestamp: number;
  uptime: number;
  agents: {
    [key: string]: {
      status: string;
      restarts: number;
      metrics?: any;
    };
  };
  poolStats: {
    totalAssets: string;
    availableLiquidity: string;
    utilization: string;
    estimatedRate: string;
  };
  summary: {
    totalTxs: number;
    successRate: string;
    totalGasUsed: string;
    totalGasCostETH: string;
    totalProfitLoss: string;
  };
}

class AgentCoordinator {
  private agents: Map<string, AgentProcess> = new Map();
  private startTime: number = Date.now();
  private running: boolean = true;
  private provider: ethers.Provider;
  private poolAddress: string;
  private usdcAddress: string;
  private dashboardInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  // NOTE: ACLPool supports exactly ONE registered credit line, and each credit line
  // is bound to ONE borrower. For a clean testnet sim, we run only the agents that
  // can operate against the single registered line without fighting over borrower rights.
  private readonly AGENT_SCRIPTS = [
    "lender.ts",
    "borrower.ts",
    "liquidator.ts",
  ];

  private readonly RESTART_DELAY_MS = 5000;
  private readonly HEALTH_CHECK_INTERVAL_MS = 30000; // 30 seconds
  private readonly DASHBOARD_UPDATE_INTERVAL_MS = 60000; // 1 minute
  private readonly MAX_RESTARTS = 10;

  constructor() {
    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL;
    this.poolAddress = process.env.POOL_ADDRESS || "";
    this.usdcAddress = process.env.USDC_ADDRESS || "";

    if (!rpcUrl || !this.poolAddress || !this.usdcAddress) {
      throw new Error("Missing required environment variables");
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    this.log("Agent Coordinator initialized", {
      rpcUrl,
      poolAddress: this.poolAddress,
      agents: this.AGENT_SCRIPTS.length,
    });
  }

  private log(message: string, data?: any) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [COORDINATOR] ${message}`, data || "");
  }

  private error(message: string, error: any) {
    console.error(`[COORDINATOR] ERROR: ${message}`, error);
  }

  async start() {
    this.log("🚀 Starting Agent Coordinator...");

    // Create logs and metrics directories
    const logsDir = path.join(__dirname, "../../logs");
    const metricsDir = path.join(__dirname, "../../metrics");
    const dashboardDir = path.join(__dirname, "../../dashboard");

    for (const dir of [logsDir, metricsDir, dashboardDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Check RPC health
    const blockNumber = await this.provider.getBlockNumber();
    this.log(`RPC connected. Current block: ${blockNumber}`);

    // Start all agents
    for (const script of this.AGENT_SCRIPTS) {
      await this.startAgent(script);
    }

    // Start health monitoring
    this.startHealthMonitoring();

    // Start dashboard updates
    this.startDashboard();

    // Keep coordinator alive
    await this.coordinatorLoop();
  }

  private async startAgent(scriptName: string) {
    const agentName = scriptName.replace(".ts", "");
    
    this.log(`Starting agent: ${agentName}...`);

    try {
      const scriptPath = path.join(__dirname, scriptName);
      
      // Use tsx to run TypeScript files
      const agentProcess = spawn("npx", ["tsx", scriptPath], {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });

      const agent: AgentProcess = {
        name: agentName,
        process: agentProcess,
        startTime: Date.now(),
        restarts: 0,
        status: "running",
        lastOutput: "",
      };

      // Capture stdout
      agentProcess.stdout?.on("data", (data) => {
        const output = data.toString();
        agent.lastOutput = output.substring(0, 200); // Keep last 200 chars
        // Optionally log to console (can be noisy)
        // console.log(`[${agentName}] ${output}`);
      });

      // Capture stderr
      agentProcess.stderr?.on("data", (data) => {
        const output = data.toString();
        this.error(`Agent ${agentName} error`, output);
      });

      // Handle process exit
      agentProcess.on("exit", (code, signal) => {
        this.log(`Agent ${agentName} exited`, { code, signal });
        agent.status = code === 0 ? "stopped" : "crashed";
        
        // Auto-restart if crashed (unless max restarts reached)
        if (code !== 0 && agent.restarts < this.MAX_RESTARTS && this.running) {
          this.log(`Restarting agent ${agentName} in ${this.RESTART_DELAY_MS}ms...`);
          setTimeout(() => {
            agent.restarts++;
            this.startAgent(scriptName);
          }, this.RESTART_DELAY_MS);
        } else if (agent.restarts >= this.MAX_RESTARTS) {
          this.log(`Agent ${agentName} exceeded max restarts (${this.MAX_RESTARTS})`);
        }
      });

      this.agents.set(agentName, agent);
      this.log(`✅ Agent ${agentName} started (PID: ${agentProcess.pid})`);
    } catch (error) {
      this.error(`Failed to start agent ${agentName}`, error);
    }
  }

  private startHealthMonitoring() {
    this.log("Starting health monitoring...");
    
    this.healthCheckInterval = setInterval(async () => {
      for (const [name, agent] of this.agents.entries()) {
        // Check if process is still running
        if (agent.process && agent.process.exitCode === null) {
          agent.status = "running";
        } else if (agent.status === "running") {
          agent.status = "crashed";
          this.log(`⚠️ Agent ${name} detected as crashed`);
        }
      }
    }, this.HEALTH_CHECK_INTERVAL_MS);
  }

  private startDashboard() {
    this.log("Starting dashboard updates...");
    
    this.dashboardInterval = setInterval(async () => {
      const metrics = await this.collectAggregateMetrics();
      this.displayDashboard(metrics);
      this.saveDashboard(metrics);
    }, this.DASHBOARD_UPDATE_INTERVAL_MS);

    // Initial dashboard
    setTimeout(async () => {
      const metrics = await this.collectAggregateMetrics();
      this.displayDashboard(metrics);
      this.saveDashboard(metrics);
    }, 5000);
  }

  private async collectAggregateMetrics(): Promise<AggregateMetrics> {
    const metricsDir = path.join(__dirname, "../../metrics");
    
    const aggregated: AggregateMetrics = {
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      agents: {},
      poolStats: {
        totalAssets: "0",
        availableLiquidity: "0",
        utilization: "0%",
        estimatedRate: "0%",
      },
      summary: {
        totalTxs: 0,
        successRate: "0%",
        totalGasUsed: "0",
        totalGasCostETH: "0",
        totalProfitLoss: "0",
      },
    };

    // Collect agent statuses
    for (const [name, agent] of this.agents.entries()) {
      aggregated.agents[name] = {
        status: agent.status,
        restarts: agent.restarts,
      };

      // Load metrics file
      const metricsFile = path.join(metricsDir, `${name}-metrics.json`);
      if (fs.existsSync(metricsFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(metricsFile, "utf-8"));
          aggregated.agents[name].metrics = data;
          
          // Aggregate totals
          aggregated.summary.totalTxs += data.totalTxs || 0;
        } catch (error) {
          // Ignore parse errors
        }
      }
    }

    // Collect pool stats
    try {
      const poolAbi = [
        "function totalAssets() view returns (uint256)",
        "function availableLiquidity() view returns (uint256)",
      ];
      const pool = new ethers.Contract(this.poolAddress, poolAbi, this.provider);
      
      const totalAssets = await pool.totalAssets();
      const availableLiquidity = await pool.availableLiquidity();
      const borrowed = totalAssets - availableLiquidity;
      const utilization = totalAssets > 0n 
        ? Number((borrowed * 10000n) / totalAssets) / 100
        : 0;

      // Estimate rate
      let estimatedRate = 2.0;
      if (utilization > 0 && utilization <= 80) {
        estimatedRate = 2.0 + (utilization / 80) * 4.0;
      } else if (utilization > 80) {
        const excessUtil = utilization - 80;
        estimatedRate = 2.0 + 4.0 + (excessUtil / 20) * 60.0;
      }

      aggregated.poolStats = {
        totalAssets: ethers.formatUnits(totalAssets, 6),
        availableLiquidity: ethers.formatUnits(availableLiquidity, 6),
        utilization: `${utilization.toFixed(2)}%`,
        estimatedRate: `${estimatedRate.toFixed(2)}%`,
      };
    } catch (error) {
      this.error("Failed to collect pool stats", error);
    }

    return aggregated;
  }

  private displayDashboard(metrics: AggregateMetrics) {
    console.clear();
    console.log("═══════════════════════════════════════════════════════");
    console.log("         KLAAVE V2 AGENT COORDINATOR DASHBOARD         ");
    console.log("═══════════════════════════════════════════════════════");
    console.log(`Uptime: ${Math.floor(metrics.uptime / 1000)}s`);
    console.log(`Timestamp: ${new Date(metrics.timestamp).toISOString()}`);
    console.log("");

    console.log("───────────────────────────────────────────────────────");
    console.log("POOL STATS");
    console.log("───────────────────────────────────────────────────────");
    console.log(`Total Assets:     ${metrics.poolStats.totalAssets} USDC`);
    console.log(`Available Liq:    ${metrics.poolStats.availableLiquidity} USDC`);
    console.log(`Utilization:      ${metrics.poolStats.utilization}`);
    console.log(`Borrow Rate:      ${metrics.poolStats.estimatedRate}`);
    console.log("");

    console.log("───────────────────────────────────────────────────────");
    console.log("AGENT STATUS");
    console.log("───────────────────────────────────────────────────────");
    for (const [name, agent] of Object.entries(metrics.agents)) {
      const statusIcon = agent.status === "running" ? "✅" : agent.status === "crashed" ? "❌" : "⏸️";
      const restartText = agent.restarts > 0 ? ` (${agent.restarts} restarts)` : "";
      console.log(`${statusIcon} ${name.padEnd(20)} ${agent.status}${restartText}`);
      
      if (agent.metrics) {
        const m = agent.metrics;
        const successRate = m.totalTxs > 0 
          ? ((m.successfulTxs / m.totalTxs) * 100).toFixed(1) 
          : "0.0";
        console.log(`   └─ Txs: ${m.totalTxs} (${successRate}% success) | Gas: ${m.totalGasUsed || "0"}`);
      }
    }
    console.log("");

    console.log("───────────────────────────────────────────────────────");
    console.log("AGGREGATE METRICS");
    console.log("───────────────────────────────────────────────────────");
    console.log(`Total Transactions: ${metrics.summary.totalTxs}`);
    console.log("");

    console.log("═══════════════════════════════════════════════════════");
  }

  private saveDashboard(metrics: AggregateMetrics) {
    const dashboardDir = path.join(__dirname, "../../dashboard");
    const dashboardFile = path.join(dashboardDir, "latest.json");
    
    try {
      fs.writeFileSync(dashboardFile, JSON.stringify(metrics, null, 2));
    } catch (error) {
      this.error("Failed to save dashboard", error);
    }
  }

  private async coordinatorLoop() {
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  async shutdown() {
    this.log("Shutting down coordinator...");
    this.running = false;

    // Stop intervals
    if (this.dashboardInterval) clearInterval(this.dashboardInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);

    // Kill all agent processes
    for (const [name, agent] of this.agents.entries()) {
      if (agent.process && agent.process.exitCode === null) {
        this.log(`Stopping agent ${name}...`);
        agent.process.kill("SIGTERM");
        
        // Wait for graceful shutdown
        await new Promise((resolve) => setTimeout(resolve, 2000));
        
        // Force kill if still running
        if (agent.process.exitCode === null) {
          this.log(`Force killing agent ${name}...`);
          agent.process.kill("SIGKILL");
        }
      }
    }

    this.log("All agents stopped. Coordinator shut down.");
  }
}

// Main execution
async function main() {
  const coordinator = new AgentCoordinator();

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down coordinator...");
    await coordinator.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down coordinator...");
    await coordinator.shutdown();
    process.exit(0);
  });

  await coordinator.start();
}

main().catch((error) => {
  console.error("Fatal coordinator error:", error);
  process.exit(1);
});
