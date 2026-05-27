# @noelclaw/mcp

[![npm version](https://img.shields.io/npm/v/@noelclaw/mcp.svg)](https://www.npmjs.com/package/@noelclaw/mcp)

Noelclaw as an MCP skill â€” persistent memory, multi-agent coordination, scenario simulation, DeFi execution, and Sentinel-gated playbooks. Works with Claude, Cursor, Hermes, Windsurf, and any MCP-compatible client.

```bash
npx @noelclaw/mcp
```

---

## Quick Install

### Claude Code
```bash
claude mcp add noelclaw -- npx @noelclaw/mcp
```

Set your API key:
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

Get a key instantly â€” no signup:

```bash
curl -X POST https://api.noelclaw.com/auth/key
# â†’ { "apiKey": "noel_..." }
```

Set `NOELCLAW_API_KEY` in your MCP config. That's it.

---

## Tools

### Research & AI

| Tool | Description |
|------|-------------|
| `research` | Deep research via Bankr (real-time). Returns overview, key findings, market impact, sentiment |
| `ask_noel` | Ask Noel AI for analysis, trade ideas, and research |
| `humanize_text` | Remove AI tells from text â€” makes output sound natural and human-written |

### Noel-Vault

> Persistent memory across sessions. Save findings, recall by key, search full-text. Every save auto-versions.

| Tool | Description |
|------|-------------|
| `vault_save` | Save any content â€” research, execution logs, workflows, prompts, files |
| `vault_read` | Read an entry by key |
| `vault_list` | List all entries with type, title, version, last updated |
| `vault_search` | Full-text search across all content |
| `vault_history` | Version history with commit messages |
| `vault_diff` | Line-by-line diff between two versions |
| `vault_export` | Export as markdown or JSON |

### Noel-Swarm

> Shared memory bus for multi-agent coordination. All agents read/write the same store with freshness tracking.

| Tool | Description |
|------|-------------|
| `start_swarm` | Start a swarm session |
| `stop_swarm` | Stop the active session |
| `get_swarm_status` | Session state, memory snapshot, execution scores |
| `write_swarm_memory` | Write a key-value entry with optional TTL |
| `get_swarm_memory` | Read by key â€” returns value + freshness metadata |
| `get_execution_scores` | Per-agent, per-skill scores |

### MiroShark

> Scenario simulation engine â€” drop in any scenario and get back strategic insights from a network of AI agents reacting hour by hour. Requires `MIROSHARK_URL` + `MIROSHARK_ADMIN_TOKEN`.

| Tool | Description |
|------|-------------|
| `miroshark_simulate` | Run a multi-agent simulation from a plain-English scenario. Returns a simulation ID |
| `miroshark_status` | Poll simulation results by ID â€” surfaces insights and consensus when complete |

### Wallet & DeFi `beta`

> On-chain operations on Base mainnet. Transactions are built for client-side signing â€” no private key ever leaves your machine.

| Tool | Description |
|------|-------------|
| `get_wallet_address` | Show your local MCP wallet address |
| `get_portfolio` | Full token portfolio with ETH and ERC-20 balances and USD values |
| `swap_tokens` | Swap tokens on Base mainnet |
| `send_token` | Send ETH or any ERC-20 to any address |

### Automations `beta`

| Tool | Description |
|------|-------------|
| `create_automation` | Create an automation in plain English â€” DCA, price alerts, conditional buys/sells |
| `list_automations` | List all automations with status and next scheduled run |
| `pause_automation` | Pause or resume an automation |
| `delete_automation` | Permanently delete an automation |

### Noel Framework `beta`

> Sentinel-gated agent execution. Define what your AI can and can't do â€” before it runs. Every action checked against 5 mechanical rules before execution.

| Tool | Description |
|------|-------------|
| `create_task_packet` | Convert plain-English intent into a structured task scope with permissions and constraints |
| `list_task_packets` | List all task packets |
| `list_playbooks` | List available playbooks |
| `run_playbook` | Execute a Sentinel-gated playbook â€” halts if any step is blocked |
| `get_noel_ledger` | Full audit trail of every Sentinel decision |
| `get_sentinel_rules` | Exact rules per agent role |

### Notifications

| Tool | Description |
|------|-------------|
| `set_telegram` | Connect Telegram for push notifications |

---

## Environment Variables

### Required

| Var | Description |
|-----|-------------|
| `NOELCLAW_API_KEY` | Your API key (`noel_...`) â€” get one at `POST https://api.noelclaw.com/auth/key` |

### BYOK (optional)

| Var | Used for |
|-----|---------|
| `BANKR_API_KEY` | Bankr Agent â€” research, DeFi |
| `TELEGRAM_BOT_TOKEN` | Your own Telegram bot |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |
| `ALCHEMY_API_KEY` | Faster Base RPC for swaps and portfolio |

---

## Usage Examples

```
# Research anything
research(query: "What is happening with the Base ecosystem this week?")
ask_noel(question: "What are the risks of holding ETH through a Fed meeting?")

# Save findings to vault
vault_save(type: "research", key: "research/base-may-2026", title: "Base Ecosystem", content: "...")
vault_search(query: "Base ecosystem")

# Coordinate agents via swarm
start_swarm
write_swarm_memory(agentId: "analyst", key: "research/btc", value: "bullish", ttlSeconds: 3600)
get_swarm_memory(key: "research/btc")

# Run a MiroShark simulation
miroshark_simulate(scenario: "What happens if a major L1 announces a 50% fee reduction?")
miroshark_status(simulation_id: "sim_abc123")

# Clean up AI-generated text
humanize_text(text: "Certainly! I'd be happy to assist you with...")

# DeFi (beta)
get_portfolio
swap_tokens(fromToken: "ETH", toToken: "USDC", amount: "0.01")

# Sentinel-gated execution (beta)
create_task_packet(task: "Monitor portfolio, max $0 spend, read only")
run_playbook(playbook_name: "Daily Market Scan")
get_noel_ledger
```

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| Tools not appearing | Restart your MCP client after adding the config |
| `401 Unauthorized` | Check `NOELCLAW_API_KEY` is set â€” get one at `POST https://api.noelclaw.com/auth/key` |
| Server starts but no response | Expected â€” server waits for MCP stdin, not HTTP |

---

## Links

- npm: [npmjs.com/package/@noelclaw/mcp](https://npmjs.com/package/@noelclaw/mcp)
- GitHub: [github.com/noelclaw/mcp](https://github.com/noelclaw/mcp)
- Platform: [noelclaw.com](https://noelclaw.com)
