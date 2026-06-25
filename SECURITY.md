# Security Policy

The NoelClaw team takes security seriously. We appreciate the community's
efforts in responsibly disclosing vulnerabilities. This policy describes how to
report issues, what is in scope, and the protections we have in place.

## Supported Versions

Security updates are applied to the latest published version of
`@noelclaw/mcp` on npm. Please update to the latest version before reporting.

| Version | Supported          |
|---------|--------------------|
| 3.29.x  | :white_check_mark: |
| < 3.29  | :x:                |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Please report suspected vulnerabilities privately to
**security@noelclaw.com** with the following information:

1. A description of the issue and its potential impact.
2. The affected component (MCP server, webapp, Convex backend — see Scope).
3. Step-by-step reproduction, including any payloads, configs, or environment
   details needed to trigger the issue.
4. Your assessment of severity and any suggested mitigations.

You will receive an acknowledgement within **48 hours**. We will keep you
informed of our investigation progress and coordinate public disclosure once a
fix is available. Please give us reasonable time to remediate before any public
disclosure (we aim for 90 days, and will collaborate with you on timing).

We do not offer monetary bounties at this time, but responsible reporters will
be credited in the release notes and CHANGELOG unless they prefer to remain
anonymous.

## Scope

### In scope

- **MCP server** (`@noelclaw/mcp`) — the published npm package, the `noelclaw`
  CLI, tool implementations, and the tool routing layer (`src/server.ts`,
  `src/tools/*`).
- **Webapp** — the React frontend at [app.noelclaw.com](https://app.noelclaw.com)
  and any NoelClaw-served assets.
- **Convex backend** — serverless functions, HTTP routes (`convex/http.ts`),
  schema (`convex/schema.ts`), auth actions (`convex/authActions.ts`), and
  cron jobs (`convex/crons.ts`).
- **Cloudflare API proxy** — the Worker that rate-limits and proxies
  Alchemy/0x calls.

### Out of scope

- Vulnerabilities in third-party dependencies that are already publicly
  disclosed and tracked via GitHub Security Advisories / Dependabot — report
  those upstream.
- Issues that require social engineering of NoelClaw staff or users.
- Self-XSS or clickjacking that only affects the reporter's own session.
- Findings from automated scanners without a demonstrated, reproducible impact.

## Security Measures

The following protections are in place across the stack:

### Cryptography & secrets

- **AES-256-CBC** encryption for custodial wallet private keys at rest. Keys are
  encrypted with `WALLET_ENCRYPTION_KEY` before storage and decrypted only
  inside `"use node"` Convex actions at signing time.
- **Session tokens** — auth (Privy OAuth, email OTP, and API key) ultimately
  produces a 64-character hex session token. Tokens are validated server-side
  via `checkMcpAuth()` on every HTTP route.
- **bcrypt** password-style hashing for credentials and API key validation
  (`noel_sk_*` keys are validated by SHA-256 hash, never stored in cleartext).

### DeFi safety

- **Slippage caps** — swaps refuse fills whose price impact exceeds the
  configured cap. The default refuses bad trades rather than trusting the LLM;
  callers can pass an explicit `maxPriceImpactPct` to override.
- **Audit grounding** — the contract scanner refuses to act on contracts
  flagged as unsafe by audit data, surfacing findings instead of executing.

### Agent & prompt safety

- **Prompt-injection boundary** — untrusted tool inputs (web pages, research
  content, contract metadata) are treated strictly as data. They never enter
  the system prompt and cannot alter tool routing, spawn unsanctioned agents,
  or change memory/vault writes.
- **Append-only chronicle** — agent state changes and audit-relevant events are
  written to an append-only `chronicle` log for non-repudiation.

### Transport & infrastructure

- HTTPS for all client↔server and server↔provider traffic.
- Rate limiting and 429 backoff on every external call.
- Cloudflare proxy in front of Alchemy/0x for rate limiting and key isolation.
- Environment secrets (encryption keys, API keys) are stored in the Convex
  dashboard secrets store, never committed to source.

## Disclosure Timeline

| Step | Action | Target |
|------|--------|--------|
| 1 | Acknowledge receipt of report | 48 hours |
| 2 | Triage and confirm/deny the issue | 5 business days |
| 3 | Develop and ship a fix | 90 days (coordinated) |
| 4 | Publish advisory + credit reporter | At fix release |

## Contact

- Security reports: **security@noelclaw.com**
- General questions: [github.com/noelclaw/mcp/issues](https://github.com/noelclaw/mcp/issues)
