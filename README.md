# @noelclaw/mcp

[![npm version](https://img.shields.io/npm/v/@noelclaw/mcp.svg)](https://www.npmjs.com/package/@noelclaw/mcp)

90 MCP tools for your AI — persistent memory, multi-agent swarm, DeFi execution, market intelligence, automations, and on-chain actions on Base.

No API key required to start. Ask your AI in plain English.

```bash
npx -y @noelclaw/mcp
```

---

## Install

### Terminal
```bash
npx -y @noelclaw/mcp
```

### Claude Code
```bash
claude mcp add noelclaw -- npx -y @noelclaw/mcp
```

### Aeon

Open **Settings → MCP Servers** and add:

```json
{
  "mcpServers": {
    "noelclaw": {
      "command": "npx",
      "args": ["-y", "@noelclaw/mcp"]
    }
  }
}
```

### Hermes

Open **Settings → MCP Servers** and add:

```json
{
  "mcpServers": {
    "noelclaw": {
      "command": "npx",
      "args": ["-y", "@noelclaw/mcp"]
    }
  }
}
```

### Claude Desktop

Add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac):

```json
{
  "mcpServers": {
    "noelclaw": {
      "command": "npx",
      "args": ["-y", "@noelclaw/mcp"]
    }
  }
}
```

### Any Other MCP Client

```json
{
  "mcpServers": {
    "noelclaw": {
      "command": "npx",
      "args": ["-y", "@noelclaw/mcp"]
    }
  }
}
```

Restart your client. Tools load automatically.

---

## What It Does

Ask your AI anything — it routes to the right tool automatically.

```
what's the ETH gas price and latest block on Base?
→ Gas: 0.006 gwei · Block: 46,773,463 · ETH: $1,991

show me the best yield vaults on Base right now
→ Clearstar USDC Reactor: 7.57% APY ($2.6M TVL)
→ Moonwell Flagship USDC: 4.63% APY ($9.1M TVL)

remember my Aerodrome thesis for next time
→ ✓ saved to Vault · auto-loaded every session

set up weekly $100 ETH DCA every Monday
→ ✓ automation created · runs weekly 09:00 UTC

swap 0.5 ETH to USDC on Base
→ ✓ swapped → 1,842 USDC · tx confirmed in 2s

swarm research topic: "ETH vs SOL which wins 2025"
→ Triggers multi-agent research, saves findings to your vault

generate a Solidity ERC-20 with burn and pause features
→ Returns production-ready OpenZeppelin contract
```

---

## Tools

### Base Chain (4 tools)

| Tool | Description |
|------|-------------|
| `base_chain_stats` | Live ETH price, gas price, latest block on Base mainnet |
| `base_query_vaults` | Top Morpho yield vaults ranked by APY with TVL filter |
| `base_list_markets` | Moonwell lending and borrowing rates with utilization |
| `base_prepare_deposit` | Prepare a deposit transaction into a Morpho vault |

### Market & Prices (5 tools)

| Tool | Description |
|------|-------------|
| `get_market_data` | Live prices for BTC, ETH, SOL, and other tokens |
| `get_token_data` | Token info — price, volume, market cap |
| `compare_tokens` | Side-by-side comparison of two tokens |
| `market_overview` | Broad market snapshot — top movers, sentiment, dominance |
| `token_history` | Historical price data for any token |

### DeFi Execution (7 tools)

> Transactions are signed client-side — no private key ever leaves your machine.

| Tool | Description |
|------|-------------|
| `get_portfolio` | View wallet holdings and token balances |
| `estimate_swap` | Get a swap quote via 0x before executing |
| `swap_tokens` | Execute a token swap on Base via 0x |
| `send_token` | Send ETH or ERC-20 tokens to any address |
| `scan_wallet` | Analyze a wallet — holdings, activity, risk signals |
| `analyze_wallet` | Deep wallet analysis with on-chain patterns |
| `get_defi_yields` | Find the best DeFi yield opportunities on Base |

### Vault — Persistent Memory (15 tools)

> Save research, notes, and data across sessions. Every save auto-versions.

| Tool | Description |
|------|-------------|
| `vault_save` | Save a key-value entry to your personal vault |
| `vault_read` | Read a vault entry by key |
| `vault_list` | List recent vault entries |
| `vault_search` | Full-text search across your vault |
| `vault_history` | Version history for a vault entry |
| `vault_diff` | Diff two versions of a vault entry |
| `vault_export` | Export vault entries as JSON or markdown |
| `vault_store_credential` | Securely store an API key or secret |
| `vault_get_credential` | Retrieve a stored credential |
| `vault_publish` | Publish a vault entry as a public note |
| `vault_explore` | Browse vault by tag or category |
| `vault_pin` | Pin an important entry to the top |
| `vault_delete` | Delete a vault entry |
| `vault_link` | Link two vault entries together |
| `vault_tag` | Add or update tags on a vault entry |

### Memory (7 tools)

> Semantic memory backed by Supermemory — find anything by meaning, not keywords.

| Tool | Description |
|------|-------------|
| `memory_add` | Add content to semantic memory — text, notes, or fetch a URL automatically |
| `memory_search` | Search memory by meaning — "what did I save about ETH yield?" |
| `memory_context` | Load memory entries relevant to the current conversation |
| `memory_profile` | Your full memory profile — preferences, history, patterns |
| `memory_list` | List recent memory entries |
| `memory_delete` | Remove a memory entry |
| `memory_insight` | AI-generated insights from your memory patterns |

### Swarm — Multi-Agent System (13 tools)

> Agents research, monitor, and analyze in parallel with shared memory.

| Tool | Description |
|------|-------------|
| `start_swarm` | Start the multi-agent swarm for autonomous monitoring |
| `stop_swarm` | Stop the active swarm session |
| `get_swarm_status` | Status, shared memory snapshot, and execution scores |
| `trigger_agent` | Run one agent now (market-monitor, sentiment-tracker, risk-verifier, etc.) |
| `write_swarm_memory` | Write to the swarm's shared memory |
| `get_swarm_memory` | Read from swarm shared memory |
| `get_execution_scores` | Self-improvement scores across all skills |
| `swarm_research` | Multi-agent research on any topic — auto-saves to vault |
| `swarm_brief` | Summary of everything the swarm has researched |
| `swarm_broadcast` | Broadcast a message to all active swarm agents |
| `swarm_pulse` | Heartbeat check — active agents and last activity |
| `swarm_reflect` | Swarm self-reflection — what went well, what to improve |
| `swarm_watch` | Set the swarm to watch a token or topic for changes |

### Automation (6 tools)

| Tool | Description |
|------|-------------|
| `create_automation` | Create a trigger-based automation — price alert, DCA, scheduled task |
| `list_automations` | View all active automations |
| `pause_automation` | Pause or resume an automation |
| `delete_automation` | Delete an automation |
| `get_automation_runs` | Execution history for automations |
| `run_automation` | Manually trigger an automation now |

### Framework & Sentinel (6 tools)

> Sentinel-gated agent execution — every action checked against rules before it runs.

| Tool | Description |
|------|-------------|
| `create_task_packet` | Convert intent into a structured task with permissions and constraints |
| `list_task_packets` | List all task packets |
| `list_playbooks` | List available execution playbooks |
| `run_playbook` | Execute a playbook by ID |
| `get_noel_ledger` | Credits ledger and full audit trail |
| `get_sentinel_rules` | View and manage Sentinel gate rules |

### Scanner (4 tools)

| Tool | Description |
|------|-------------|
| `score_token` | Risk and quality score for any token |
| `check_token` | Contract audit flags and honeypot detection |
| `scan_dips` | Find tokens currently dipping with recovery signals |
| `scan_momentum` | Find tokens with strong upward momentum |

### Research & Insight (3 tools)

| Tool | Description |
|------|-------------|
| `ask_noel` | Crypto AI analyst — opinions, trade ideas, market outlook |
| `market_thesis` | AI-generated investment thesis for any token or sector |
| `trade_plan` | Structured trade plan with entry, exit, and risk levels |

### MiroShark (3 tools)

| Tool | Description |
|------|-------------|
| `miroshark_simulate` | Run a multi-agent market simulation from plain English |
| `miroshark_status` | Poll simulation progress and get the AI brief on completion |
| `miroshark_stop` | Stop a running simulation |

### Coder (7 tools)

| Tool | Description |
|------|-------------|
| `scaffold_project` | Scaffold a DeFi or Web3 project |
| `generate_component` | Generate a React component with wagmi/viem |
| `generate_contract` | Generate a Solidity smart contract |
| `audit_contract` | Audit a Solidity contract for vulnerabilities |
| `explain_code` | Explain any code in plain English |
| `generate_mcp_skill` | Generate a new MCP tool from a plain English description |
| `review_code` | Code review with actionable feedback |

### Agents Marketplace (2 tools)

| Tool | Description |
|------|-------------|
| `list_agents` | Browse available AI agents |
| `hire_agent` | Hire an agent for a specific task |

### Content & Humanizer (3 tools)

| Tool | Description |
|------|-------------|
| `humanize_text` | Remove AI writing patterns — fixes 29 common AI tells |
| `write_thread` | Write a Twitter/X thread on any topic |
| `write_post` | Write a single social post — crypto, product, or general |

### OS (3 tools)

| Tool | Description |
|------|-------------|
| `noel_status` | Full system dashboard — memory usage, swarm health, active automations |
| `noel_boot` | Boot sequence — starts swarm, loads market prices, returns a unified briefing |
| `noel_shutdown` | Clean shutdown — stops swarm, saves session summary to vault |

### Wallet & Notifications (2 tools)

| Tool | Description |
|------|-------------|
| `get_wallet_address` | Get or generate your MCP wallet address |
| `set_telegram` | Connect Telegram for notifications |

---

## Configuration

No config required to start — all tools work out of the box via the Noelclaw backend.

For additional capabilities, add to the `env` block in your MCP config:

```json
{
  "mcpServers": {
    "noelclaw": {
      "command": "npx",
      "args": ["-y", "@noelclaw/mcp"],
      "env": {
        "NOELCLAW_API_KEY": "noel_sk_...",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

| Variable | Purpose |
|----------|---------|
| `NOELCLAW_API_KEY` | Unlocks swarm, automation, framework, and agent tools. Get one at [app.noelclaw.com](https://app.noelclaw.com) |
| `ANTHROPIC_API_KEY` | AI tools use your Claude quota — you pay, not the server |
| `NOELCLAW_SESSION_TOKEN` | Session token from app.noelclaw.com (alternative to API key) |
| `NOELCLAW_CONVEX_URL` | Override the backend URL (for self-hosted deployments) |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Tools not appearing | Restart your MCP client after adding the config |
| Swarm returns auth error | Add `NOELCLAW_API_KEY` — get one at app.noelclaw.com |
| Server starts but no output | Expected — server waits for MCP stdin, not HTTP |
| Old version loading | Run `npx clear-npx-cache` then restart your client |

---

## Links

- npm: [npmjs.com/package/@noelclaw/mcp](https://www.npmjs.com/package/@noelclaw/mcp)
- GitHub: [github.com/noelclaw/mcp](https://github.com/noelclaw/mcp)
- App: [app.noelclaw.com](https://app.noelclaw.com)
- Docs: [docs.noelclaw.fun](https://docs.noelclaw.fun)
