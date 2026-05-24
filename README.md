# @noelclaw/research

[![npm version](https://img.shields.io/npm/v/@noelclaw/research.svg)](https://www.npmjs.com/package/@noelclaw/research)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![tools](https://img.shields.io/badge/tools-35-blue.svg)](#tools)

Noelclaw as an MCP skill — crypto intelligence, DeFi execution, multi-agent swarm, and the Noel Framework. Gives Claude, Cursor, Hermes, and any MCP-compatible AI client access to live signals, whale tracking, on-chain DeFi, autonomous agent swarms, and Sentinel-gated playbooks.

```bash
npx @noelclaw/research@latest
```

> **No API key required.** A local wallet is auto-generated on first run and signs every request. Keys never leave your machine.

---

## Quick Install

### Claude Code
```bash
claude mcp add noelclaw -- npx @noelclaw/research@latest
```

### Claude Desktop
Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "noelclaw": {
      "command": "npx",
      "args": ["@noelclaw/research@latest"],
      "env": {
        "NOELCLAW_API_KEY": "noel_sk_xxx"
      }
    }
  }
}
```

### Cursor / Windsurf
Open **Settings → MCP** or edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "noelclaw": {
      "command": "npx",
      "args": ["@noelclaw/research@latest"]
    }
  }
}
```

### Hermes Agent
```bash
hermes mcp add noelclaw --command npx --args @noelclaw/research@latest
```

Or in your Hermes config:
```yaml
mcp_servers:
  noelclaw:
    command: npx
    args:
      - "@noelclaw/research@latest"
```

---

## Tools (43)

### Market & Signals

| Tool | Description |
|------|-------------|
| `get_market_data` | Live top-20 coins by market cap, trending coins, BTC/ETH/SOL prices via Bankr real-time feed |
| `get_token_data` | Price, 24h change, market cap, and volume for any token |
| `get_latest_signal` | Latest BTC and/or ETH 4H trading signals — entry, TP1, TP2, stop loss, confidence, Volume Profile |
| `get_signal_history` | Signal history with win/loss record and winrate stats |
| `get_smart_money_alerts` | Real DexScreener data — Base chain micro-cap tokens (<$100k mcap) with buy/sell flow analysis |
| `get_daily_recap` | Today's trading performance recap with winrate, PnL stats, and AI review |
| `get_news` | Latest crypto news digest — top stories, regulatory updates, sentiment summary |
| `generate_signal` | Manually trigger a fresh BTC/ETH signal right now (don't wait for 08:00 UTC cron) |

### Research & AI

| Tool | Description |
|------|-------------|
| `research` | Deep crypto research via Bankr gpt-5.4-mini (real-time). Returns overview, key findings, market impact, affected tokens, sentiment |
| `get_insight` | Live crypto + macro briefing via Grok (real-time X/Twitter) with Bankr live price grounding |
| `ask_noel` | Ask Noel AI for DeFi analysis, trade ideas, market outlook, and crypto research |

### Noel-Vault

> Persistent memory + artifact layer for agents. Save research, store execution history, archive workflows, version prompts — all searchable across sessions.

| Tool | Description |
|------|-------------|
| `vault_save` | Save any content to your vault — research, execution logs, workflows, prompts, files |
| `vault_read` | Read a vault entry by key |
| `vault_list` | List all your vault entries with type, title, version, and last updated |
| `vault_search` | Full-text search across all vault content — title, key, content, tags |
| `vault_history` | View version history for a vault entry |
| `vault_diff` | Compare two versions of a vault entry |
| `vault_export` | Export a vault entry as markdown or JSON |

### Wallet & DeFi

| Tool | Description |
|------|-------------|
| `get_wallet_address` | Show your local MCP wallet address on Base mainnet |
| `get_portfolio` | Full token portfolio on Base mainnet with ETH and ERC-20 balances and USD values |
| `swap_tokens` | Swap ETH, USDC, USDT, DAI, WETH on Base mainnet. Supports exact amounts or percentages (e.g. "50%") |
| `send_token` | Send ETH or any ERC-20 token to any address on Base mainnet |
| `deploy_token` | Deploy a new ERC-20 token on Base via Flaunch — earns swap fees forever |
| `claim_fees` | Claim accumulated ETH from Flaunch token swap fees |
| `mint_nft` | Mint an NFT on Base mainnet from any URL or contract address |

### Automations

| Tool | Description |
|------|-------------|
| `create_automation` | Create an automation in plain English — DCA, price alerts, conditional buys/sells |
| `list_automations` | List all your automations with status, run counts, and next scheduled run |
| `pause_automation` | Pause or resume an automation by ID |
| `delete_automation` | Permanently delete an automation |

### Swarm

| Tool | Description |
|------|-------------|
| `start_swarm` | Start the multi-agent swarm — market monitor, sentiment tracker, workflow executor, memory manager, risk verifier |
| `stop_swarm` | Stop the active swarm session |
| `get_swarm_status` | Active agents, shared memory snapshot, execution scores, recent runs |
| `write_swarm_memory` | Write a key-value entry to the swarm's shared memory (with optional TTL) |
| `get_swarm_memory` | Read a value from the swarm's shared memory by key |
| `get_execution_scores` | Which workflows are improving — success rate, win/loss, avg duration, last adapted |

### Noel Framework

> Sentinel-gated agent execution. Define what your AI can and can't do — before it runs.

| Tool | Description |
|------|-------------|
| `create_task_packet` | Convert plain-English intent into a structured task scope (territory, permissions, doNotDo constraints) |
| `list_task_packets` | List all your task packets — draft, active, completed, blocked |
| `list_playbooks` | List available playbooks — 4 system playbooks + any you've created |
| `run_playbook` | Execute a Sentinel-gated playbook — halts immediately if any step is blocked |
| `get_noel_ledger` | Full audit trail of every Sentinel decision — approved, warned, or blocked |
| `get_sentinel_rules` | Exact rules for each agent role — territory, permissions, blocked actions, value caps |

### Account, Notifications & Social

| Tool | Description |
|------|-------------|
| `set_telegram` | Connect Telegram for push notifications — signals, smart money alerts, daily recaps |
| `post_tweet` | Post a tweet on X (Twitter) via Ayrshare. Requires `AYRSHARE_API_KEY` |

---

## Noel Framework

The first Sentinel-gated agent execution system for crypto.

```
User defines Task Packet (plain English)
        ↓
Playbook runs step by step
        ↓
┌──────────────┐
│   Sentinel   │  ← mechanical gate, runs before EVERY step
│   5 checks   │
└──────────────┘
        ↓
  approved / warned / blocked
        ↓
Swarm Agent executes
(Scout → read-only · Tinker → execute · Skeptic → verify · Memory → store)
        ↓
Noel Ledger — immutable audit trail
```

**5 Sentinel checks (mechanical, not prompt-based):**

| Check | Description |
|-------|-------------|
| DoNotDo | Is this action explicitly forbidden in the task packet? |
| Territory | Is this action within the agent's allowed domain? |
| Value limit | Does this exceed the USD cap? |
| Grudge book | Is this agent or user flagged for bad behavior? |
| Rate limit | Too many actions in the last 60 seconds? |

**4 system playbooks:**

| Playbook | Steps | Roles |
|----------|-------|-------|
| Daily Market Scan | 4 | Scout → Scout → Scout → Memory |
| DCA Setup | 4 | Scout → Scout → Skeptic → Tinker |
| Portfolio Rebalance Check | 4 | Scout → Scout → Scout → Skeptic |
| Swarm Intel Sweep | 4 | Tinker → Scout → Scout → Skeptic |

**Example:**
```
create_task_packet(task: "DCA $10 of ETH daily for 30 days. Never spend more than $15 in one day.")
list_playbooks
run_playbook(playbook_name: "DCA Setup")
get_noel_ledger
```

---

## Agent Swarm

5 coordinated agents that run autonomously and improve over time via shared memory.

| Agent | Role |
|-------|------|
| `market-monitor` | Fetches live prices, detects significant moves, writes to shared memory (5min TTL) |
| `sentiment-tracker` | Analyses token sentiment from on-chain signals, fires alerts at ±0.5 score |
| `workflow-executor` | Finds due automations and executes — swaps, sends, alerts |
| `memory-manager` | Watches memory size, compresses oldest entries when >50 |
| `risk-verifier` | Gates high-value actions, triggers 10min cooldown on rejection |

All agents share a `swarmMemory` key-value store. Every run is logged and scored. Thresholds auto-adapt every 30 minutes.

---

## Authentication

### Wallet-native (automatic — no setup)

A wallet is auto-generated at `~/.noelclaw/wallet.json` on first run. Every request is signed with `noelclaw:{toolName}:{timestamp}` (ECDSA secp256k1). Your wallet address is your identity.

To strengthen encryption, set a passphrase:
```json
{ "env": { "NOELCLAW_WALLET_PASSPHRASE": "your-secret" } }
```
Without it, the wallet file is encrypted with machine info only (convenience, not security).

### API key (optional — links to your account)

```json
{ "env": { "NOELCLAW_API_KEY": "noel_sk_xxx" } }
```

Get your key at noelclaw.xyz → Settings → API Keys.

### x402 per-call payment (no account needed)

1. Call any paid tool — you get a `402` response with amount, address, and request ID
2. Send the exact USDC amount to the address on Base mainnet
3. Build the header: `base64("<txHash>:<requestId>")`
4. Set `NOELCLAW_PAYMENT_HEADER` and retry

Each payment header is single-use. Clear it after success.

---

## Environment Variables

No env vars required. Wallet auth is automatic.

### Auth

| Var | Description |
|-----|-------------|
| `NOELCLAW_API_KEY` | Link to your noelclaw.xyz account (`noel_sk_xxx`) |
| `NOELCLAW_SESSION_TOKEN` | Alternative: web session token from noelclaw.xyz |
| `NOELCLAW_WALLET_PASSPHRASE` | Passphrase for stronger wallet file encryption |

### Payments

| Var | Description |
|-----|-------------|
| `NOELCLAW_PAYMENT_HEADER` | Single-use x402 payment proof: `base64(txHash:requestId)` |

### BYOK (Bring Your Own Key)

| Var | Used for |
|-----|---------|
| `GROK_API_KEY` | X.AI Grok — `get_insight`, signal generation |
| `BANKR_API_KEY` | Bankr Agent — swarm agents, research |
| `TELEGRAM_BOT_TOKEN` | Your own Telegram bot (instead of @NoelclawBot) |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID for notifications |

### Advanced

| Var | Default | Description |
|-----|---------|-------------|
| `ALCHEMY_API_KEY` | — | Faster/more reliable Base RPC for swaps and portfolio |
| `NOELCLAW_CONVEX_URL` | `https://api.noelclaw.com` | Override for self-hosted deployment |

---

## Tool Prices

| Tool | Price |
|------|-------|
| `get_market_data`, `get_token_data`, `get_latest_signal`, `get_signal_history` | Free |
| `get_news`, `get_wallet_address`, `set_telegram` | Free |
| `get_swarm_status`, `get_execution_scores`, `write_swarm_memory`, `get_swarm_memory` | Free |
| `list_automations`, `pause_automation`, `delete_automation`, `stop_swarm` | Free |
| `create_task_packet`, `list_task_packets`, `list_playbooks`, `get_noel_ledger`, `get_sentinel_rules` | Free |
| `get_portfolio` | $0.002 |
| `get_smart_money_alerts`, `get_daily_recap`, `ask_noel`, `get_insight`, `get_news` | $0.005 |
| `swap_tokens`, `send_token`, `generate_signal` | $0.005 |
| `create_automation`, `run_playbook` | $0.01 |
| `research`, `start_swarm`, `deploy_token`, `mint_nft` | $0.02 |

---

## Usage Examples

```
# Live market check
get_market_data

# Fresh BTC signal right now
generate_signal(token: "BTC")

# Latest news digest
get_news(limit: 5)

# Ask anything
ask_noel(question: "Is ETH forming a breakout on the 1H chart?")

# Research a topic
research(query: "What is happening with the Base ecosystem this week?")

# Check portfolio and swap
get_portfolio
swap_tokens(fromToken: "ETH", toToken: "USDC", amount: "0.01")

# DCA automation
create_automation(rawInput: "Buy 50 USDC of ETH every day. Stop after 500 USDC total.")

# Start swarm
start_swarm
get_swarm_status

# Sentinel-gated playbook
create_task_packet(task: "Monitor ETH price, max $0 spend, only read market data")
run_playbook(playbook_name: "Daily Market Scan")
get_noel_ledger

# Check your wallet address
get_wallet_address

# Connect Telegram notifications
set_telegram(chat_id: "123456789")
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| Tools not appearing | Restart your MCP client after adding the config |
| `Noelclaw API error: 404` | Wrong `NOELCLAW_CONVEX_URL` or Convex not deployed |
| `401 Unauthorized` | Set `NOELCLAW_API_KEY` or let wallet auth auto-run |
| `Payment required` on every call | Set `NOELCLAW_API_KEY` — wallet auth is automatic but API key gives full access |
| `Payment already used` | Each `NOELCLAW_PAYMENT_HEADER` is single-use — clear after success |
| Server starts but no response | Expected — waits for MCP stdin, not HTTP |
| Wallet decrypt error | `NOELCLAW_WALLET_PASSPHRASE` mismatch, or delete `~/.noelclaw/wallet.json` to regenerate |
| Swarm not starting | Make sure Convex is deployed with swarm files |
| High token usage in swarm | Set `BANKR_API_KEY` to use your own key |

---

## Links

- npm: [npmjs.com/package/@noelclaw/research](https://npmjs.com/package/@noelclaw/research)
- GitHub: [github.com/noelclaw/research](https://github.com/noelclaw/research)
- Docs: [docs.noelclaw.xyz](https://docs.noelclaw.xyz)
- Platform: [noelclaw.xyz](https://noelclaw.xyz)
- Telegram: [@noelclaw](https://t.me/noelclaw)

---

## License

MIT — free to use, fork, and build on.
