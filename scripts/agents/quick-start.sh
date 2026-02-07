#!/bin/bash
# quick-start.sh - Quick start script for V2 agent testing

set -e

echo "🚀 Klaave V2 Agent Testing - Quick Start"
echo "========================================"

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "📝 Please copy .env.example to .env and fill in your values:"
    echo "   cp .env.example .env"
    echo "   nano .env"
    exit 1
fi

echo "✅ Found .env file"

# Check if node_modules exists
if [ ! -d ../../node_modules ]; then
    echo "📦 Installing dependencies..."
    cd ../..
    npm install ethers@6 typescript tsx @types/node
    cd scripts/agents
else
    echo "✅ Dependencies already installed"
fi

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p ../../logs
mkdir -p ../../metrics
mkdir -p ../../dashboard
mkdir -p ../../reports

echo "✅ Directories created"

# Load environment
source .env

# Check required environment variables
REQUIRED_VARS=(
    "BASE_SEPOLIA_RPC_URL"
    "USDC_ADDRESS"
    "POOL_ADDRESS"
    "CREDIT_LINE_ADDRESSES"
    "LENDER_PRIVATE_KEY"
    "BORROWER_PRIVATE_KEY"
    "RISKY_BORROWER_PRIVATE_KEY"
    "LIQUIDATOR_PRIVATE_KEY"
    "ARBITRAGE_PRIVATE_KEY"
    "STRESS_TESTER_PRIVATE_KEY"
)

MISSING_VARS=()
for VAR in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!VAR}" ] || [ "${!VAR}" == "0x0000000000000000000000000000000000000000" ]; then
        MISSING_VARS+=("$VAR")
    fi
done

if [ ${#MISSING_VARS[@]} -ne 0 ]; then
    echo "❌ Error: Missing or invalid environment variables:"
    for VAR in "${MISSING_VARS[@]}"; do
        echo "   - $VAR"
    done
    echo ""
    echo "📝 Please update your .env file with valid values"
    exit 1
fi

echo "✅ All required environment variables set"

# Prompt user for what to run
echo ""
echo "What would you like to run?"
echo "1) Full Coordinator (all 6 agents)"
echo "2) Individual Agent"
echo "3) Pre-flight Check (verify setup)"
echo ""
read -p "Enter choice [1-3]: " CHOICE

case $CHOICE in
    1)
        echo ""
        echo "🚀 Starting Full Coordinator..."
        echo "This will spawn all 6 agents and monitor them"
        echo "Press Ctrl+C to stop gracefully"
        echo ""
        sleep 2
        npx tsx coordinator.ts
        ;;
    2)
        echo ""
        echo "Which agent do you want to run?"
        echo "1) Conservative Lender"
        echo "2) Aggressive Borrower"
        echo "3) Risk-Taking Borrower"
        echo "4) Keeper/Liquidator"
        echo "5) Arbitrage Agent"
        echo "6) Stress Tester"
        echo ""
        read -p "Enter choice [1-6]: " AGENT_CHOICE
        
        case $AGENT_CHOICE in
            1) npx tsx lender.ts ;;
            2) npx tsx borrower.ts ;;
            3) npx tsx risky-borrower.ts ;;
            4) npx tsx liquidator.ts ;;
            5) npx tsx arbitrage.ts ;;
            6) npx tsx stress-tester.ts ;;
            *) echo "Invalid choice"; exit 1 ;;
        esac
        ;;
    3)
        echo ""
        echo "🔍 Running Pre-flight Check..."
        npx tsx preflight-check.ts
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac
