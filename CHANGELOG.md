# Changelog

All notable changes to the **@noelclaw/mcp** package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.29.0] - 2026-06-24

The runtime layer for Agentic AI. Persistent memory, autonomous agents, vault
storage, and scheduled workflows — for Claude Code, Cursor, Windsurf, Codex,
Aeon, Antigravity, and any MCP-compatible client.

### Added

- **103 MCP tools** across the runtime, verified with zero errors across four
  end-to-end rescans. Tools span memory, vault, chronicle, agents, automation,
  monitors, packets, deep research, DeFi, Base, market, scanner, web, coder,
  github, and humanizer categories.
- **PWA** support for the NoelClaw web app — installable, offline-capable, with
  background sync for agent state.
- **Deep research multi-agent synthesis** — `deep_research` now orchestrates
  multiple specialist agents, each producing a sub-report, then synthesizes a
  single grounded report with citations. Compare and chain modes
  (`research_compare`, `research_chain`) build on the same pipeline.
- **90-day memory decay** — memories use a 90-day half-life so recent context
  ranks above stale notes during semantic `memory_search` and
  `memory_context` retrieval. Older entries are down-ranked, not deleted.
- `noelclaw doctor` — five-second health check showing exactly what is wired and
  what is missing (API keys, session token, RPC, tool palette).
- `noelclaw install` — one-command auto-install that detects Claude Code,
  Cursor, Windsurf, VS Code, and Zed and configures each automatically.
- Tool palette via `NOELCLAW_TOOLS`: `all` (103), `core` (~40), `defi`,
  `research`, `memory`.

### Changed

- **Bundle splitting** — the web app `vite.config.ts` now uses `manualChunks`
  to split out `vendor-phaser`, `vendor-privy`, `vendor-convex`,
  `vendor-motion`, `vendor-icons`, `vendor-radix`, and `vendor-react`,
  reducing the main bundle and improving cache hit rates.
- **React 19 upgrade** — the web app and all shared UI moved to React 19,
  including the newer `use()` hook and concurrent rendering for chat streams.
- HTTP cache + 429 backoff on every external call for reliability across
  long-running agent loops.
- `prepare` script now installs Husky git hooks; `prepublishOnly` still builds
  before npm publish.

### Security

- **Slippage caps** — swap tools refuse trades whose price impact exceeds the
  configured cap. Users can override with an explicit `maxPriceImpactPct`, but
  the default refuses bad fills rather than trusting the LLM.
- **Audit grounding** — contract scanner refuses to act on contracts flagged as
  unsafe by audit data, surfacing the findings instead of executing.
- **Prompt-injection boundary** — tool inputs from untrusted sources (web
  pages, research content, contract metadata) are treated as data, not
  instructions; they never enter the system prompt and cannot change tool
  routing or spawn unsanctioned agents.
- Wallets continue to use AES-256-CBC encryption for private keys at rest;
  sessions use server-issued tokens; passwords use bcrypt.

## [3.28.0] - 2026-05-01

- Maintenance release: dependency bumps, minor tool refinements.
  See git history for details.

[Unreleased]: https://github.com/noelclaw/mcp/compare/v3.29.0...HEAD
[3.29.0]: https://github.com/noelclaw/mcp/releases/tag/v3.29.0
[3.28.0]: https://github.com/noelclaw/mcp/releases/tag/v3.28.0
