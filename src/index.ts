#!/usr/bin/env node
import { startServer, ALL_TOOLS } from "./server.js";
import { getOrCreateWallet } from "./wallet.js";

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
    { label: "DeFi",       count: 6,  tools: "portfolio · swap · send · scan_wallet · estimate · get_defi_yields" },
    { label: "Automation", count: 5,  tools: "create · list · pause · delete · runs" },
    { label: "Scanner",    count: 4,  tools: "scan_dips · scan_momentum · score_token · check_token" },
    { label: "Agents",     count: 2,  tools: "list_agents · hire_agent" },
    { label: "Swarm",      count: 11, tools: "start · stop · status · memory · scores · research · trigger · brief · broadcast · pulse" },
    { label: "Framework",  count: 6,  tools: "create_task · list_tasks · list_playbooks · run_playbook · ledger · sentinel" },
    { label: "Vault",      count: 18, tools: "save · read · list · search · history · diff · export · remember · context · credential · publish · explore · connect · pin · delete · link · tag" },
    { label: "Memory",     count: 8,  tools: "add · search · context · profile · connect · list · delete · update" },
    { label: "MiroShark",  count: 3,  tools: "simulate · status · stop" },
    { label: "Wallet",     count: 2,  tools: "get_wallet_address · set_telegram" },
    { label: "Social",     count: 3,  tools: "humanize_text · write_thread · write_post" },
    { label: "Coder",      count: 7,  tools: "scaffold_project · generate_component · generate_contract · audit_contract · explain_code · review_code · generate_mcp_skill" },
    { label: "Base",       count: 4,  tools: "query_vaults · list_markets · prepare_deposit · chain_stats" },
  ];

  const total = ALL_TOOLS.length;

  divider();
  process.stderr.write(`\n`);

  line("version", `v2.4.0  ${C.dim}MCP protocol 2.1.0${C.reset}`);
  line("network",  `Base mainnet  ${C.dim}via 0x Protocol · ethers v6${C.reset}`);
  line("ai",       `Bankr LLM  ${C.dim}grok-3 · llm.bankr.bot${C.reset}`);
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

  try {
    const wallet = await getOrCreateWallet();
    process.stderr.write(`\n`);
    line("wallet",  wallet.address);
    line("status",  `${C.green}ready${C.reset}  ${C.dim}waiting for MCP client...${C.reset}`, C.green);
    process.stderr.write(`\n`);
  } catch {
    process.stderr.write(`\n`);
    line("wallet",  `${C.yellow}not configured${C.reset}  ${C.dim}run 'noelclaw-mcp' to init${C.reset}`, C.yellow);
    line("status",  `${C.green}ready${C.reset}  ${C.dim}wallet tools require setup${C.reset}`, C.green);
    process.stderr.write(`\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`[noelclaw] fatal: ${err}\n`);
  process.exit(1);
});
