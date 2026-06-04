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

| Name | Description |
|------|-------------|
| **Vault Save** `vault_save` | Save a note or research entry |
| **Vault Read** `vault_read` | Read an entry by key |
| **Vault List** `vault_list` | List recent entries |
| **Vault Search** `vault_search` | Full-text search across your vault |
| **Vault History** `vault_history` | Version history for an entry |
| **Vault Diff** `vault_diff` | Compare two versions of an entry |
| **Vault Export** `vault_export` | Export vault as JSON or markdown |
| **Store Credential** `vault_store_credential` | Securely store an API key or secret |
| **Get Credential** `vault_get_credential` | Retrieve a stored credential |
| **Vault Publish** `vault_publish` | Publish an entry as a public note |
| **Vault Explore** `vault_explore` | Browse by tag or category |
| **Vault Pin** `vault_pin` | Pin an important entry to the top |
| **Vault Delete** `vault_delete` | Delete an entry |
| **Vault Link** `vault_link` | Link two entries together |
| **Vault Tag** `vault_tag` | Add or update tags on an entry |

#### Memory — Semantic Search (7 tools)

> Find anything by meaning, not keywords. "What did I say about ETH yield?" just works.

| Name | Description |
|------|-------------|
| **Memory Add** `memory_add` | Add text, notes, or auto-fetch a URL into semantic memory |
| **Memory Search** `memory_search` | Search by meaning — natural language queries |
| **Memory Context** `memory_context` | Load entries relevant to the current session |
| **Memory Profile** `memory_profile` | Your full memory profile — preferences, history, patterns |
| **Memory List** `memory_list` | List recent memory entries |
| **Memory Delete** `memory_delete` | Remove a memory entry |
| **Memory Insight** `memory_insight` | AI-generated insights from your memory patterns |

#### OS — Session Lifecycle (3 tools)

| Name | Description |
|------|-------------|
| **Boot** `noel_boot` | Start a session — loads market data, memory, and automations in one command |
| **Status** `noel_status` | Full system dashboard — memory, swarm health, active automations |
| **Shutdown** `noel_shutdown` | End a session — saves summary to vault, stops swarm cleanly |

---

### ⚡ ACT — Execute & Automate

Tell it what to do. It runs — on schedule, on-chain, or right now.

#### Automations (6 tools)

| Name | Description |
|------|-------------|
| **Create Automation** `create_automation` | Create a price alert, DCA schedule, or recurring task in plain English |
| **List Automations** `list_automations` | View all active automations |
| **Pause Automation** `pause_automation` | Pause or resume an automation |
| **Delete Automation** `delete_automation` | Delete an automation |
| **Automation Runs** `get_automation_runs` | Execution history |
| **Run Now** `run_automation` | Trigger an automation manually |

#### DeFi Execution (7 tools)

> Transactions are signed client-side — your private key never leaves your machine.

| Name | Description |
|------|-------------|
| **Portfolio** `get_portfolio` | View wallet holdings and token balances |
| **Estimate Swap** `estimate_swap` | Get a swap quote via 0x before executing |
| **Swap Tokens** `swap_tokens` | Execute a token swap on Base |
| **Send Token** `send_token` | Send ETH or ERC-20 to any address |
| **Scan Wallet** `scan_wallet` | Analyze a wallet — holdings, activity, risk signals |
| **Analyze Wallet** `analyze_wallet` | Deep wallet analysis with on-chain patterns |
| **DeFi Yields** `get_defi_yields` | Find the best yield opportunities on Base |

#### Base Chain (4 tools)

| Name | Description |
|------|-------------|
| **Chain Stats** `base_chain_stats` | Live ETH price, gas price, latest block |
| **Query Vaults** `base_query_vaults` | Top Morpho yield vaults ranked by APY |
| **List Markets** `base_list_markets` | Moonwell lending and borrowing rates |
| **Prepare Deposit** `base_prepare_deposit` | Prepare a deposit into a Morpho vault |

#### Wallet & Notifications (2 tools)

| Name | Description |
|------|-------------|
| **Wallet Address** `get_wallet_address` | Get or generate your MCP wallet address |
| **Set Telegram** `set_telegram` | Connect Telegram for automation notifications |

#### Playbooks (6 tools)

> Reusable sequences with safety rules applied before any action runs.

| Name | Description |
|------|-------------|
| **Create Task** `create_task_packet` | Convert intent into a structured task with constraints |
| **List Tasks** `list_task_packets` | List all task packets |
| **List Playbooks** `list_playbooks` | Browse available playbooks |
| **Run Playbook** `run_playbook` | Execute a playbook by ID |
| **Noel Ledger** `get_noel_ledger` | Credits and full audit trail |
| **Sentinel Rules** `get_sentinel_rules` | View safety rules applied before actions |

---

### 🔍 KNOW — Research & Intelligence

Always informed before you act.

#### Market & Prices (5 tools)

| Name | Description |
|------|-------------|
| **Market Data** `get_market_data` | Live prices for BTC, ETH, SOL, and other tokens |
| **Token Data** `get_token_data` | Token info — price, volume, market cap |
| **Compare Tokens** `compare_tokens` | Side-by-side comparison of two tokens |
| **Market Overview** `market_overview` | Top movers, sentiment, dominance snapshot |
| **Token History** `token_history` | Historical price data for any token |

#### Scanner (4 tools)

| Name | Description |
|------|-------------|
| **Score Token** `score_token` | Risk and quality score for any token |
| **Check Token** `check_token` | Contract audit flags and honeypot detection |
| **Scan Dips** `scan_dips` | Tokens dipping with recovery signals |
| **Scan Momentum** `scan_momentum` | Tokens with strong upward momentum |

#### Research & Insight (3 tools)

| Name | Description |
|------|-------------|
| **Ask Noel** `ask_noel` | AI crypto analyst — opinions, trade ideas, market outlook |
| **Market Thesis** `market_thesis` | Investment thesis for any token or sector |
| **Trade Plan** `trade_plan` | Structured trade plan with entry, exit, and risk levels |

#### Agent Network (15 tools)

> Spin up multiple AI agents that research and monitor in parallel.

| Name | Description |
|------|-------------|
| **Start Swarm** `start_swarm` | Start the agent network |
| **Stop Swarm** `stop_swarm` | Stop the active swarm |
| **Swarm Status** `get_swarm_status` | Status and shared memory snapshot |
| **Trigger Agent** `trigger_agent` | Run a specific agent now |
| **Write Memory** `write_swarm_memory` | Write to shared agent memory |
| **Read Memory** `get_swarm_memory` | Read from shared agent memory |
| **Execution Scores** `get_execution_scores` | Performance scores across all agents |
| **Swarm Research** `swarm_research` | Multi-agent research on any topic — saves to vault |
| **Swarm Brief** `swarm_brief` | Summary of everything the swarm has found |
| **Broadcast** `swarm_broadcast` | Send a message to all active agents |
| **Swarm Pulse** `swarm_pulse` | Heartbeat — active agents and last activity |
| **Swarm Reflect** `swarm_reflect` | Agents self-evaluate what went well |
| **Swarm Watch** `swarm_watch` | Watch a token or topic for changes |
| **List Agents** `list_agents` | Browse available specialist agents |
| **Hire Agent** `hire_agent` | Hire an agent for a specific task |

---

### 🛠 BUILD — Developer & Content Tools

#### Coder (7 tools)

| Name | Description |
|------|-------------|
| **Scaffold Project** `scaffold_project` | Scaffold a DeFi or Web3 project |
| **Generate Component** `generate_component` | React component with wagmi/viem |
| **Generate Contract** `generate_contract` | Solidity smart contract |
| **Audit Contract** `audit_contract` | Contract vulnerability audit |
| **Explain Code** `explain_code` | Explain any code in plain English |
| **Generate MCP Skill** `generate_mcp_skill` | Generate a new MCP tool from plain English |
| **Review Code** `review_code` | Code review with actionable feedback |

#### Content & Humanizer (3 tools)

| Name | Description |
|------|-------------|
| **Humanize Text** `humanize_text` | Strip AI patterns — makes output sound human |
| **Write Thread** `write_thread` | Write a Twitter/X thread on any topic |
| **Write Post** `write_post` | Write a punchy social post |

#### MiroShark — Market Simulation (3 tools)

| Name | Description |
|------|-------------|
| **Simulate** `miroshark_simulate` | Run a multi-agent market simulation from plain English |
| **Simulation Status** `miroshark_status` | Poll progress and get the AI brief on completion |
| **Stop Simulation** `miroshark_stop` | Stop a running simulation |

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
