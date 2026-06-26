#!/usr/bin/env node
import { startServer, ALL_TOOLS } from "./server.js";
import { getOrCreateWallet } from "./wallet.js";
import { getSavedToken, writeConfig } from "./config.js";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";

// Always read the version from package.json so banner + boot strings stay in
// sync after every npm publish - no more hand-edits in three places.
const PKG_VERSION: string = (() => {
  try {
    // dist/index.js → ../package.json (CJS so __dirname is available)
    const raw = fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
})();

// â”€â”€ ANSI helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const C = {
  cyan:   "\x1b[36m",
  dim:    "\x1b[90m",
  white:  "\x1b[97m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
};

const BANNER = `
${C.cyan}
  â–ˆâ–ˆâ–ˆâ•-   â–ˆâ–ˆâ•- â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•- â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•-â–ˆâ–ˆâ•-      â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•-â–ˆâ–ˆâ•-      â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•- â–ˆâ–ˆâ•-    â–ˆâ–ˆâ•-
  â–ˆâ–ˆâ–ˆâ–ˆâ•-  â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•”â•â•â•â–ˆâ–ˆâ•-â–ˆâ–ˆâ•”â•â•â•â•â•â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•”â•â•â•â•â•â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•-â–ˆâ–ˆâ•‘    â–ˆâ–ˆâ•‘
  â–ˆâ–ˆâ•”â–ˆâ–ˆâ•- â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•‘â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•-  â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘ â–ˆâ•- â–ˆâ–ˆâ•‘
  â–ˆâ–ˆâ•‘â•šâ–ˆâ–ˆâ•-â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•”â•â•â•  â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘â–ˆâ–ˆâ–ˆâ•-â–ˆâ–ˆâ•‘
  â–ˆâ–ˆâ•‘ â•šâ–ˆâ–ˆâ–ˆâ–ˆâ•‘â•šâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•”â•â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•-â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•-â•šâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•-â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•-â–ˆâ–ˆâ•‘  â–ˆâ–ˆâ•‘â•šâ–ˆâ–ˆâ–ˆâ•”â–ˆâ–ˆâ–ˆâ•”â•
  â•šâ•â•  â•šâ•â•â•â• â•šâ•â•â•â•â•â• â•šâ•â•â•â•â•â•â•â•šâ•â•â•â•â•â•â• â•šâ•â•â•â•â•â•â•šâ•â•â•â•â•â•â•â•šâ•â•  â•šâ•â• â•šâ•â•â•â•šâ•â•â•
${C.reset}`;

function line(label: string, value: string, color = C.cyan) {
  const pad = " ".repeat(Math.max(0, 12 - label.length));
  process.stderr.write(`  ${color}â-† ${label}${C.reset}${pad}${value}\n`);
}

function divider() {
  process.stderr.write(`  ${C.dim}${"â”€".repeat(58)}${C.reset}\n`);
}

async function checkForUpdate(current: string): Promise<void> {
  try {
    const res = await fetch("https://registry.npmjs.org/@noelclaw/mcp/latest", {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return;
    const data = await res.json() as { version?: string };
    const latest = data.version;
    if (!latest || latest === current) return;
    // Show update notice to stderr - visible in Claude Desktop logs and terminal
    process.stderr.write(
      `\n  ${C.yellow}â•"â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•-${C.reset}\n` +
      `  ${C.yellow}â•'${C.reset}  ðŸ"¦  Update available: ${C.yellow}v${current}${C.reset} â†' ${C.cyan}v${latest}${C.reset}                         ${C.yellow}â•'${C.reset}\n` +
      `  ${C.yellow}â•'${C.reset}  Run: ${C.cyan}npx @noelclaw/mcp@latest${C.reset} to get the latest tools     ${C.yellow}â•'${C.reset}\n` +
      `  ${C.yellow}â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•${C.reset}\n\n`
    );
  } catch {
    // Non-blocking - silently ignore network errors
  }
}

async function main() {
  process.stderr.write(BANNER);

  // ── Tool category groups derived from ALL_TOOLS ────────────────────────────
  // Categories are matched by prefix/name pattern against the actual tool
  // registry. Counts and "tools" strings are computed live, so adding or
  // removing a tool can never desync the banner from reality.
  type CatRule = { label: string; match: (name: string) => boolean };
  const CAT_RULES: CatRule[] = [
    { label: "Market",     match: n => /^(get_market_data|get_token_data|compare_tokens|market_overview|token_history)$/.test(n) },
    { label: "Insight",    match: n => /^(ask_noel|market_thesis|trade_plan)$/.test(n) },
    { label: "DeFi",       match: n => n === "get_defi_yields" },
    { label: "Base MCP",   match: n => n.startsWith("base_mcp_") },
    { label: "Automation", match: n => /^(create_automation|list_automations|pause_automation|delete_automation|get_automation_runs|run_automation)$/.test(n) },
    { label: "Framework",  match: n => /^(list_playbooks|run_playbook|get_noel_ledger)$/.test(n) },
    { label: "Vault",      match: n => n.startsWith("vault_") },
    { label: "Wallet",     match: n => /^(get_wallet_address|set_telegram)$/.test(n) },
    { label: "MiroShark",  match: n => n.startsWith("miroshark_") },
    { label: "Scanner",    match: n => /^(scan_market|score_token|check_token)$/.test(n) },
    { label: "Agents",     match: n => n.startsWith("agent_") || n === "list_agents" || n === "hire_agent" },
    { label: "Social",     match: n => /^(humanize_text|write_content)$/.test(n) },
    { label: "Coder",      match: n => /^(generate_contract|audit_contract|explain_code|review_code|generate_mcp_skill)$/.test(n) },
    { label: "Base",       match: n => /^(query_vaults|list_markets|prepare_deposit|chain_stats)$/.test(n) },
    { label: "Memory",     match: n => n.startsWith("memory_") },
    { label: "OS",         match: n => n === "noel_status" },
    { label: "Research",   match: n => /^(web_scrape|web_search|deep_research|research_compare|research_chain)$/.test(n) },
    { label: "Monitor",    match: n => /^(schedule_research|create_monitor|list_monitors|cancel_monitor)$/.test(n) },
    { label: "GitHub",     match: n => n.startsWith("github_") },
    { label: "Chronicle",  match: n => n.startsWith("chronicle_") },
    { label: "Packets",    match: n => n.startsWith("packet_") },
  ];

  const categories = CAT_RULES
    .map(rule => {
      const names = ALL_TOOLS.map(t => t.name).filter(rule.match);
      return { label: rule.label, count: names.length, tools: names.join(" · ") };
    })
    .filter(c => c.count > 0);

  const total = ALL_TOOLS.length;

  divider();
  process.stderr.write(`\n`);

  const model   = process.env.NOELCLAW_MODEL ?? "claude-haiku-4-5-20251001";
  const aiMode  = process.env.BANKR_API_KEY
    ? `Bankr  ${C.dim}${model}${C.reset}`
    : process.env.ANTHROPIC_API_KEY
    ? `Anthropic  ${C.dim}${model}${C.reset}`
    : `Noelclaw  ${C.dim}proxy Â· auto-auth${C.reset}`;

  line("version", `v${PKG_VERSION}  ${C.dim}MCP protocol 2.1.0${C.reset}`);
  line("ai",       aiMode);
  line("tools",    `${C.white}${C.bold}${total} tools loaded${C.reset}  ${C.dim}across ${categories.length} categories${C.reset}`);

  process.stderr.write(`\n`);
  divider();
  process.stderr.write(`\n`);

  // â”€â”€ Categories grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  for (const cat of categories) {
    const countStr = `${cat.count}`.padStart(2);
    process.stderr.write(
      `  ${C.dim}â”‚${C.reset} ${C.cyan}${cat.label.padEnd(11)}${C.reset} ${C.dim}${countStr}x${C.reset}  ${C.dim}${cat.tools}${C.reset}\n`
    );
  }

  process.stderr.write(`\n`);
  divider();

  // â”€â”€ Wallet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  await startServer();

  const hasAuth = !!getSavedToken();

  try {
    const wallet = await getOrCreateWallet();
    process.stderr.write(`\n`);
    line("wallet",  wallet.address);
    if (hasAuth) {
      line("auth",   `${C.green}signed in${C.reset}  ${C.dim}all ${ALL_TOOLS.length} tools unlocked${C.reset}`, C.green);
    } else {
      line("auth",   `${C.yellow}not signed in${C.reset}  ${C.dim}run 'noelclaw login' to unlock premium tools${C.reset}`, C.yellow);
    }
    line("status",  `${C.green}ready${C.reset}  ${C.dim}waiting for MCP client...${C.reset}`, C.green);
    process.stderr.write(`\n`);
  } catch {
    process.stderr.write(`\n`);
    line("wallet",  `${C.yellow}not configured${C.reset}  ${C.dim}run 'noelclaw login' to set up${C.reset}`, C.yellow);
    line("status",  `${C.green}ready${C.reset}  ${C.dim}wallet tools require setup${C.reset}`, C.green);
    process.stderr.write(`\n`);
  }

  // Check for updates async - fires 3s after startup so it doesn't delay boot
  setTimeout(() => { checkForUpdate(PKG_VERSION).catch(() => {}); }, 3_000);
}

async function loginFlow() {
  process.stderr.write(`\n  ${C.cyan}â-† noelclaw login${C.reset}\n\n`);
  process.stderr.write(`  Get your session token from ${C.cyan}app.noelclaw.com${C.reset} â†’ Settings\n\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

  const token = await new Promise<string>((resolve) => {
    rl.question(`  Paste your session token: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  if (!token || !token.startsWith("noel_")) {
    process.stderr.write(`\n  ${C.yellow}âœ- Invalid token â€” should start with noel_${C.reset}\n\n`);
    process.exit(1);
  }

  // Verify token against API. Use the same env var + default as the rest
  // of the binary (cli.ts, llm.ts, convex.ts all use NOELCLAW_CONVEX_URL).
  // Earlier versions defaulted to noelclaw.convex.site here, which meant
  // `noelclaw login` could hit a different host than runtime tool calls
  // - confusing when users override one env var.
  const siteUrl = process.env.NOELCLAW_CONVEX_URL ?? "https://befitting-porcupine-276.convex.site";
  let authFailed = false;
  try {
    const res = await fetch(`${siteUrl}/auth/me`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { authFailed = true; throw new Error("Server rejected token"); }
    const data = await res.json() as any;
    if (!data.success) { authFailed = true; throw new Error("Token is invalid"); }

    writeConfig({ sessionToken: token, email: data.user?.email });
    process.stderr.write(`\n  ${C.green}âœ“ Signed in as ${data.user?.email ?? data.user?.username}${C.reset}\n`);
    process.stderr.write(`  ${C.dim}Token saved to ~/.noelclaw/config.json${C.reset}\n`);
    process.stderr.write(`  ${C.dim}All ${ALL_TOOLS.length} tools now unlocked.${C.reset}\n\n`);
  } catch (err: any) {
    if (authFailed) {
      process.stderr.write(`\n  ${C.yellow}âœ- ${err.message} â€” check your token at app.noelclaw.com${C.reset}\n\n`);
      process.exit(1);
    }
    // Network error â€” save token anyway, will be validated on first tool call
    writeConfig({ sessionToken: token });
    process.stderr.write(`\n  ${C.green}âœ“ Token saved${C.reset}  ${C.dim}(couldn't verify â€” will validate on first tool call)${C.reset}\n\n`);
  }

  process.exit(0);
}

const cmd = process.argv[2];
if (cmd === "login") {
  loginFlow().catch((err) => {
    process.stderr.write(`[noelclaw] login error: ${err}\n`);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    process.stderr.write(`[noelclaw] fatal: ${err}\n`);
    process.exit(1);
  });
}

