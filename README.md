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

Three pillars: **Remember** · **Act** · **Know**

---

### 🧠 REMEMBER — Persistent Memory

Your AI loads your context before you type a single word.

#### Vault — Structured Notes (15 tools)

> Save research, decisions, and notes. Every entry is versioned and auto-tagged.

| Tool | Description |
|------|-------------|
| `vault_save` | Save a note or research entry |
| `vault_read` | Read an entry by key |
| `vault_list` | List recent entries |
| `vault_search` | Full-text search across your vault |
| `vault_history` | Version history for an entry |
| `vault_diff` | Diff two versions |
| `vault_export` | Export vault as JSON or markdown |
| `vault_store_credential` | Securely store an API key or secret |
| `vault_get_credential` | Retrieve a stored credential |
| `vault_publish` | Publish an entry as a public note |
| `vault_explore` | Browse by tag or category |
| `vault_pin` | Pin an important entry |
| `vault_delete` | Delete an entry |
| `vault_link` | Link two entries together |
| `vault_tag` | Add or update tags |

#### Memory — Semantic Search (7 tools)

> Find anything by meaning, not keywords. "What did I say about ETH yield?" just works.

| Tool | Description |
|------|-------------|
| `memory_add` | Add text, notes, or auto-fetch a URL into semantic memory |
| `memory_search` | Search by meaning — natural language queries |
| `memory_context` | Load entries relevant to the current session |
| `memory_profile` | Your full memory profile — preferences, history, patterns |
| `memory_list` | List recent memory entries |
| `memory_delete` | Remove a memory entry |
| `memory_insight` | AI-generated insights from your memory patterns |

#### OS — Session Lifecycle (3 tools)

| Tool | Description |
|------|-------------|
| `noel_boot` | Start a session — loads market data, memory, and automations in one command |
| `noel_status` | Full system dashboard — memory, swarm health, active automations |
| `noel_shutdown` | End a session — saves summary to vault, stops swarm cleanly |

---

### ⚡ ACT — Execute & Automate

Tell it what to do. It runs — on schedule, on-chain, or right now.

#### Automations (6 tools)

| Tool | Description |
|------|-------------|
| `create_automation` | Create a price alert, DCA schedule, or recurring task in plain English |
| `list_automations` | View all active automations |
| `pause_automation` | Pause or resume an automation |
| `delete_automation` | Delete an automation |
| `get_automation_runs` | Execution history |
| `run_automation` | Trigger an automation manually |

#### DeFi Execution (7 tools)

> Transactions are signed client-side — your private key never leaves your machine.

| Tool | Description |
|------|-------------|
| `get_portfolio` | View wallet holdings and token balances |
| `estimate_swap` | Get a swap quote via 0x before executing |
| `swap_tokens` | Execute a token swap on Base |
| `send_token` | Send ETH or ERC-20 to any address |
| `scan_wallet` | Analyze a wallet — holdings, activity, risk signals |
| `analyze_wallet` | Deep wallet analysis with on-chain patterns |
| `get_defi_yields` | Find the best yield opportunities on Base |

#### Base Chain (4 tools)

| Tool | Description |
|------|-------------|
| `base_chain_stats` | Live ETH price, gas price, latest block |
| `base_query_vaults` | Top Morpho yield vaults ranked by APY |
| `base_list_markets` | Moonwell lending and borrowing rates |
| `base_prepare_deposit` | Prepare a deposit into a Morpho vault |

#### Wallet & Notifications (2 tools)

| Tool | Description |
|------|-------------|
| `get_wallet_address` | Get or generate your MCP wallet address |
| `set_telegram` | Connect Telegram for automation notifications |

#### Playbooks (6 tools)

> Reusable sequences with safety rules applied before any action runs.

| Tool | Description |
|------|-------------|
| `create_task_packet` | Convert intent into a structured task with constraints |
| `list_task_packets` | List all task packets |
| `list_playbooks` | Browse available playbooks |
| `run_playbook` | Execute a playbook by ID |
| `get_noel_ledger` | Credits and full audit trail |
| `get_sentinel_rules` | View safety rules applied before actions |

---

### 🔍 KNOW — Research & Intelligence

Always informed before you act.

#### Market & Prices (5 tools)

| Tool | Description |
|------|-------------|
| `get_market_data` | Live prices for BTC, ETH, SOL, and other tokens |
| `get_token_data` | Token info — price, volume, market cap |
| `compare_tokens` | Side-by-side comparison of two tokens |
| `market_overview` | Top movers, sentiment, dominance snapshot |
| `token_history` | Historical price data for any token |

#### Scanner (4 tools)

| Tool | Description |
|------|-------------|
| `score_token` | Risk and quality score for any token |
| `check_token` | Contract audit flags and honeypot detection |
| `scan_dips` | Tokens dipping with recovery signals |
| `scan_momentum` | Tokens with strong upward momentum |

#### Research & Insight (3 tools)

| Tool | Description |
|------|-------------|
| `ask_noel` | AI crypto analyst — opinions, trade ideas, market outlook |
| `market_thesis` | Investment thesis for any token or sector |
| `trade_plan` | Structured trade plan with entry, exit, and risk levels |

#### Agent Network (15 tools)

> Spin up multiple AI agents that research and monitor in parallel.

| Tool | Description |
|------|-------------|
| `start_swarm` | Start the agent network |
| `stop_swarm` | Stop the active swarm |
| `get_swarm_status` | Status and shared memory snapshot |
| `trigger_agent` | Run a specific agent now |
| `write_swarm_memory` | Write to shared agent memory |
| `get_swarm_memory` | Read from shared agent memory |
| `get_execution_scores` | Performance scores across all agents |
| `swarm_research` | Multi-agent research on any topic — saves to vault |
| `swarm_brief` | Summary of everything the swarm has found |
| `swarm_broadcast` | Send a message to all active agents |
| `swarm_pulse` | Heartbeat — active agents and last activity |
| `swarm_reflect` | Agents self-evaluate what went well |
| `swarm_watch` | Watch a token or topic for changes |
| `list_agents` | Browse available specialist agents |
| `hire_agent` | Hire an agent for a specific task |

---

### 🛠 BUILD — Developer & Content Tools

| Tool | Description |
|------|-------------|
| `scaffold_project` | Scaffold a DeFi or Web3 project |
| `generate_component` | React component with wagmi/viem |
| `generate_contract` | Solidity smart contract |
| `audit_contract` | Contract vulnerability audit |
| `explain_code` | Explain any code in plain English |
| `generate_mcp_skill` | Generate a new MCP tool from plain English |
| `review_code` | Code review with actionable feedback |
| `humanize_text` | Remove AI writing patterns |
| `write_thread` | Write a Twitter/X thread |
| `write_post` | Write a social post |
| `miroshark_simulate` | Multi-agent market simulation |
| `miroshark_status` | Poll simulation progress |
| `miroshark_stop` | Stop a running simulation |

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
