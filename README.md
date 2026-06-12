# @noelclaw/mcp

[![npm version](https://img.shields.io/npm/v/@noelclaw/mcp.svg)](https://www.npmjs.com/package/@noelclaw/mcp)
[![npm downloads](https://img.shields.io/npm/dm/@noelclaw/mcp.svg)](https://www.npmjs.com/package/@noelclaw/mcp)

**Your AI gets a persistent brain, an autonomous research team, and the ability to act — not just talk.**

One command. Works with Claude, Cursor, Windsurf, and any MCP client.

```bash
npx -y @noelclaw/mcp
```

---

## Why this exists

Every AI conversation starts from zero. No memory of what you decided last week. No background research running while you sleep. No way to take action — only talk about it.

Noelclaw fixes that. It gives your AI:

- **Persistent memory** — vault + semantic search that survives across every session
- **Autonomous monitors** — set a research topic, get daily findings saved automatically
- **Persistent agents** — spawn named agents with goals, recall them weeks later
- **Actions** — web search, DeFi on Base, code generation, content writing

---

## Install

### Claude Code
```bash
claude mcp add noelclaw -s user -- npx -y @noelclaw/mcp
```

### Claude Desktop / Cursor / Windsurf

Add to your MCP config file:

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

Config file locations:
- **Claude Desktop (Mac):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`
- **Cursor / Windsurf:** `.cursor/mcp.json` or `.windsurf/mcp.json` in your project

Restart your client. Tools load automatically — no API key required to start.

---

## What it looks like in practice

```
remember: I prefer conservative DeFi strategies, max 5% APY targets
→ ✓ saved to memory · loaded automatically in future sessions

set up a daily monitor for AI agent infrastructure news
→ ✓ monitor created · runs every day at 8am
  findings auto-saved to vault + Telegram notification

what have you found so far on AI agent infrastructure?
→ Pulls from vault: 3 reports across 7 days · summarizes key themes

spawn an agent called market-researcher with goal: track Base chain protocols weekly
→ 🤖 agent spawned · recall anytime with agent_recall

what's the ETH yield situation on Base right now?
→ Clearstar USDC Reactor: 7.57% APY · Moonwell Flagship: 4.63% APY

search the web for what happened in crypto today
→ Live results from across the web, summarized

give me a bull vs bear thesis on ETH, save it
→ Full analysis written + auto-saved to vault as v1
```

---

## Tools (102 total)

| Category | Count | What it does |
|----------|-------|-------------|
| **Vault** | 14 | Versioned artifact store — save, search, diff, link, export |
| **Memory** | 10 | Semantic search across everything you've told it |
| **Agents** | 7 | Persistent named agents — spawn, recall, update, ledger, identity |
| **Monitor** | 4 | Recurring autonomous research that saves findings automatically |
| **Market** | 5 | Live crypto prices, token data, history |
| **DeFi** | 6 | Portfolio, swaps, yields on Base |
| **Research** | 5 | `deep_research`, `research_compare`, `research_chain`, `web_search`, `web_scrape` |
| **AI Intel** | 3 | `ask_noel`, `market_thesis`, `trade_plan` |
| **Swarm** | 5 | Multi-agent parallel research |
| **Automation** | 6 | Scheduled tasks in plain English |
| **Chronicle** | 2 | Persistent activity log |
| **Packets** | 4 | Reusable workflow bundles |
| **Scanner** | 3 | Token risk scoring and market signals |
| **GitHub** | 8 | Read repos, PRs, issues, code search |
| **Coder** | 5 | Contracts, audits, code review, MCP skill generation |
| **Framework** | 3 | Playbooks and action ledger |
| **Humanizer** | 2 | Make AI text sound human, write threads/posts |
| **Base** | 4 | Chain stats, Morpho vaults, Moonwell markets |
| **Simulation** | 3 | Multi-agent market simulations (MiroShark) |
| **Wallet** | 2 | Wallet address, Telegram setup |
| **OS** | 1 | System status |

---

## Core concepts

### Vault — versioned storage for everything your AI produces

```
vault_save type="research" title="ETH thesis Q2" content="..."
vault_read key="research/eth-thesis-q2"
vault_history key="research/eth-thesis-q2"   → git-style version log
vault_diff key="..." fromVersion=1 toVersion=3
vault_search query="ETH staking yields"
```

### Memory — semantic search, not keyword search

```
memory_add content="prefer conservative strategies, max 5% APY"
memory_context topic="investment preferences"   → loads relevant context
memory_search query="Base chain protocols"       → finds by meaning
memory_consolidate topic="ETH analysis"          → merges fragments into one summary
```

### Persistent agents — goals that survive across sessions

```
agent_spawn name="market-researcher" goal="track Base chain protocols weekly"
agent_recall name="market-researcher"            → loads goal + full history
agent_update name="market-researcher" progress="found 3 new protocols" status="active"
agent_ledger name="market-researcher"            → full audit trail of all updates
agent_identity agentId="market-researcher"       → gives agent a permanent Base wallet address
```

### Monitors — autonomous research on a schedule

```
schedule_research topic="AI agent infrastructure" schedule="daily" action="save_to_vault"
list_monitors
cancel_monitor id="..."
```

### Packets — reusable workflow bundles

```
packet_create name="morning-brief" description="Daily market + news summary" steps=[...]
packet_run name="morning-brief"
packet_share name="morning-brief"   → publish to community marketplace
```

---

## Configuration

Works without any API keys. Add keys to unlock more features:

```json
{
  "mcpServers": {
    "noelclaw": {
      "command": "npx",
      "args": ["-y", "@noelclaw/mcp"],
      "env": {
        "NOELCLAW_SESSION_TOKEN": "your_session_token"
      }
    }
  }
}
```

| Variable | Purpose | Required? |
|----------|---------|-----------|
| `NOELCLAW_SESSION_TOKEN` | Session token from [noelclaw.com](https://app.noelclaw.com) — unlocks all tools | Recommended |
| `BANKR_API_KEY` | Use Bankr as LLM backend | Optional |
| `ANTHROPIC_API_KEY` | Use your own Claude quota | Optional |
| `NOELCLAW_MODEL` | Override AI model (default: `claude-haiku-4-5-20251001`) | Optional |
| `FIRECRAWL_API_KEY` | Required for `deep_research` and `web_search`; optional for `web_scrape` (falls back to basic fetch) | For research |
| `TRIGGER_SECRET_KEY` | Required for `schedule_research` / `create_monitor` | For monitors |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Monitor notifications via Telegram | Optional |
| `ALCHEMY_API_KEY` | Faster Base chain queries and swap quotes | Optional |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Tools not appearing | Restart your MCP client after adding the config |
| Old version loading | Run `npx clear-npx-cache` then restart |
| `web_search` fails | Add `FIRECRAWL_API_KEY` to env |
| `schedule_research` fails | Add `TRIGGER_SECRET_KEY` to env |
| No Telegram notifications | Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` |
| Swap fails | Check balance with `get_portfolio`, confirm you're on Base mainnet |
| Rate limit (429) | Auto-retries up to 3× with backoff — no action needed |

---

## Links

- **App:** [app.noelclaw.com](https://app.noelclaw.com)
- **npm:** [npmjs.com/package/@noelclaw/mcp](https://www.npmjs.com/package/@noelclaw/mcp)
- **GitHub:** [github.com/noelclaw/mcp](https://github.com/noelclaw/mcp)
- **Docs:** [docs.noelclaw.com](https://docs.noelclaw.com)
