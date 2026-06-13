#!/usr/bin/env node
import { startServer, ALL_TOOLS } from "./server.js";
import { getOrCreateWallet } from "./wallet.js";
import { getSavedToken, writeConfig } from "./config.js";
import * as readline from "readline";

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
  â–ˆâ–ˆâ–ˆâ•—   â–ˆâ–ˆâ•— â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•— â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—â–ˆâ–ˆâ•—      â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—â–ˆâ–ˆâ•—      â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•— â–ˆâ–ˆâ•—    â–ˆâ–ˆâ•—
  â–ˆâ–ˆâ–ˆâ–ˆâ•—  â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•”â•â•â•â–ˆâ–ˆâ•—â–ˆâ–ˆâ•”â•â•â•â•â•â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•”â•â•â•â•â•â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•—â–ˆâ–ˆâ•‘    â–ˆâ–ˆâ•‘
  â–ˆâ–ˆâ•”â–ˆâ–ˆâ•— â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•‘â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—  â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘ â–ˆâ•— â–ˆâ–ˆâ•‘
  â–ˆâ–ˆâ•‘â•šâ–ˆâ–ˆâ•—â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•”â•â•â•  â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘â–ˆâ–ˆâ–ˆâ•—â–ˆâ–ˆâ•‘
  â–ˆâ–ˆâ•‘ â•šâ–ˆâ–ˆâ–ˆâ–ˆâ•‘â•šâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•”â•â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—â•šâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—â–ˆâ–ˆâ•‘  â–ˆâ–ˆâ•‘â•šâ–ˆâ–ˆâ–ˆâ•”â–ˆâ–ˆâ–ˆâ•”â•
  â•šâ•â•  â•šâ•â•â•â• â•šâ•â•â•â•â•â• â•šâ•â•â•â•â•â•â•â•šâ•â•â•â•â•â•â• â•šâ•â•â•â•â•â•â•šâ•â•â•â•â•â•â•â•šâ•â•  â•šâ•â• â•šâ•â•â•â•šâ•â•â•
${C.reset}`;

function line(label: string, value: string, color = C.cyan) {
  const pad = " ".repeat(Math.max(0, 12 - label.length));
  process.stderr.write(`  ${color}â—† ${label}${C.reset}${pad}${value}\n`);
}

function divider() {
  process.stderr.write(`  ${C.dim}${"â”€".repeat(58)}${C.reset}\n`);
}

async function main() {
  process.stderr.write(BANNER);

  // â”€â”€ Tool category counts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const categories = [
    { label: "Market",     count: 5,  tools: "get_market_data Â· get_token_data Â· compare_tokens Â· market_overview Â· token_history" },
    { label: "Insight",    count: 3,  tools: "ask_noel Â· market_thesis Â· trade_plan" },
    { label: "DeFi",       count: 6,  tools: "get_portfolio Â· estimate_swap Â· swap_tokens Â· send_token Â· analyze_wallet Â· get_defi_yields" },
    { label: "Automation", count: 6,  tools: "create_automation Â· list_automations Â· pause_automation Â· delete_automation Â· get_automation_runs Â· run_automation" },
    { label: "Swarm",      count: 5,  tools: "stop_swarm Â· get_swarm_status Â· swarm_research Â· trigger_agent Â· swarm_synthesize" },
    { label: "Framework",  count: 3,  tools: "list_playbooks Â· run_playbook Â· get_noel_ledger" },
    { label: "Vault",      count: 14, tools: "save Â· read Â· list Â· search Â· history Â· diff Â· export Â· credential Â· pin Â· delete Â· link Â· tag Â· related Â· related" },
    { label: "Wallet",     count: 2,  tools: "get_wallet_address Â· set_telegram" },
    { label: "MiroShark",  count: 3,  tools: "simulate Â· status Â· stop" },
    { label: "Scanner",    count: 3,  tools: "scan_market Â· score_token Â· check_token" },
    { label: "Agents",     count: 7,  tools: "list_agents Â· hire_agent Â· agent_spawn Â· agent_recall Â· agent_update Â· agent_identity Â· agent_ledger" },
    { label: "Social",     count: 2,  tools: "humanize_text Â· write_content" },
    { label: "Coder",      count: 5,  tools: "generate_contract Â· audit_contract Â· explain_code Â· review_code Â· generate_mcp_skill" },
    { label: "Base",       count: 4,  tools: "query_vaults Â· list_markets Â· prepare_deposit Â· chain_stats" },
    { label: "Memory",     count: 10, tools: "add Â· search Â· context Â· profile Â· list Â· delete Â· insight Â· extract Â· consolidate Â· publish" },
    { label: "OS",         count: 1,  tools: "noel_status" },
    { label: "Research",   count: 2,  tools: "web_scrape Â· web_search" },
    { label: "Monitor",    count: 4,  tools: "schedule_research Â· create_monitor Â· list_monitors Â· cancel_monitor" },
    { label: "GitHub",     count: 8,  tools: "list_repos Â· list_prs Â· get_pr Â· list_issues Â· get_issue Â· get_file Â· get_commits Â· search_code" },
    { label: "Chronicle",  count: 2,  tools: "chronicle_add Â· chronicle_list" },
    { label: "Packets",    count: 4,  tools: "packet_create Â· packet_run Â· packet_list Â· packet_share" },
  ];

  const total = ALL_TOOLS.length;

  divider();
  process.stderr.write(`\n`);

  const model   = process.env.NOELCLAW_MODEL ?? "claude-haiku-4-5-20251001";
  const aiMode  = process.env.BANKR_API_KEY
    ? `Bankr  ${C.dim}${model}${C.reset}`
    : process.env.ANTHROPIC_API_KEY
    ? `Anthropic  ${C.dim}${model}${C.reset}`
    : `Noelclaw  ${C.dim}proxy Â· auto-auth${C.reset}`;

  line("version", `v3.9.3  ${C.dim}MCP protocol 2.1.0${C.reset}`);
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
      line("auth",   `${C.green}signed in${C.reset}  ${C.dim}all 102 tools unlocked${C.reset}`, C.green);
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
}

async function loginFlow() {
  process.stderr.write(`\n  ${C.cyan}â—† noelclaw login${C.reset}\n\n`);
  process.stderr.write(`  Get your session token from ${C.cyan}app.noelclaw.com${C.reset} â†’ Settings\n\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

  const token = await new Promise<string>((resolve) => {
    rl.question(`  Paste your session token: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  if (!token || !token.startsWith("noel_")) {
    process.stderr.write(`\n  ${C.yellow}âœ— Invalid token â€” should start with noel_${C.reset}\n\n`);
    process.exit(1);
  }

  // Verify token against API
  const siteUrl = process.env.CONVEX_SITE_URL ?? "https://noelclaw.convex.site";
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
    process.stderr.write(`  ${C.dim}All 102 tools now unlocked.${C.reset}\n\n`);
  } catch (err: any) {
    if (authFailed) {
      process.stderr.write(`\n  ${C.yellow}âœ— ${err.message} â€” check your token at app.noelclaw.com${C.reset}\n\n`);
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

