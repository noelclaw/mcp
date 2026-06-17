# @noelclaw/mcp

[![npm version](https://img.shields.io/npm/v/@noelclaw/mcp.svg)](https://www.npmjs.com/package/@noelclaw/mcp)
[![npm downloads](https://img.shields.io/npm/dm/@noelclaw/mcp.svg)](https://www.npmjs.com/package/@noelclaw/mcp)

# The runtime layer for Agentic AI.

**Your AI remembers, keeps working, and survives every session.**

Most AI assistants disappear when the conversation ends. noelclaw gives them persistent state - memory that accumulates, agents that keep running, vaults that version knowledge, and workflows that continue after you close the chat.

Works in **Claude Code, Cursor, Windsurf, Codex, Aeon, Antigravity, Zed**, and anywhere [MCP](https://modelcontextprotocol.io) runs.

```bash
npx -y @noelclaw/mcp
```

Production-grade. Zero errors across 4 end-to-end rescans of 103 tools.

---

## The three pillars

### 🧠 Memory
Semantic, versioned, deduplicated. Your AI remembers what you told it last week, last month, in a different session - and ranks recent context above stale notes via 90-day half-life decay.

```
memory_add content="prefer conservative DeFi strategies, max 5% APY"
memory_search query="risk tolerance"   → semantic, not keyword
memory_context topic="investment preferences"
```

### 🤖 Agents
Named, persistent, identity-bound. Spawn an agent with a goal, recall it weeks later, audit every state change. Each agent can hold its own Base wallet address.

```
agent_spawn name="market-researcher" goal="track Base chain protocols weekly"
agent_recall name="market-researcher"
agent_update name="market-researcher" progress="found 3 new protocols"
agent_ledger name="market-researcher"   → full audit trail
```

### ⚙️ Workflows
Packets, automations, monitors, deep research - anything that runs on a schedule or continues after the chat ends.

```
schedule_research topic="AI agent infrastructure" schedule="daily"
create_automation rawInput="DCA 50 USDC into ETH every Monday"
packet_create name="morning-brief" steps=[...]
deep_research query="State of AI agent runtimes in 2026" depth="deep"
```

---

## Install

### One-command auto-install (any MCP client)
```bash
npx -y @noelclaw/mcp install
```
Detects Claude Code, Cursor, Windsurf, VS Code, Zed, and configures each automatically.

### Claude Code
```bash
claude mcp add noelclaw -s user -- npx -y @noelclaw/mcp
```

### Manual MCP config
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

Config file paths:
- **Claude Desktop (Mac):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`
- **Cursor / Windsurf / Zed:** `.cursor/mcp.json` / `.windsurf/mcp.json` / `.config/zed/settings.json`

No API key required to start. Tools load on first use.

---

## What it looks like in practice

```
remember: I prefer conservative DeFi strategies, max 5% APY targets
→ ✓ saved to memory · auto-loaded in future sessions

set up a daily monitor for AI agent infrastructure news
→ ✓ monitor created · runs daily 08:00 UTC
  findings auto-saved to vault + Telegram alert

what have you found so far on AI agent infrastructure?
→ Pulls from vault: 3 reports across 7 days · summarizes key themes

spawn an agent called market-researcher with goal: track Base chain protocols weekly
→ 🤖 agent spawned · recall anytime with agent_recall

what's the ETH yield situation on Base right now?
→ Clearstar USDC Reactor: 7.57% APY · Moonwell Flagship: 4.63% APY

give me a bull vs bear thesis on ETH, save it
→ Full analysis written + auto-saved to vault as v1
```

---

## 103 tools across the runtime

| Pillar | Categories | Count |
|--------|-----------|-------|
| **Memory** | Memory · Vault · Chronicle | 26 |
| **Agents** | Agents · Hire | 12 |
| **Workflows** | Automation · Monitors · Packets · Deep Research · Research Compare/Chain | 18 |
| **Execution domains** | DeFi · Base · Market · Scanner · Web · Coder · GitHub · Humanizer | 47 |

Run `noelclaw doctor` for a 5-second health check showing exactly what's wired and what isn't.

---

## Configuration

Works without any API keys. Add keys to unlock more:

| Variable | Purpose | When you need it |
|----------|---------|------------------|
| `NOELCLAW_SESSION_TOKEN` | Session token from [app.noelclaw.com](https://app.noelclaw.com) - unlocks all tools | Recommended |
| `BANKR_API_KEY` | Use Bankr as your LLM gateway | Optional |
| `ANTHROPIC_API_KEY` | Use your own Anthropic quota | Optional |
| `NOELCLAW_MODEL` | Override AI model | Optional |
| `NOELCLAW_TOOLS` | Tool palette: `all` (103), `core` (~40), `defi`, `research`, `memory` | Optional |
| `NOELCLAW_BROADCAST_RPC` | Private/MEV-protected RPC for tx broadcast | Belt-and-suspenders |
| `NOELCLAW_HUMANIZER_MODEL` | Pin a specific model for `humanize_text` / `write_content` | Optional |
| `FIRECRAWL_API_KEY` | Required for `deep_research` and `web_search` | For research |
| `TRIGGER_SECRET_KEY` | Required for `schedule_research` / `create_monitor` | For monitors |
| `GITHUB_TOKEN` | Required for `github_search_code` and private repos | For GitHub |
| `ALCHEMY_API_KEY` | Faster Base chain queries | Optional |

---

## Why this is different

| | Other MCPs | noelclaw |
|--|------------|----------|
| **Memory** | Single tier, no decay | Two-tier (semantic + versioned vault), 90-day decay, dedup, retry-on-sync-failure |
| **Agents** | Stateless function calls | Persistent named agents, audit ledger, optional wallet identity |
| **Workflows** | Manual chaining | Packets, automations, monitors, deep research with multi-agent synthesis |
| **Safety** | Trust the LLM | Slippage caps refuse bad trades, audit grounding refuses unsafe contracts |
| **Reliability** | Best effort | 0 errors across 4 end-to-end rescans · cache + 429 backoff on every external call |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Tools not appearing | Restart your MCP client after adding the config |
| Old version loading | `npx clear-npx-cache` then restart |
| `web_search` fails | Set `FIRECRAWL_API_KEY` |
| `schedule_research` fails | Set `TRIGGER_SECRET_KEY` |
| Swap refused | Price impact exceeded cap - pass `maxPriceImpactPct: <higher>` to override |
| Rate limit (429) | Auto-retries with backoff - no action needed |
| Diagnose anything | `noelclaw doctor` |

---

## Links

- **App:** [app.noelclaw.com](https://app.noelclaw.com)
- **Docs:** [docs.noelclaw.fun](https://docs.noelclaw.fun)
- **npm:** [npmjs.com/package/@noelclaw/mcp](https://www.npmjs.com/package/@noelclaw/mcp)
- **GitHub:** [github.com/noelclaw/mcp](https://github.com/noelclaw/mcp)
