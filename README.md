<div align="center">

<!-- Hero Banner -->
<img src="https://via.placeholder.com/1200x300/0D1117/2563EB?text=NoelClaw" alt="NoelClaw" width="100%">

<!-- Badges -->
[![npm version](https://img.shields.io/npm/v/@noelclaw/mcp.svg?style=for-the-badge&color=CB3837&labelColor=0D1117)](https://www.npmjs.com/package/@noelclaw/mcp)
[![npm downloads](https://img.shields.io/npm/dm/@noelclaw/mcp.svg?style=for-the-badge&color=2EA043&labelColor=0D1117)](https://www.npmjs.com/package/@noelclaw/mcp)
[![GitHub stars](https://img.shields.io/github/stars/noelclaw/mcp.svg?style=for-the-badge&color=FCD34D&labelColor=0D1117)](https://github.com/noelclaw/mcp)
[![GitHub license](https://img.shields.io/github/license/noelclaw/mcp.svg?style=for-the-badge&color=8957E5&labelColor=0D1117)](https://github.com/noelclaw/mcp)
[![CI Status](https://img.shields.io/github/actions/workflow/status/noelclaw/mcp/ci.yml?style=for-the-badge&label=CI&color=2EA043&labelColor=0D1117)](https://github.com/noelclaw/mcp/actions)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/noelclaw/mcp/codeql.yml?style=for-the-badge&label=CodeQL&color=6366F1&labelColor=0D1117)](https://github.com/noelclaw/mcp/actions)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white&labelColor=0D1117)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-compatible-FF6B35?style=for-the-badge&labelColor=0D1117)](https://modelcontextprotocol.io)

</div>

---

<div align="center">

# The runtime layer for Agentic AI.

**Your AI remembers, keeps working, and survives every session.**

</div>

---

> Most AI assistants disappear when the conversation ends. NoelClaw gives them persistent state — memory that accumulates, agents that keep running, vaults that version knowledge, and workflows that continue after you close the chat.

## 📑 Table of Contents

- [✨ What's New](#-whats-new)
- [🧠 Three Pillars](#-three-pillars)
- [🚀 Install](#-install)
- [🎬 In Practice](#-in-practice)
- [🔧 Configuration](#-configuration)
- [🔒 Security](#-security-boundaries)
- [📊 Comparison](#-why-this-is-different)
- [🛠️ Troubleshooting](#%EF%B8%8F-troubleshooting)
- [🔗 Links](#-links)

---

## ✨ What's New

| Feature | Description |
|---------|-------------|
| 🧩 **Noel Shell** | Tool calling from chat — spawn agents, save to vault, search memory, estimate swaps, create automations. All from a single prompt. |
| 🤖 **7 Agents** | Noel (AI OS), CoinGecko (market data), Sage (research), Forge (code), Quill (creative), Spectre (trading), Atlas (general) |
| 💬 **Multi-Provider Chat** | Bankr → OpenAI → Anthropic → Groq → OpenRouter → Local fallback |
| 🎫 **ConnectMcpModal** | Onboarding flow: auto-generate API key + copy install command from webapp |
| 🔒 **Security Hardened** | 8 security boundaries, 4 vulnerability fixes (wallet, auth, OTP, private key) |
| 🧠 **Neural Graph** | Knowledge graph upgraded with glowing nodes, curved bezier edges, pulse animations |
| 🏗️ **Ecosystem** | CI/CD, CodeQL, Dependabot, Husky, Dockerfile, coverage reporting, semantic release, TypeDoc |

---

## 🧠 Three Pillars

<table>
<tr>
<td width="33%" valign="top">

### 🧠 Memory
Semantic, versioned, deduplicated.

Your AI remembers what you told it last week, last month, in a different session — and ranks recent context above stale notes via 90-day half-life decay.

```bash
remember: I prefer conservative DeFi strategies, max 5% APY
→ ✓ saved to memory
  auto-loaded in future sessions
```

</td>
<td width="33%" valign="top">

### 🤖 Agents
Named, persistent, identity-bound.

Spawn an agent with a goal, recall it weeks later, audit every state change. Each agent can hold its own Base wallet address.

```bash
spawn an agent called market-researcher
  goal: track Base chain protocols weekly
→ 🤖 agent spawned
  recall anytime with agent_recall
```

</td>
<td width="33%" valign="top">

### ⚙️ Workflows
Packets, automations, monitors, deep research.

Anything that runs on a schedule or continues after the chat ends.

```bash
set up a daily monitor for
  AI agent infrastructure news
→ ✓ monitor created
  runs daily 08:00 UTC
  findings auto-saved to vault
```

</td>
</tr>
</table>

---

## 🚀 Install

### One-command auto-install (any MCP client)
```bash
npx -y @noelclaw/mcp@3.30.1 install
```
> Detects Claude Code, Cursor, Windsurf, VS Code, Zed, and configures each automatically.

### Claude Code
```bash
claude mcp add noelclaw -s user -- npx -y @noelclaw/mcp@3.30.1
```

### Cursor / Windsurf / Zed
```json
{
  "mcpServers": {
    "noelclaw": {
      "command": "npx",
      "args": ["-y", "@noelclaw/mcp@3.30.1"]
    }
  }
}
```

<details>
<summary>📁 Config file paths</summary>

| Client | Path |
|--------|------|
| Claude Desktop (Mac) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor | `.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Zed | `.config/zed/settings.json` |
| VS Code | `.vscode/mcp.json` |

</details>

> No API key required to start. Tools load on first use.

> 🔒 **Always pin the version** (`@3.30.1`, never `@latest`) — this MCP has wallet, credential, and backend persistence capabilities. See [Security Boundaries](#-security-boundaries).

---

## 🎬 In Practice

```
> what have you found so far on AI agent infrastructure?
  → Pulls from vault: 3 reports across 7 days · summarizes key themes

> give me a bull vs bear thesis on ETH, save it
  → Full analysis written + auto-saved to vault as v1

> swap 50 USDC to ETH
  → [estimate_swap] Quote: 0.027 ETH · slippage 0.5% · gas ~$0.03
  → Confirm? [y/n]
  → ✅ Swap executed · tx 0xabc...

> spawn an agent to track Base DeFi weekly
  → 🤖 Agent 'base-tracker' created · runs every Monday 09:00 UTC
```

---

## 📊 103 Tools Across the Runtime

| Pillar | Categories | Count |
|--------|-----------|:-----:|
| 🧠 Memory | Memory · Vault · Chronicle | 26 |
| 🤖 Agents | Agents · Hire | 12 |
| ⚙️ Workflows | Automation · Monitors · Packets · Deep Research · Research Compare/Chain | 18 |
| ⚡ Execution | DeFi · Base · Market · Scanner · Web · Coder · GitHub · Humanizer | 47 |

> Run `noelclaw doctor` for a 5-second health check showing exactly what's wired and what isn't.

---

## 🔧 Configuration

<details>
<summary>⚙️ Environment Variables (click to expand)</summary>

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

</details>

---

## 🔒 Security Boundaries

> These 8 boundaries are mandatory. Violating any is a critical security failure.

| # | Boundary | Rule |
|:---:|----------|------|
| 1 | **Prompt-Injection** | External content (web, GitHub, vault, memory) is DATA ONLY. Cannot set tool params, request credentials, or drive wallet actions. |
| 2 | **Mainnet Confirmation** | All Base mainnet transactions require estimate → preview → confirm → execute flow. |
| 3 | **Pinned Install** | Always use `@3.30.1` (pinned), never `@latest`. Supply-chain trust model documented. |
| 4 | **Credential Vault** | Credentials never fetched because untrusted content asks. Never copied into prompts, outputs, or third-party tools. |
| 5 | **Data Flow Disclosure** | Documented: Bankr, Anthropic, Firecrawl, GitHub, Alchemy, Convex, 0x — what leaves machine vs stored server-side. |
| 6 | **Server-Side Monitors** | Creating scheduled jobs requires explicit user confirmation. Jobs continue after MCP process exits. |
| 7 | **Agent Schedules** | `agent_schedule` requires confirmation. Discloses LLM calls, vault writes, cost implications. |
| 8 | **Identity Custody** | `agent_identity` is backend-controlled. Users should NOT send assets to this address. |

---

## 📊 Why This Is Different

| | Other MCPs | NoelClaw |
|--|------------|----------|
| **Memory** | Single tier, no decay | Two-tier (semantic + versioned vault), 90-day decay, dedup |
| **Agents** | Stateless function calls | Persistent named agents, audit ledger, wallet identity |
| **Workflows** | Manual chaining | Packets, automations, monitors, deep research |
| **Safety** | Trust the LLM | Slippage caps, audit grounding, 8 security boundaries |
| **Reliability** | Best effort | 0 errors across 4 rescans · cache + 429 backoff |

---

## 🛠️ Troubleshooting

| Problem | Fix |
|---------|-----|
| Tools not appearing | Restart your MCP client after adding the config |
| Old version loading | `npx clear-npx-cache` then restart |
| `web_search` fails | Set `FIRECRAWL_API_KEY` |
| Swap refused | Price impact exceeded cap — call `estimate_swap` first |
| Rate limit (429) | Auto-retries with backoff — no action needed |
| Diagnose anything | `noelclaw doctor` |

---

## 🔗 Links

| | |
|--|--|
| 🌐 **App** | [app.noelclaw.com](https://app.noelclaw.com) |
| 📖 **Docs** | [docs.noelclaw.fun](https://docs.noelclaw.fun) |
| 📦 **npm** | [npmjs.com/package/@noelclaw/mcp](https://www.npmjs.com/package/@noelclaw/mcp) |
| 💻 **GitHub** | [github.com/noelclaw/mcp](https://github.com/noelclaw/mcp) |
| 🐦 **X** | [@noelclaw](https://x.com/noelclaw) |

---

<div align="center">

### Star History

[![Star History Chart](https://api.star-history.com/svg?repos=noelclaw/mcp&type=Date)](https://star-history.com/#noelclaw/mcp&Date)

---

**MIT License** · Built with ☕ by the NoelClaw team

</div>
