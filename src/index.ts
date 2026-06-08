#!/usr/bin/env node
import { startServer, ALL_TOOLS } from "./server.js";
import { getOrCreateWallet } from "./wallet.js";
import { getSavedToken } from "./config.js";

// ── ANSI helpers ──────────────────────────────────────────────────────────────
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
  ███╗   ██╗ ██████╗ ███████╗██╗      ██████╗██╗      █████╗ ██╗    ██╗
  ████╗  ██║██╔═══██╗██╔════╝██║     ██╔════╝██║     ██╔══██╗██║    ██║
  ██╔██╗ ██║██║   ██║█████╗  ██║     ██║     ██║     ███████║██║ █╗ ██║
  ██║╚██╗██║██║   ██║██╔══╝  ██║     ██║     ██║     ██╔══██║██║███╗██║
  ██║ ╚████║╚██████╔╝███████╗███████╗╚██████╗███████╗██║  ██║╚███╔███╔╝
  ╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚══════╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
${C.reset}`;

function line(label: string, value: string, color = C.cyan) {
  const pad = " ".repeat(Math.max(0, 12 - label.length));
  process.stderr.write(`  ${color}◆ ${label}${C.reset}${pad}${value}\n`);
}

function divider() {
  process.stderr.write(`  ${C.dim}${"─".repeat(58)}${C.reset}\n`);
}

async function main() {
  process.stderr.write(BANNER);

  // ── Tool category counts ──────────────────────────────────────────────────
  const categories = [
    { label: "Market",     count: 5,  tools: "get_market_data · get_token_data · compare_tokens · market_overview · token_history" },
    { label: "Insight",    count: 3,  tools: "ask_noel · market_thesis · trade_plan" },
    { label: "DeFi",       count: 6,  tools: "get_portfolio · estimate_swap · swap_tokens · send_token · analyze_wallet · get_defi_yields" },
    { label: "Automation", count: 6,  tools: "create · list · pause · delete · runs · run_now" },
    { label: "Swarm",      count: 5,  tools: "stop_swarm · get_swarm_status · swarm_research · trigger_agent · swarm_synthesize" },
    { label: "Framework",  count: 3,  tools: "list_playbooks · run_playbook · get_noel_ledger" },
    { label: "Vault",      count: 14, tools: "save · read · list · search · history · diff · export · credential · pin · delete · link · tag · related · related" },
    { label: "Wallet",     count: 2,  tools: "get_wallet_address · set_telegram" },
    { label: "MiroShark",  count: 3,  tools: "simulate · status · stop" },
    { label: "Scanner",    count: 3,  tools: "scan_market · score_token · check_token" },
    { label: "Agents",     count: 7,  tools: "list_agents · hire_agent · agent_spawn · agent_recall · agent_update · agent_identity · agent_ledger" },
    { label: "Social",     count: 2,  tools: "humanize_text · write_content" },
    { label: "Coder",      count: 5,  tools: "generate_contract · audit_contract · explain_code · review_code · generate_mcp_skill" },
    { label: "Base",       count: 4,  tools: "query_vaults · list_markets · prepare_deposit · chain_stats" },
    { label: "Memory",     count: 9,  tools: "add · search · context · profile · list · delete · insight · extract · consolidate" },
    { label: "OS",         count: 1,  tools: "noel_status" },
    { label: "Research",   count: 2,  tools: "web_scrape · web_search" },
    { label: "Monitor",    count: 4,  tools: "schedule_research · create_monitor · list_monitors · cancel_monitor" },
    { label: "GitHub",     count: 8,  tools: "list_repos · list_prs · get_pr · list_issues · get_issue · get_file · get_commits · search_code" },
    { label: "Chronicle",  count: 2,  tools: "chronicle_add · chronicle_list" },
    { label: "Packets",    count: 4,  tools: "packet_create · packet_run · packet_list · packet_share" },
  ];

  const total = ALL_TOOLS.length;

  divider();
  process.stderr.write(`\n`);

  const model   = process.env.NOELCLAW_MODEL ?? "claude-haiku-4-5-20251001";
  const aiMode  = process.env.BANKR_API_KEY
    ? `Bankr  ${C.dim}${model}${C.reset}`
    : process.env.ANTHROPIC_API_KEY
    ? `Anthropic  ${C.dim}${model}${C.reset}`
    : `Noelclaw  ${C.dim}proxy · auto-auth${C.reset}`;

  line("version", `v3.8.0  ${C.dim}MCP protocol 2.1.0${C.reset}`);
  line("ai",       aiMode);
  line("tools",    `${C.white}${C.bold}${total} tools loaded${C.reset}  ${C.dim}across ${categories.length} categories${C.reset}`);

  process.stderr.write(`\n`);
  divider();
  process.stderr.write(`\n`);

  // ── Categories grid ───────────────────────────────────────────────────────
  for (const cat of categories) {
    const countStr = `${cat.count}`.padStart(2);
    process.stderr.write(
      `  ${C.dim}│${C.reset} ${C.cyan}${cat.label.padEnd(11)}${C.reset} ${C.dim}${countStr}x${C.reset}  ${C.dim}${cat.tools}${C.reset}\n`
    );
  }

  process.stderr.write(`\n`);
  divider();

  // ── Wallet ────────────────────────────────────────────────────────────────
  await startServer();

  const hasAuth = !!getSavedToken();

  try {
    const wallet = await getOrCreateWallet();
    process.stderr.write(`\n`);
    line("wallet",  wallet.address);
    if (hasAuth) {
      line("auth",   `${C.green}signed in${C.reset}  ${C.dim}all 98 tools unlocked${C.reset}`, C.green);
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

main().catch((err) => {
  process.stderr.write(`[noelclaw] fatal: ${err}\n`);
  process.exit(1);
});
