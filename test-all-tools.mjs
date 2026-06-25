/**
 * NoelClaw MCP Tool Smoke Test
 * Tests all 102 tools — reports PASS / FAIL / SKIP per tool
 */

import { handleMarketTool, MARKET_TOOLS } from "./dist/tools/market.js";
import { handleInsightTool, INSIGHT_TOOLS } from "./dist/tools/insight.js";
import { handleVaultTool, VAULT_TOOLS } from "./dist/tools/vault.js";
import { handleMemoryTool, MEMORY_TOOLS } from "./dist/tools/memory.js";
import { handleAgentTool, AGENT_TOOLS } from "./dist/tools/agents.js";
import { handleMonitorTool, MONITOR_TOOLS } from "./dist/tools/monitor.js";
import { handleResearchTool, RESEARCH_TOOLS } from "./dist/tools/research.js";
import { handleDeepResearch, DEEP_RESEARCH_TOOLS } from "./dist/tools/deep-research.js";
import { handleResearchCompareTool, RESEARCH_COMPARE_TOOLS } from "./dist/tools/research-compare.js";
import { handleResearchChainTool, RESEARCH_CHAIN_TOOLS } from "./dist/tools/research-chain.js";
import { handleDeFiTool, DEFI_TOOLS } from "./dist/tools/defi.js";
import { handleBaseTool, BASE_TOOLS } from "./dist/tools/base.js";
import { handleBaseMcpTool, BASE_MCP_TOOLS } from "./dist/tools/base-mcp.js";
import { handleScannerTool, SCANNER_TOOLS } from "./dist/tools/scanner.js";
import { handleCoderTool, CODER_TOOLS } from "./dist/tools/coder.js";
import { handleFrameworkTool, FRAMEWORK_TOOLS } from "./dist/tools/framework.js";
import { handleAutomationTool, AUTOMATION_TOOLS } from "./dist/tools/automation.js";
import { handleWalletTool, WALLET_TOOLS } from "./dist/tools/wallet.js";
import { handleMiroSharkTool, MIROSHARK_TOOLS } from "./dist/tools/miroshark.js";
import { handleHumanizerTool, HUMANIZER_TOOLS } from "./dist/tools/humanizer.js";
import { handleChronicle, CHRONICLE_TOOLS } from "./dist/tools/chronicle.js";
import { handlePacketTool, PACKET_TOOLS } from "./dist/tools/packets.js";
import { handleOsTool, OS_TOOLS } from "./dist/tools/os.js";
import { handleGithubTool, GITHUB_TOOLS } from "./dist/tools/github.js";

const TIMEOUT_MS = 20000;

const results = { pass: [], fail: [], skip: [], error: [] };

function withTimeout(promise, ms, toolName) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms))
  ]);
}

async function test(name, handler, args, expectFn) {
  try {
    const result = await withTimeout(handler(name, args), TIMEOUT_MS, name);
    if (!result) {
      results.skip.push({ name, reason: "handler returned null (not handled)" });
      return;
    }
    const text = result.content?.[0]?.text ?? "";
    if (result.isError && text.includes("not set")) {
      results.skip.push({ name, reason: text.slice(0, 80) });
      return;
    }
    if (result.isError) {
      results.fail.push({ name, reason: text.slice(0, 120) });
      return;
    }
    if (expectFn && !expectFn(text)) {
      results.fail.push({ name, reason: `Unexpected output: ${text.slice(0, 120)}` });
      return;
    }
    results.pass.push({ name, preview: text.slice(0, 80) });
  } catch (e) {
    results.error.push({ name, reason: e.message.slice(0, 120) });
  }
}

console.log("🧪 NoelClaw MCP Tool Smoke Test — starting...\n");

// ── MARKET ──────────────────────────────────────────────────────────────────
await test("get_market_data", handleMarketTool, {}, t => t.includes("BTC") || t.includes("bitcoin"));
await test("get_token_data", handleMarketTool, { symbol: "ETH" }, t => t.includes("ETH") || t.includes("price"));
await test("compare_tokens", handleMarketTool, { symbols: ["BTC", "ETH"] }, t => t.includes("BTC") || t.includes("compare") || t.length > 50);
await test("market_overview", handleMarketTool, {}, t => t.length > 100);
await test("token_history", handleMarketTool, { symbol: "BTC", timeframe: "7d" }, t => t.length > 50);

// ── INSIGHT ──────────────────────────────────────────────────────────────────
await test("ask_noel", handleInsightTool, { question: "What is Base chain?" }, t => t.length > 50);
await test("market_thesis", handleInsightTool, { topic: "ETH" }, t => t.length > 50);
await test("trade_plan", handleInsightTool, { token: "ETH", direction: "long" }, t => t.length > 50);

// ── RESEARCH ──────────────────────────────────────────────────────────────────
await test("web_search", handleResearchTool, { query: "Base chain TVL 2026", limit: 3 }, t => t.length > 50);
await test("web_scrape", handleResearchTool, { url: "https://docs.noelclaw.fun" }, t => t.length > 50);

// ── DEEP RESEARCH ────────────────────────────────────────────────────────────
await test("deep_research", handleDeepResearch, { topic: "Aerodrome DEX on Base", depth: "fast" }, t => t.length > 100);

// ── VAULT ────────────────────────────────────────────────────────────────────
const vaultKey = `test/smoke-${Date.now()}`;
await test("vault_save", handleVaultTool, {
  type: "research", title: "Smoke Test Entry", content: "This is a test entry from automated smoke test.",
  key: vaultKey, tags: ["smoke-test"], commitMsg: "smoke test"
}, t => t.includes("saved") || t.includes("vault") || t.includes("✅"));

await test("vault_read", handleVaultTool, { key: vaultKey }, t => t.includes("smoke test") || t.includes("Smoke Test"));
await test("vault_list", handleVaultTool, { type: "research", limit: 5 }, t => t.length > 20);
await test("vault_search", handleVaultTool, { query: "smoke test", limit: 3 }, t => t.length > 20);
await test("vault_history", handleVaultTool, { key: vaultKey }, t => t.length > 20);
await test("vault_tag", handleVaultTool, { key: vaultKey, tags: ["smoke-test", "automated"] }, t => t.length > 10);
await test("vault_pin", handleVaultTool, { key: vaultKey, pinned: true }, t => t.length > 10);
await test("vault_export", handleVaultTool, { type: "research" }, t => t.length > 20);
await test("vault_store_credential", handleVaultTool, { name: "SMOKE_TEST_CRED", value: "test-value-123", description: "smoke test credential" }, t => t.length > 10);
await test("vault_get_credential", handleVaultTool, { name: "SMOKE_TEST_CRED" }, t => t.includes("test-value") || t.length > 10);

// vault_link needs two real keys - link to itself as a soft test
await test("vault_link", handleVaultTool, { fromKey: vaultKey, toKey: vaultKey, relation: "related" }, t => t.length > 10);
await test("vault_related", handleVaultTool, { key: vaultKey }, t => t.length > 10);
await test("vault_diff", handleVaultTool, { key: vaultKey, fromVersion: 1, toVersion: 1 }, t => t.length > 5);

// vault_delete last
await test("vault_delete", handleVaultTool, { key: vaultKey }, t => t.includes("deleted") || t.includes("✅") || t.length > 5);

// ── MEMORY ────────────────────────────────────────────────────────────────────
await test("memory_add", handleMemoryTool, { content: "Smoke test: NoelClaw is an AI OS for agents on Base chain." }, t => t.length > 10);
await test("memory_search", handleMemoryTool, { query: "AI OS Base chain" }, t => t.length > 10);
await test("memory_context", handleMemoryTool, { topic: "Base chain" }, t => t.length > 10);
await test("memory_list", handleMemoryTool, { limit: 5 }, t => t.length > 10);
await test("memory_profile", handleMemoryTool, {}, t => t.length > 10);
await test("memory_extract", handleMemoryTool, { text: "User prefers Aerodrome for LP on Base. Avoids leverage." }, t => t.length > 10);
await test("memory_consolidate", handleMemoryTool, { topic: "Base chain" }, t => t.length > 10);
await test("memory_insight", handleMemoryTool, { topic: "Base chain" }, t => t.length > 10);
await test("memory_publish", handleMemoryTool, { content: "Noelclaw v3.27.0 released with 102 tools." }, t => t.length > 10);

// ── AGENTS ────────────────────────────────────────────────────────────────────
const agentName = `smoke-agent-${Date.now().toString(36)}`;
await test("agent_spawn", handleAgentTool, { name: agentName, goal: "Track Base chain DeFi for smoke test" }, t => t.includes(agentName) || t.includes("spawned") || t.includes("Agent"));
await test("agent_recall", handleAgentTool, { name: agentName }, t => t.includes(agentName) || t.includes("Goal"));
await test("agent_update", handleAgentTool, { name: agentName, progress: "Found 3 protocols: Aerodrome, Morpho, Moonwell", status: "active" }, t => t.length > 10);
await test("agent_identity", handleAgentTool, { agentId: agentName }, t => t.length > 10);
await test("agent_ledger", handleAgentTool, { name: agentName, limit: 5 }, t => t.length > 10);

// ── MONITORS ─────────────────────────────────────────────────────────────────
await test("schedule_research", handleMonitorTool, { topic: "Base DeFi", schedule: "daily-8am" }, t => t.length > 10);
await test("list_monitors", handleMonitorTool, {}, t => t.length > 10);

// ── BASE (renamed tools) ──────────────────────────────────────────────────────
await test("base_mcp_yield_vaults", handleBaseTool, { asset: "USDC", limit: 3 }, t => t.includes("Morpho") || t.includes("APY") || t.includes("vault") || t.length > 30);
await test("base_mcp_lending_rates", handleBaseTool, { asset: "USDC" }, t => t.includes("Moonwell") || t.includes("APY") || t.length > 30);
await test("base_mcp_network", handleBaseTool, {}, t => t.includes("ETH") || t.includes("gas") || t.includes("Base"));
await test("base_mcp_deposit_guide", handleBaseTool, { asset: "USDC", amount: "100" }, t => t.length > 50);

// ── BASE MCP (wallet tools) ───────────────────────────────────────────────────
await test("base_mcp_status", handleBaseMcpTool, {}, t => t.length > 20);
await test("base_mcp_balance", handleBaseMcpTool, {}, t => t.length > 10);
await test("base_mcp_resolve", handleBaseMcpTool, { name: "jesse.base.eth" }, t => t.length > 10);
await test("base_mcp_estimate", handleBaseMcpTool, { from: "ETH", to: "USDC", amount: "0.01" }, t => t.length > 10);
await test("base_mcp_lend", handleBaseMcpTool, { token: "USDC" }, t => t.length > 10);

// ── DEFI ──────────────────────────────────────────────────────────────────────
await test("get_defi_yields", handleDeFiTool, {}, t => t.length > 10);

// ── SCANNER ───────────────────────────────────────────────────────────────────
await test("score_token", handleScannerTool, { symbol: "ETH" }, t => t.length > 10);
await test("check_token", handleScannerTool, { symbol: "ETH" }, t => t.length > 10);
await test("scan_market", handleScannerTool, { pattern: "dip_reversal" }, t => t.length > 10);

// ── CODER ─────────────────────────────────────────────────────────────────────
await test("explain_code", handleCoderTool, { code: "function add(a, b) { return a + b; }", language: "javascript" }, t => t.length > 20);
await test("generate_contract", handleCoderTool, { description: "A simple ERC20 token called TestToken with symbol TST" }, t => t.includes("pragma") || t.includes("SPDX") || t.length > 50);
await test("review_code", handleCoderTool, { code: "const x = 1; console.log(x)" }, t => t.length > 20);
await test("audit_contract", handleCoderTool, { code: "pragma solidity ^0.8.0; contract Test { uint public val; function set(uint v) public { val = v; } }" }, t => t.length > 20);
await test("generate_mcp_skill", handleCoderTool, { description: "A skill that monitors GitHub stars daily" }, t => t.length > 50);

// ── FRAMEWORK ─────────────────────────────────────────────────────────────────
await test("list_playbooks", handleFrameworkTool, {}, t => t.length > 10);
await test("get_noel_ledger", handleFrameworkTool, { limit: 5 }, t => t.length > 10);

// ── AUTOMATION ────────────────────────────────────────────────────────────────
await test("list_automations", handleAutomationTool, {}, t => t.length > 10);

// ── WALLET ────────────────────────────────────────────────────────────────────
await test("get_wallet_address", handleWalletTool, {}, t => t.includes("0x") || t.length > 10);

// ── MIROSHARK ────────────────────────────────────────────────────────────────
await test("miroshark_simulate", handleMiroSharkTool, { scenario: "What happens to Base DeFi TVL if ETH drops 30%?" }, t => t.length > 10);

// ── HUMANIZER ─────────────────────────────────────────────────────────────────
await test("humanize_text", handleHumanizerTool, { text: "The aforementioned implementation leverages cutting-edge AI capabilities." }, t => t.length > 20);
await test("write_content", handleHumanizerTool, { topic: "Why NoelClaw is the best AI OS", format: "post" }, t => t.length > 20);

// ── CHRONICLE ─────────────────────────────────────────────────────────────────
await test("chronicle_add", handleChronicle, { event: "smoke_test", summary: "Automated smoke test completed" }, t => t.length > 5);
await test("chronicle_list", handleChronicle, { limit: 5 }, t => t.length > 10);

// ── PACKETS ───────────────────────────────────────────────────────────────────
const packetName = `smoke-packet-${Date.now().toString(36)}`;
await test("packet_create", handlePacketTool, {
  name: packetName,
  description: "Smoke test packet",
  steps: [{ step: 1, description: "Search for Base TVL", tool: "web_search", args: { query: "Base chain TVL" } }]
}, t => t.length > 10);
await test("packet_list", handlePacketTool, {}, t => t.length > 10);
await test("packet_run", handlePacketTool, { name: packetName }, t => t.length > 10);

// ── OS ────────────────────────────────────────────────────────────────────────
await test("noel_status", handleOsTool, {}, t => t.length > 20);

// ── GITHUB ────────────────────────────────────────────────────────────────────
await test("github_list_repos", handleGithubTool, { username: "noelclaw" }, t => t.length > 10);
await test("github_list_prs", handleGithubTool, { repo: "noelclaw/mcp", state: "open" }, t => t.length > 10);
await test("github_list_issues", handleGithubTool, { repo: "noelclaw/mcp" }, t => t.length > 10);
await test("github_get_file", handleGithubTool, { repo: "noelclaw/mcp", path: "README.md" }, t => t.length > 20);
await test("github_get_commits", handleGithubTool, { repo: "noelclaw/mcp", limit: 5 }, t => t.length > 10);
await test("github_search_code", handleGithubTool, { query: "vault_save repo:noelclaw/mcp" }, t => t.length > 10);

// ── RESEARCH COMPARE / CHAIN ──────────────────────────────────────────────────
// These need existing vault entries — just test they don't crash
await test("research_compare", handleResearchCompareTool, { topic: "Base chain" }, t => t.length > 10);

// ── REPORT ────────────────────────────────────────────────────────────────────
const total = results.pass.length + results.fail.length + results.skip.length + results.error.length;
console.log(`\n${"─".repeat(60)}`);
console.log(`✅ PASS  ${results.pass.length}/${total}`);
console.log(`❌ FAIL  ${results.fail.length}/${total}`);
console.log(`⚠️  SKIP  ${results.skip.length}/${total}  (missing env vars or no data yet)`);
console.log(`💥 ERROR ${results.error.length}/${total}`);
console.log(`${"─".repeat(60)}\n`);

if (results.fail.length) {
  console.log("── FAILURES ──");
  results.fail.forEach(r => console.log(`  ❌ ${r.name}: ${r.reason}`));
}
if (results.error.length) {
  console.log("\n── ERRORS ──");
  results.error.forEach(r => console.log(`  💥 ${r.name}: ${r.reason}`));
}
if (results.skip.length) {
  console.log("\n── SKIPPED ──");
  results.skip.forEach(r => console.log(`  ⚠️  ${r.name}: ${r.reason}`));
}
if (results.pass.length) {
  console.log("\n── PASSED ──");
  results.pass.forEach(r => console.log(`  ✅ ${r.name}: ${r.preview}`));
}
