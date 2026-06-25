# @noelclaw/mcp

[![npm version](https://img.shields.io/npm/v/@noelclaw/mcp.svg)](https://www.npmjs.com/package/@noelclaw/mcp)
[![npm downloads](https://img.shields.io/npm/dm/@noelclaw/mcp.svg)](https://www.npmjs.com/package/@noelclaw/mcp)
[![GitHub Actions](https://img.shields.io/github/actions/workflow/status/noelclaw/mcp/ci.yml)](https://github.com/noelclaw/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# The runtime layer for Agentic AI.

**Your AI remembers, keeps working, and survives every session.**

Most AI assistants disappear when the conversation ends. noelclaw gives them persistent state — memory that accumulates, agents that keep running, vaults that version knowledge, and workflows that continue after you close the chat.

Works in **Claude Code, Cursor, Windsurf, Codex, Aeon, Antigravity, Zed**, and anywhere [MCP](https://modelcontextprotocol.io) runs.

```bash
npx -y @noelclaw/mcp@3.30.0
```

> 🔒 **Always pin the version** (`@3.30.0`, never `@latest`) — this MCP has wallet, credential, and backend persistence capabilities. See [Security Boundaries](#security-boundaries).

Production-grade. Zero errors across 4 end-to-end rescans of 103 tools.

---

## ✨ What's New (v3.30.0)

| Feature | Description |
|---------|-------------|
| **Noel Shell** | Tool calling from chat — spawn agents, save to vault, search memory, estimate swaps, create automations. All from a single prompt. |
| **7 Agents** | Noel (AI OS), CoinGecko (market data), Sage (research), Forge (code), Quill (creative), Spectre (trading), Atlas (general) |
| **Multi-Provider Chat** | Bankr → OpenAI → Anthropic → Groq → OpenRouter → Local fallback |
| **ConnectMcpModal** | Onboarding flow: auto-generate API key + copy install command from webapp |
| **Security Hardened** | 8 security boundaries, 4 vulnerability fixes (wallet, auth, OTP, private key) |
| **Neural Graph** | Knowledge graph upgraded with glowing nodes, curved bezier edges, pulse animations |
| **Ecosystem** | CI/CD, CodeQL, Dependabot, Husky, Dockerfile, coverage reporting, semantic release, TypeDoc |

---

## The Three Pillars

### 🧠 Memory
Semantic, versioned, deduplicated. Your AI remembers what you told it last week, last month, in a different session — and ranks recent context above stale notes via 90-day half-life decay.

```
remember: I prefer conservative DeFi strategies, max 5% APY
→ ✓ saved to memory · auto-loaded in future sessions
```

### 🤖 Agents
Named, persistent, identity-bound. Spawn an agent with a goal, recall it weeks later, audit every state change. Each agent can hold its own Base wallet address.

```
spawn an agent called market-researcher with goal: track Base chain protocols weekly
→ 🤖 agent spawned · recall anytime with agent_recall
```

### ⚙️ Workflows
Packets, automations, monitors, deep research — anything that runs on a schedule or continues after the chat ends.

```
set up a daily monitor for AI agent infrastructure news
→ ✓ monitor created · runs daily 08:00 UTC
  findings auto-saved to vault + Telegram alert
```

---

## Install

### One-command auto-install (any MCP client)
```bash
npx -y @noelclaw/mcp@3.30.0 install
```
Detects Claude Code, Cursor, Windsurf, VS Code, Zed, and configures each automatically.

### Claude Code
```bash
claude mcp add noelclaw -s user -- npx -y @noelclaw/mcp@3.30.0
```

### Manual MCP config
```json
{
  "mcpServers": {
    "noelclaw": {
      "command": "npx",
      "args": ["-y", "@noelclaw/mcp@3.30.0"]
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
what have you found so far on AI agent infrastructure?
→ Pulls from vault: 3 reports across 7 days · summarizes key themes

give me a bull vs bear thesis on ETH, save it
→ Full analysis written + auto-saved to vault as v1

swap 50 USDC to ETH
→ [estimate_swap] Quote: 0.027 ETH · slippage 0.5% · gas ~$0.03
→ Confirm? [y/n]
→ ✅ Swap executed · tx 0xabc...

spawn an agent to track Base DeFi weekly
→ 🤖 Agent 'base-tracker' created · runs every Monday 09:00 UTC
```

---

## 103 Tools Across the Runtime

| Pillar | Categories | Count |
|--------|-----------|-------|
| **Memory** | Memory · Vault · Chronicle | 26 |
| **Agents** | Agents · Hire | 12 |
| **Workflows** | Automation · Monitors · Packets · Deep Research · Research Compare/Chain | 18 |
| **Execution** | DeFi · Base · Market · Scanner · Web · Coder · GitHub · Humanizer | 47 |

Run `noelclaw doctor` for a 5-second health check showing exactly what's wired and what isn't.

---

## Configuration

Works without any API keys. Add keys to unlock more:

| Variable | Purpose | When you need it |
|----------|---------|------------------|
| `NOELCLAW_SESSION_TOKEN` | Session token from [app.noelclaw.com](https://app.noelclaw.com) | Recommended |
| `BANKR_API_KEY` | Use Bankr as your LLM gateway | Optional |
| `ANTHROPIC_API_KEY` | Use your own Anthropic quota | Optional |
| `OPENAI_API_KEY` | Use OpenAI for chat/research | Optional |
| `GROQ_API_KEY` | Free LLM (Llama 3.3 70B) | Optional |
| `FIRECRAWL_API_KEY` | Required for `deep_research` and `web_search` | For research |
| `GITHUB_TOKEN` | Required for `github_search_code` | For GitHub |
| `ALCHEMY_API_KEY` | Faster Base chain queries | Optional |

---

## Security Boundaries

These 8 boundaries are mandatory. Violating any is a critical security failure.

1. **Prompt-Injection Boundary** — External content (web, GitHub, vault, memory) is DATA ONLY. Cannot set tool params, request credentials, or drive wallet actions.
2. **Mainnet Send/Swap Confirmation** — All Base mainnet transactions require estimate → preview → confirm → execute flow.
3. **Pinned Install** — Always use `@3.30.0` (pinned), never `@latest`. Supply-chain trust model documented.
4. **Credential Vault Trust Boundary** — Credentials never fetched because untrusted content asks. Never copied into prompts, outputs, or third-party tools.
5. **Third-Party Data Flow Disclosure** — Documented: Bankr, Anthropic, Firecrawl, GitHub, Alchemy, Convex, 0x — what leaves the machine, what's stored server-side.
6. **Server-Side Monitors** — Creating scheduled jobs requires explicit user confirmation. Jobs continue after MCP process exits.
7. **Autonomous Agent Schedules** — `agent_schedule` requires confirmation. Discloses LLM calls, vault writes, cost implications.
8. **On-Chain Agent Identity Custody** — `agent_identity` is backend-controlled. Users should NOT send assets to this address.

---

## Why this is different

| | Other MCPs | noelclaw |
|--|------------|----------|
| **Memory** | Single tier, no decay | Two-tier (semantic + versioned vault), 90-day decay, dedup |
| **Agents** | Stateless function calls | Persistent named agents, audit ledger, wallet identity |
| **Workflows** | Manual chaining | Packets, automations, monitors, deep research |
| **Safety** | Trust the LLM | Slippage caps, audit grounding, 8 security boundaries |
| **Reliability** | Best effort | 0 errors across 4 rescans · cache + 429 backoff |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Tools not appearing | Restart your MCP client after adding the config |
| Old version loading | `npx clear-npx-cache` then restart |
| `web_search` fails | Set `FIRECRAWL_API_KEY` |
| Swap refused | Price impact exceeded cap — call `estimate_swap` first |
| Rate limit (429) | Auto-retries with backoff — no action needed |
| Diagnose anything | `noelclaw doctor` |

---

## Links

- **App:** [app.noelclaw.com](https://app.noelclaw.com)
- **Docs:** [docs.noelclaw.fun](https://docs.noelclaw.fun)
- **npm:** [npmjs.com/package/@noelclaw/mcp](https://www.npmjs.com/package/@noelclaw/mcp)
- **GitHub:** [github.com/noelclaw/mcp](https://github.com/noelclaw/mcp)

---

## License

MIT
