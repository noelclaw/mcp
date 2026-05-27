# @noelclaw/research

[![npm version](https://img.shields.io/npm/v/@noelclaw/research.svg)](https://www.npmjs.com/package/@noelclaw/research)

Noelclaw as an MCP skill — DeFi execution, multi-agent swarm, persistent vault, and the Noel Framework. Gives Claude, Cursor, Hermes, and any MCP-compatible AI client access to on-chain DeFi, autonomous agent coordination, and Sentinel-gated playbooks.

```bash
npx @noelclaw/research@latest
```

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
        "NOELCLAW_API_KEY": "noel_..."
      }
    }
  }
}
```

### Cursor / Windsurf
```json
{
  "mcpServers": {
    "noelclaw": {
      "command": "npx",
      "args": ["@noelclaw/research@latest"],
      "env": {
        "NOELCLAW_API_KEY": "noel_..."
      }
    }
  }
}
```

### Hermes Agent
```bash
hermes mcp add noelclaw --command npx --args @noelclaw/research@latest
```

---

## Authentication

Get a key instantly — no signup, no wallet:

```bash
curl -X POST https://api.noelclaw.com/auth/key
# → { "apiKey": "noel_..." }
```

Set it in your MCP client config:

```json
{ "env": { "NOELCLAW_API_KEY": "noel_..." } }
```

---

## Tools

### Research & AI

| Tool | Description |
|------|-------------|
| `research` | Deep research via Bankr (real-time). Returns overview, key findings, market impact, sentiment |
| `ask_noel` | Ask Noel AI for analysis, trade ideas, market outlook, and research |

### Noel-Vault

> Persistent memory + artifact layer. Save research, store execution history, archive workflows — all searchable across sessions.

| Tool | Description |
|------|-------------|
| `vault_save` | Save any content to your vault — research, execution logs, workflows, prompts, files |
| `vault_read` | Read a vault entry by key |
| `vault_list` | List all vault entries with type, title, version, and last updated |
| `vault_search` | Full-text search across all vault content |
| `vault_history` | View version history for a vault entry |
| `vault_diff` | Compare two versions of a vault entry |
| `vault_export` | Export a vault entry as markdown or JSON |

### Wallet & DeFi

| Tool | Description |
|------|-------------|
| `get_wallet_address` | Show your local MCP wallet address on Base mainnet |
| `get_portfolio` | Full token portfolio on Base mainnet with ETH and ERC-20 balances and USD values |
| `swap_tokens` | Swap ETH, USDC, USDT, DAI, WETH on Base mainnet |
| `send_token` | Send ETH or any ERC-20 token to any address on Base mainnet |

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
| `start_swarm` | Start a multi-agent swarm session |
| `stop_swarm` | Stop the active swarm session |
| `get_swarm_status` | Session state, shared memory snapshot, execution scores |
| `write_swarm_memory` | Write a key-value entry to swarm shared memory (with optional TTL) |
| `get_swarm_memory` | Read a value from swarm memory by key |
| `get_execution_scores` | Per-agent, per-skill scores — which workflows are improving |

### Noel Framework

> Sentinel-gated agent execution. Define what your AI can and can't do — before it runs.

| Tool | Description |
|------|-------------|
| `create_task_packet` | Convert plain-English intent into a structured task scope with permissions and constraints |
| `list_task_packets` | List all your task packets — draft, active, completed, blocked |
| `list_playbooks` | List available playbooks — 4 system playbooks + any you've created |
| `run_playbook` | Execute a Sentinel-gated playbook — halts immediately if any step is blocked |
| `get_noel_ledger` | Full audit trail of every Sentinel decision — approved, warned, or blocked |
| `get_sentinel_rules` | Exact rules for each agent role — territory, permissions, blocked actions, value caps |

### Notifications & Social

| Tool | Description |
|------|-------------|
| `set_telegram` | Connect Telegram for push notifications |
| `post_tweet` | Post a tweet on X (Twitter) via Ayrshare. Requires `AYRSHARE_API_KEY` |

---

## Noel Framework

Sentinel-gated agent execution system.

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

---

## Environment Variables

### Required

| Var | Description |
|-----|-------------|
| `NOELCLAW_API_KEY` | Your API key (`noel_...`) — get one at `POST https://api.noelclaw.com/auth/key` |

### BYOK (Bring Your Own Key)

| Var | Used for |
|-----|---------|
| `BANKR_API_KEY` | Bankr Agent — research, DeFi execution |
| `TELEGRAM_BOT_TOKEN` | Your own Telegram bot |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |
| `ALCHEMY_API_KEY` | Faster Base RPC for swaps and portfolio |

---

## Usage Examples

```
# Research a topic
research(query: "What is happening with the Base ecosystem this week?")

# Ask anything
ask_noel(question: "What are the risks of this trade?")

# Check portfolio and swap
get_portfolio
swap_tokens(fromToken: "ETH", toToken: "USDC", amount: "0.01")

# DCA automation
create_automation(rawInput: "Buy 50 USDC of ETH every day. Stop after 500 USDC total.")

# Start swarm
start_swarm
get_swarm_status

# Save research to vault
vault_save(type: "research", key: "research/base-ecosystem", title: "Base Ecosystem Analysis", content: "...")

# Sentinel-gated playbook
create_task_packet(task: "Monitor portfolio, max $0 spend, only read data")
run_playbook(playbook_name: "Daily Market Scan")
get_noel_ledger
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| Tools not appearing | Restart your MCP client after adding the config |
| `401 Unauthorized` | Check `NOELCLAW_API_KEY` is set and valid |
| `Noelclaw API error: 404` | Wrong endpoint or key expired — generate a new one |
| Server starts but no response | Expected — waits for MCP stdin, not HTTP |

---

## Links

- npm: [npmjs.com/package/@noelclaw/research](https://npmjs.com/package/@noelclaw/research)
- GitHub: [github.com/noelclaw/research](https://github.com/noelclaw/research)
- Platform: [noelclaw.com](https://noelclaw.com)
