# Contributing to @noelclaw/mcp

Thanks for your interest in contributing! This guide covers the dev setup, code
style, commit conventions, and PR checklist for the NoelClaw MCP server.

This repository (`mcp-server/`) is a **separate git repo** from `app/`.
Commit and open PRs against `mcp-server/` directly.

## Prerequisites

- **Node.js 20** (LTS). The repo ships an `.nvmrc`; run `nvm use` if you use
  nvm, or install Node 20 via your preferred manager.
- **npm** (bundled with Node 20).
- Git.

## Development setup

```bash
# clone
git clone https://github.com/noelclaw/mcp.git
cd mcp

# use the right Node version
nvm use          # reads .nvmrc (Node 20)

# install dependencies (also installs Husky git hooks via `prepare`)
npm install

# build to dist/
npm run build

# type-check without emitting
npx tsc --noEmit

# run in dev mode (ts-node, no build step)
npm run dev
```

After `npm install`, the `prepare` script installs Husky git hooks. The
`pre-commit` hook runs `lint-staged`, which runs ESLint with `--fix` on staged
`*.ts` / `*.tsx` files.

## Project layout

```
src/
  index.ts          # entry point → dist/index.js
  cli.ts            # noelclaw CLI → dist/cli.js
  server.ts         # MCP server + tool registration
  config.ts         # env + config loading
  llm.ts            # LLM provider routing (Bankr → Anthropic)
  convex.ts         # Convex API client
  tools/            # one file per tool category (memory, vault, defi, …)
dist/               # compiled output (gitignored)
```

## Code style

- **TypeScript strict mode** is on. New code must type-check under
  `npx tsc --noEmit`.
- Prefer **no `any`**. Use `@typescript-eslint/no-explicit-any` as a guide —
  `unknown` with a type guard or a proper interface is preferred. If `any` is
  genuinely unavoidable, add an inline `// eslint-disable-next-line` with a
  short justification.
- Use **named exports**; avoid `export default` for tool modules.
- Keep tool implementations in `src/tools/<category>.ts`; register them in
  `src/server.ts`.
- External HTTP calls must go through the shared HTTP cache helper and include
  **429 backoff** — do not write raw `fetch` without retry handling.

## Commit convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<optional body>

<optional footer>
```

Common types:

| Type     | When to use                                   |
|----------|-----------------------------------------------|
| `feat`   | A new tool or user-facing capability          |
| `fix`    | A bug fix                                     |
| `docs`   | Documentation only (README, CHANGELOG)        |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`   | Performance improvement                       |
| `test`   | Adding or correcting tests                    |
| `chore`  | Build, deps, tooling                          |
| `ci`     | CI/CD changes                                 |
| `security` | Security-relevant hardening                 |

Scope examples: `feat(memory): add memory_decay tool`,
`fix(defi): cap slippage on 0x swaps`.

## Testing

- TypeScript is the **primary correctness check** — run `npx tsc --noEmit`
  before pushing.
- Where unit tests exist, run them with `npm test`.
- For tool changes, do an end-to-end rescan (`noelclaw doctor` + invoking the
  affected tool) to confirm zero errors, matching the project's "0 errors across
  rescans" guarantee.
- If you add a new tool, document it in the README tool table and CHANGELOG.

## Pull request checklist

Before opening a PR, confirm:

- [ ] `npm run build` succeeds
- [ ] `npx tsc --noEmit` passes with no errors
- [ ] `npm test` passes (if tests exist)
- [ ] ESLint passes on changed files (`npx eslint src/`)
- [ ] No new `any` types without justification
- [ ] Commit messages follow Conventional Commits
- [ ] CHANGELOG.md updated under `## [Unreleased]` if user-facing
- [ ] If a new tool was added: registered in `src/server.ts`, documented in
      README, and added to the tool count
- [ ] No secrets, API keys, or private tokens committed

## Opening a PR

1. Fork the repo and create a branch from `main`:
   `git checkout -b feat/your-feature`.
2. Make your changes, committing with Conventional Commits.
3. Push and open a PR against `main` with a clear description and link to any
   related issue.
4. CI (build, type-check, test) must pass before review.

## Reporting security issues

See [SECURITY.md](./SECURITY.md) — report vulnerabilities privately to
security@noelclaw.com, **not** via public issues.
