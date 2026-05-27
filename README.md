# @noelclaw/mcp

[![npm version](https://img.shields.io/npm/v/@noelclaw/mcp.svg)](https://www.npmjs.com/package/@noelclaw/mcp)

Noelclaw as an MCP skill — persistent memory, multi-agent coordination, scenario simulation, DeFi execution, and Sentinel-gated playbooks. Works with Claude, Cursor, Hermes, Windsurf, and any MCP-compatible client.

**37 tools** across market data, research, vault, swarm, MiroShark simulation, DeFi, automation, and framework.

```bash
npx @noelclaw/mcp
```

---

## Quick Install

### Claude Code
```bash
claude mcp add noelclaw -e NOELCLAW_API_KEY=noel_... -- npx @noelclaw/mcp
```

### Claude Desktop
Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "noelclaw": {
      "command": "npx",
      "args": ["@noelclaw/mcp"],
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
      "args": ["@noelclaw/mcp"],
      "env": {
        "NOELCLAW_API_KEY": "noel_..."
      }
    }
  }
}
```

### Hermes
```yaml
mcp_servers:
  noelclaw:
    command: npx
    args:
      - "@noelclaw/mcp"
    env:
      NOELCLAW_API_KEY: "noel_..."
```

---

## Authentication

Get a key instantly — no signup:

```bash
curl -X POST https://api.noelclaw.com/auth/key
# → { "apiKey": "noel_..." }
```

Set `NOELCLAW_API_KEY` in your MCP config. That's it.

---

## Tools

### Market Data

| Tool | Description |
|------|-------------|
| `get_market_data` | Live prices for BTC, ETH, SOL — sourced from CoinGecko via swarm. Pass a token symbol to focus |
| `get_token_data` | Price, 24h change, market cap, and volume for any specific token |

### Research & AI

| Tool | Description |
|------|-------------|
| `research` | Deep research via Bankr (real-time). Returns overview, key findings, market impact, sentiment |
| `get_insight` | Noel's daily crypto + macro insight — price action, narratives, on-chain signals, one takeaway |
| `ask_noel` | Ask Noel AI for DeFi analysis, trade ideas, and market research with live context |
| `humanize_text` | Remove AI tells from text — fixes 29 AI patterns, makes output sound natural. Powered by MiniMax-M2.7. Requires `MINIMAX_API_KEY` |

### Noel-Vault

> Persistent memory across sessions. Save findings, recall by key, search full-text. Every save auto-versions.

| Tool | Description |
|------|-------------|
| `vault_save` | Save any content — research, execution logs, workflows, prompts, files, memory |
| `vault_read` | Read an entry by key |
| `vault_list` | List all entries with type, title, version, last updated |
| `vault_search` | Full-text search across all content |
| `vault_history` | Version history with commit messages |
| `vault_diff` | Line-by-line diff between two versions |
| `vault_export` | Export full vault or filter by type |

### Noel-Swarm

> Shared memory bus for multi-agent coordination. All agents read/write the same store with freshness tracking and execution scoring.

| Tool | Description |
|------|-------------|
| `start_swarm` | Start a swarm session |
| `stop_swarm` | Stop the active session |
| `get_swarm_status` | Session state, memory snapshot, execution scores |
| `write_swarm_memory` | Write a key-value entry with optional TTL. Use `market/*` / `dex/*` keys for live CoinGecko / DexScreener data |
| `get_swarm_memory` | Read by key — returns value + freshness metadata |
| `get_execution_scores` | Per-agent, per-skill performance scores |

### MiroShark

> Multi-agent scenario simulation — describe any scenario in plain English, get back a full simulation with AI agents acting as market participants, analysts, and social actors.

| Tool | Description |
|------|-------------|
| `miroshark_simulate` | Run a simulation from a plain-English scenario. Handles full setup automatically (knowledge graph, 42+ agents). Returns a simulation ID |
| `miroshark_status` | Poll progress — surfaces agent actions, round count, consensus when complete |

No extra env vars needed. MiroShark is hosted on Noelclaw's infrastructure.

### Wallet & DeFi `beta`

> On-chain operations on Base mainnet. Transactions are signed client-side — no private key ever leaves your machine.

| Tool | Description |
|------|-------------|
| `get_wallet_address` | Show your local MCP wallet address |
| `swap_tokens` | Swap tokens on Base mainnet via 0x Permit2 (ETH, USDC, USDT, DAI, WETH) |
| `send_token` | Send ETH or any ERC-20 to any address |
| `claim_fees` | Claim accumulated ETH from Flaunch token swap fees |

### Automations `beta`

| Tool | Description |
|------|-------------|
| `create_automation` | Create an automation in plain English — DCA, price alerts, conditional buys/sells |
| `list_automations` | List all automations with status and next scheduled run |
| `pause_automation` | Pause or resume an automation |
| `delete_automation` | Permanently delete an automation |

### Noel Framework `beta`

> Sentinel-gated agent execution. Every action checked against 5 mechanical rules before it runs.

| Tool | Description |
|------|-------------|
| `create_task_packet` | Convert plain-English intent into a structured task scope with permissions and constraints |
| `list_task_packets` | List all task packets |
| `list_playbooks` | List available playbooks |
| `run_playbook` | Execute a Sentinel-gated playbook — halts if any step is blocked |
| `get_noel_ledger` | Full audit trail of every Sentinel decision |
| `get_sentinel_rules` | Exact rules per agent role |

### Social

| Tool | Description |
|------|-------------|
| `post_tweet` | Post a tweet. Requires `TWITTER_BEARER_TOKEN` or delegated via Noelclaw |
| `set_telegram` | Connect Telegram for push notifications from market and swarm events |

---

## Environment Variables

### Required

| Var | Description |
|-----|-------------|
| `NOELCLAW_API_KEY` | Your API key (`noel_...`) — get one at `POST https://api.noelclaw.com/auth/key` |

### Optional

| Var | Used for |
|-----|---------|
| `MINIMAX_API_KEY` | `humanize_text` tool — powered by MiniMax-M2.7 |
| `BANKR_API_KEY` | `research` tool — Bankr Agent deep research |
| `TELEGRAM_BOT_TOKEN` | Your own Telegram bot for notifications |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |
| `ALCHEMY_API_KEY` | Faster Base RPC for swaps |
| `GROK_API_KEY` | Grok integration via BYOK |

---

## Usage Examples

```
# Live market data
get_market_data()                                          # BTC, ETH, SOL prices
get_token_data(question: "What is the price of HYPE?")

# Research
research(query: "What is happening with the Base ecosystem this week?")
get_insight()
ask_noel(question: "What are the risks of holding ETH through a Fed meeting?")

# Humanize AI-generated text
humanize_text(text: "In today's rapidly evolving landscape, it is worth noting...")

# Save findings to vault
vault_save(type: "research", key: "research/base-may-2026", title: "Base Ecosystem", content: "...")
vault_search(query: "Base ecosystem")
vault_history(key: "research/base-may-2026")

# Coordinate agents via swarm
start_swarm()
write_swarm_memory(agentId: "analyst", key: "research/btc", value: "bullish", ttlSeconds: 3600)
get_swarm_memory(key: "market/BTC")    # real-time CoinGecko price
get_swarm_memory(key: "dex/PEPE")     # real-time DexScreener data

# Run a MiroShark simulation
miroshark_simulate(scenario: "What happens if the US passes a Bitcoin strategic reserve bill?")
miroshark_status(simulation_id: "sim_abc123")

# DeFi (beta)
swap_tokens(fromToken: "ETH", toToken: "USDC", amount: "0.01")
send_token(token: "USDC", toAddress: "0x...", amount: "10")
claim_fees()

# Sentinel-gated execution (beta)
create_task_packet(task: "Monitor portfolio, max $0 spend, read only")
run_playbook(playbook_name: "Daily Market Scan")
get_noel_ledger()
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| Tools not appearing | Restart your MCP client after adding the config |
| `401 Unauthorized` | Check `NOELCLAW_API_KEY` is set — get one at `POST https://api.noelclaw.com/auth/key` |
| `humanize_text` fails | Set `MINIMAX_API_KEY` in your MCP env config |
| `research` fails | Set `BANKR_API_KEY` — Bankr access required for deep research |
| Server starts but no response | Expected — server waits for MCP stdin, not HTTP |

---

## Links

- npm: [npmjs.com/package/@noelclaw/mcp](https://npmjs.com/package/@noelclaw/mcp)
- GitHub: [github.com/noelclaw/mcp](https://github.com/noelclaw/mcp)
- Platform: [noelclaw.com](https://noelclaw.com)
