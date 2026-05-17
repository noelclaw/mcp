# @noelclaw/research

Noelclaw as an MCP skill — market intelligence, autonomous research, DeFi execution, and multi-agent swarm coordination. Gives Claude, Cursor, Hermes, and any MCP-compatible AI client access to live crypto signals, whale tracking, on-chain DeFi, and a self-improving agent swarm — all backed by real-time intelligence via Bankr.

```bash
npx @noelclaw/research
```

---

## Tools

### Market & Signals

| Tool | Description |
|------|-------------|
| `get_market_data` | Live top-20 coins by market cap, trending coins, and key prices for BTC/ETH/SOL |
| `get_token_data` | Price, 24h change, market cap, and volume for any token |
| `get_latest_signal` | Latest BTC and/or ETH 1H trading signals — entry, TP targets, stop loss, confidence score |
| `get_signal_history` | Signal history with win/loss record and winrate stats |
| `get_smart_money_alerts` | Smart money and insider wallet movements for micro-cap tokens on Base, Solana, and ETH |
| `get_daily_recap` | Today's trading performance recap with winrate, PnL stats, and AI review |

### Research

| Tool | Description |
|------|-------------|
| `research` | On-demand crypto research — like Perplexity but for crypto. Returns structured analysis: overview, key findings, market impact, affected tokens, sentiment, and what to watch |

### Wallet & DeFi

| Tool | Description |
|------|-------------|
| `get_portfolio` | Full token portfolio on Base mainnet with balances and total USD value. Auto-creates a wallet on first use |
| `swap_tokens` | Swap ETH, USDC, USDT, DAI, WETH on Base mainnet via 0x Permit2 |
| `send_token` | Send ETH or any ERC-20 token to any address on Base mainnet |

### Automations

| Tool | Description |
|------|-------------|
| `create_automation` | Create an automation in plain English — DCA, price alerts, conditional buys/sells, recurring updates |
| `list_automations` | List all your automations with status, run counts, and next scheduled run |
| `pause_automation` | Pause or resume an automation by ID |
| `delete_automation` | Permanently delete an automation |

### Config

| Tool | Description |
|------|-------------|
| `ask_noel` | Ask Noel AI for DeFi analysis, trade ideas, market outlook, and crypto research — with live market context |
| `set_telegram` | Configure your personal Telegram bot to receive signals, whale alerts, research reports, and market data |

### Swarm — new in v1.7.0

| Tool | Description |
|------|-------------|
| `start_swarm` | Start the multi-agent swarm for autonomous market monitoring, sentiment tracking, and workflow execution |
| `stop_swarm` | Stop the active swarm session |
| `get_swarm_status` | See active agents, shared memory snapshot, execution scores, and recent runs |
| `write_swarm_memory` | Write a key-value entry to the swarm's shared memory (with optional TTL) |
| `get_swarm_memory` | Read a value from the swarm's shared memory by key |
| `get_execution_scores` | See which workflows are improving — success rate, win/loss, avg duration, last adapted |

---

## Quick Install

### Recommended: npx (no install required)

```bash
npx @noelclaw/research
```

### Claude Code

```bash
claude mcp add noelclaw -- npx @noelclaw/research
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "noelclaw": {
      "command": "npx",
      "args": ["@noelclaw/research"]
    }
  }
}
```

Restart Claude Desktop. Tools appear automatically.

### Cursor / Windsurf

Open **Settings → MCP** or edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "noelclaw": {
      "command": "npx",
      "args": ["@noelclaw/research"]
    }
  }
}
```

### Hermes Agent

```bash
hermes mcp add noelclaw --command npx --args @noelclaw/research
```

Or in your Hermes config:

```yaml
mcp_servers:
  noelclaw:
    command: npx
    args:
      - "@noelclaw/research"
```

### OpenClaw / custom MCP client

```json
{
  "servers": {
    "noelclaw": {
      "command": "npx",
      "args": ["@noelclaw/research"],
      "env": {
        "NOELCLAW_CONVEX_URL": "https://your-deployment.convex.site"
      }
    }
  }
}
```

---

## Usage Examples

**Get live market data:**
```
get_market_data
```

**Ask Noel a question:**
```
ask_noel(question: "Is ETH forming a breakout on the 1H chart?")
```

**Get the latest BTC signal:**
```
get_latest_signal(token: "BTC")
```

**Check smart money activity:**
```
get_smart_money_alerts(hours: 6)
```

**Research a topic:**
```
research(query: "What is happening with the Base ecosystem this week?")
```

**Check your portfolio and swap:**
```
get_portfolio(userId: "your-user-id")
swap_tokens(userId: "your-user-id", fromToken: "ETH", toToken: "USDC", amount: "1000000000000000000")
```

**Create a DCA automation:**
```
create_automation(userId: "your-user-id", rawInput: "Buy 50 USDC of ETH every day. Stop after spending 500 USDC.")
```

**Set up Telegram delivery:**
```
set_telegram(userId: "your-user-id", telegramBotToken: "...", telegramChatId: "...")
```

---

## Agent Swarm (v1.7.0)

The swarm is a system of 5 coordinated agents that run autonomously and improve over time. Each agent has a specific role, but they all share a common memory layer — so a price fetched by the market monitor is immediately available to the workflow executor when deciding whether to trigger an automation.

**The 5 agents:**

| Agent | Role |
|-------|------|
| `market-monitor` | Fetches live prices and detects significant price moves. Writes market data to shared memory with a 5-minute TTL. Fires alerts when price change exceeds a configurable threshold |
| `sentiment-tracker` | Analyses sentiment for tokens from on-chain signals. Caches results for 15 minutes. Writes sentiment alerts when score crosses ±0.5 |
| `workflow-executor` | Finds due automations and executes them — swaps, sends, and Telegram alerts. Reads token prices from shared memory to convert USD amounts to chain units |
| `memory-manager` | Watches shared memory size. When entries exceed 50, it uses an LLM to compress the oldest 20 into a summary, then deletes the originals. Keeps the swarm lean |
| `risk-verifier` | Gates high-value actions with a fast LLM risk check. Rejected actions trigger a 10-minute cooldown on that action type. Approved actions are cached for 1 hour |

**How agents coordinate:**

- All agents read and write to a shared `swarmMemory` key-value store
- Every agent run is logged to `agentRuns` and scored in `executionScores`
- The coordinator tracks win rate and average duration per skill, then adapts thresholds automatically (via cron every 30 minutes)
- The swarm heartbeat runs every 5 minutes — jobs that go stale for 15+ minutes are auto-paused

**Example workflow:**

```
1. start_swarm(userId: "your-user-id")
   → Starts all 5 agents

2. get_swarm_status(userId: "your-user-id")
   → See active agents, shared memory snapshot, top execution scores

3. get_execution_scores(userId: "your-user-id")
   → See which workflows are improving over time (score, W/L, avg duration)

4. stop_swarm(userId: "your-user-id")
   → Stops the swarm cleanly
```

**BYOK (Bring Your Own Bankr API Key):**

Heavy swarm usage — especially the market monitor, sentiment tracker, and memory manager — calls the Bankr LLM gateway. By default, Noelclaw's platform key is used. To use your own:

1. Set `useOwnKey: true` and your `bankrApiKey` in your user settings on noelclaw.xyz
2. Pass `byok: true` in the `config` when calling `start_swarm`

```
start_swarm(userId: "your-user-id", config: { byok: true, enabledAgents: ["market-monitor", "risk-verifier"] })
```

---

## Optional: Point to a Custom Deployment

By default the MCP server uses Noelclaw's hosted backend. To use your own Convex deployment:

```bash
NOELCLAW_CONVEX_URL="https://your-deployment.convex.site" npx @noelclaw/research
```

Or set it in your MCP config's `env`:

```json
{
  "mcpServers": {
    "noelclaw": {
      "command": "npx",
      "args": ["@noelclaw/research"],
      "env": {
        "NOELCLAW_CONVEX_URL": "https://your-deployment.convex.site"
      }
    }
  }
}
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `BANKR_API_KEY not set` | Set via `npx convex env set BANKR_API_KEY "..."` in your Convex project |
| `TELEGRAM_BOT_TOKEN not set` | Set via `npx convex env set TELEGRAM_BOT_TOKEN "..."` |
| Tools not appearing | Restart your MCP client after adding the config |
| `Noelclaw API error: 404` | Wrong `NOELCLAW_CONVEX_URL` or Convex functions not deployed |
| Server starts but no response | Expected — it waits for MCP stdin, not HTTP |
| Swarm not starting | Make sure Convex is deployed with the swarm files (`swarm.ts`, `swarmCoordinator.ts`, `swarmDb.ts`) |
| `get_swarm_status` returns empty | Start the swarm first with `start_swarm` |
| High token usage in swarm | Enable BYOK in your user settings to use your own Bankr API key |

---

## Links

- npm: [npmjs.com/package/@noelclaw/research](https://npmjs.com/package/@noelclaw/research)
- Docs: [docs.noelclaw.xyz](https://docs.noelclaw.xyz)
- Telegram: [@noelclaw](https://t.me/noelclaw)
