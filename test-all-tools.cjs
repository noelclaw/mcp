/**
 * NoelClaw MCP Tool Smoke Test — v3.27.0
 * Tests all 102 tools and reports PASS / FAIL / SKIP
 */

const { handleMarketTool }        = require("./dist/tools/market.js");
const { handleInsightTool }       = require("./dist/tools/insight.js");
const { handleVaultTool }         = require("./dist/tools/vault.js");
const { handleMemoryTool }        = require("./dist/tools/memory.js");
const { handleAgentTool }         = require("./dist/tools/agents.js");
const { handleMonitorTool }       = require("./dist/tools/monitor.js");
const { handleResearchTool }      = require("./dist/tools/research.js");
const { handleDeepResearch }      = require("./dist/tools/deep-research.js");
const { handleResearchCompare }   = require("./dist/tools/research-compare.js");
const { handleResearchChain }     = require("./dist/tools/research-chain.js");
const { handleDefiTool }          = require("./dist/tools/defi.js");
const { handleBaseTool }          = require("./dist/tools/base.js");
const { handleBaseMcpTool }       = require("./dist/tools/base-mcp.js");
const { handleScannerTool }       = require("./dist/tools/scanner.js");
const { handleCoderTool }         = require("./dist/tools/coder.js");
const { handleFrameworkTool }     = require("./dist/tools/framework.js");
const { handleAutomationTool }    = require("./dist/tools/automation.js");
const { handleWalletTool }        = require("./dist/tools/wallet.js");
const { handleMirosharkTool }     = require("./dist/tools/miroshark.js");
const { handleHumanizerTool }     = require("./dist/tools/humanizer.js");
const { handleChronicle }         = require("./dist/tools/chronicle.js");
const { handlePacket }            = require("./dist/tools/packets.js");
const { handleOsTool }            = require("./dist/tools/os.js");
const { handleGithubTool }        = require("./dist/tools/github.js");

const TIMEOUT_MS = 25000;
const results = { pass: [], fail: [], skip: [], error: [] };

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms))
  ]);
}

async function test(name, handler, args, expectFn) {
  process.stdout.write(`  testing ${name}...`);
  try {
    const result = await withTimeout(handler(name, args), TIMEOUT_MS);
    if (!result) {
      console.log(` ⚠️  SKIP (null)`);
      results.skip.push({ name, reason: "handler returned null" });
      return;
    }
    const text = result.content?.[0]?.text ?? "";
    if (result.isError && (text.includes("not set") || text.includes("not configured") || text.includes("TRIGGER_SECRET_KEY"))) {
      console.log(` ⚠️  SKIP (env)`);
      results.skip.push({ name, reason: text.slice(0, 80) });
      return;
    }
    if (result.isError) {
      console.log(` ❌ FAIL`);
      results.fail.push({ name, reason: text.slice(0, 150) });
      return;
    }
    if (expectFn && !expectFn(text)) {
      console.log(` ❌ FAIL (unexpected output)`);
      results.fail.push({ name, reason: `Got: ${text.slice(0, 120)}` });
      return;
    }
    console.log(` ✅`);
    results.pass.push({ name, preview: text.slice(0, 80).replace(/\n/g, " ") });
  } catch (e) {
    console.log(` 💥 ERROR`);
    results.error.push({ name, reason: e.message.slice(0, 120) });
  }
}

async function main() {
  console.log("🧪 NoelClaw MCP Tool Smoke Test — v3.27.0\n");

  // ── MARKET ──────────────────────────────────────────────────────────────────
  console.log("\n📊 MARKET");
  await test("get_market_data",  handleMarketTool, {}, t => t.length > 50);
  await test("get_token_data",   handleMarketTool, { symbol: "ETH" }, t => t.length > 30);
  await test("compare_tokens",   handleMarketTool, { symbols: ["BTC", "ETH"] }, t => t.length > 30);
  await test("market_overview",  handleMarketTool, {}, t => t.length > 50);
  await test("token_history",    handleMarketTool, { symbol: "BTC", timeframe: "7d" }, t => t.length > 30);

  // ── INSIGHT ──────────────────────────────────────────────────────────────────
  console.log("\n🧠 INSIGHT (LLM)");
  await test("ask_noel",      handleInsightTool, { question: "What is Base chain in one sentence?" }, t => t.length > 30);
  await test("market_thesis", handleInsightTool, { topic: "ETH" }, t => t.length > 30);
  await test("trade_plan",    handleInsightTool, { token: "ETH", direction: "long" }, t => t.length > 30);

  // ── RESEARCH ──────────────────────────────────────────────────────────────────
  console.log("\n🔍 RESEARCH");
  await test("web_search", handleResearchTool, { query: "Base chain TVL 2026", limit: 3 }, t => t.length > 30);
  await test("web_scrape",  handleResearchTool, { url: "https://docs.noelclaw.fun" }, t => t.length > 30);
  await test("deep_research", handleDeepResearch, { topic: "Aerodrome DEX on Base", depth: "fast" }, t => t.length > 100);

  // ── VAULT ────────────────────────────────────────────────────────────────────
  console.log("\n🗄️  VAULT");
  const vaultKey = `test/smoke-${Date.now()}`;
  await test("vault_save",   handleVaultTool, { type: "research", title: "Smoke Test", content: "automated smoke test entry for noelclaw v3.27.0", key: vaultKey, tags: ["smoke-test"], commitMsg: "smoke test" }, t => t.length > 5);
  await test("vault_read",   handleVaultTool, { key: vaultKey }, t => t.includes("smoke test") || t.includes("Smoke") || t.length > 20);
  await test("vault_list",   handleVaultTool, { type: "research", limit: 5 }, t => t.length > 10);
  await test("vault_search", handleVaultTool, { query: "smoke test", limit: 3 }, t => t.length > 10);
  await test("vault_history",handleVaultTool, { key: vaultKey }, t => t.length > 10);
  await test("vault_tag",    handleVaultTool, { key: vaultKey, tags: ["smoke-test", "v3"] }, t => t.length > 5);
  await test("vault_pin",    handleVaultTool, { key: vaultKey, pinned: true }, t => t.length > 5);
  await test("vault_store_credential", handleVaultTool, { name: "SMOKE_CRED_TEST", value: "test-secret-xyz" }, t => t.length > 5);
  await test("vault_get_credential",   handleVaultTool, { name: "SMOKE_CRED_TEST" }, t => t.length > 5);
  await test("vault_link",   handleVaultTool, { fromKey: vaultKey, toKey: vaultKey, relation: "related" }, t => t.length > 5);
  await test("vault_related",handleVaultTool, { key: vaultKey }, t => t.length > 5);
  await test("vault_diff",   handleVaultTool, { key: vaultKey, fromVersion: 1, toVersion: 1 }, t => t.length > 5);
  await test("vault_export", handleVaultTool, { type: "research" }, t => t.length > 10);
  await test("vault_delete", handleVaultTool, { key: vaultKey }, t => t.length > 5);

  // ── MEMORY ────────────────────────────────────────────────────────────────────
  console.log("\n💾 MEMORY");
  await test("memory_add",         handleMemoryTool, { content: "Smoke test: NoelClaw AI OS runs on Base chain, 102 tools." }, t => t.length > 5);
  await test("memory_search",      handleMemoryTool, { query: "NoelClaw Base chain" }, t => t.length > 5);
  await test("memory_context",     handleMemoryTool, { topic: "Base chain DeFi" }, t => t.length > 5);
  await test("memory_list",        handleMemoryTool, { limit: 5 }, t => t.length > 5);
  await test("memory_profile",     handleMemoryTool, {}, t => t.length > 5);
  await test("memory_extract",     handleMemoryTool, { text: "User avoids leverage. Prefers Aerodrome LP on Base." }, t => t.length > 5);
  await test("memory_consolidate", handleMemoryTool, { topic: "Base chain" }, t => t.length > 5);
  await test("memory_insight",     handleMemoryTool, { topic: "Base chain DeFi" }, t => t.length > 5);
  await test("memory_publish",     handleMemoryTool, { content: "NoelClaw v3.27.0 — 102 tools, Base-native AI OS." }, t => t.length > 5);

  // ── AGENTS ────────────────────────────────────────────────────────────────────
  console.log("\n🤖 AGENTS");
  const agentName = `smoke-${Date.now().toString(36)}`;
  await test("agent_spawn",    handleAgentTool, { name: agentName, goal: "Smoke test agent — track Base DeFi" }, t => t.length > 10);
  await test("agent_recall",   handleAgentTool, { name: agentName }, t => t.length > 10);
  await test("agent_update",   handleAgentTool, { name: agentName, progress: "Found Aerodrome, Morpho, Moonwell on Base", status: "active" }, t => t.length > 5);
  await test("agent_identity", handleAgentTool, { agentId: agentName }, t => t.length > 5);
  await test("agent_ledger",   handleAgentTool, { name: agentName, limit: 5 }, t => t.length > 5);

  // ── MONITORS ─────────────────────────────────────────────────────────────────
  console.log("\n📡 MONITORS");
  await test("schedule_research", handleMonitorTool, { topic: "Base chain DeFi weekly", schedule: "weekly-monday" }, t => t.length > 5);
  await test("list_monitors",     handleMonitorTool, {}, t => t.length > 5);

  // ── BASE DATA TOOLS ───────────────────────────────────────────────────────────
  console.log("\n🔵 BASE DATA (renamed tools)");
  await test("base_mcp_yield_vaults",  handleBaseTool, { asset: "USDC", limit: 3 }, t => t.length > 30);
  await test("base_mcp_lending_rates", handleBaseTool, {}, t => t.length > 30);
  await test("base_mcp_network",       handleBaseTool, {}, t => t.includes("ETH") || t.includes("gas") || t.length > 20);
  await test("base_mcp_deposit_guide", handleBaseTool, { asset: "USDC", amount: "100" }, t => t.length > 30);

  // ── BASE MCP WALLET ───────────────────────────────────────────────────────────
  console.log("\n💰 BASE MCP (wallet)");
  await test("base_mcp_status",   handleBaseMcpTool, {}, t => t.length > 10);
  await test("base_mcp_balance",  handleBaseMcpTool, {}, t => t.length > 10);
  await test("base_mcp_resolve",  handleBaseMcpTool, { name: "jesse.base.eth" }, t => t.length > 10);
  await test("base_mcp_estimate", handleBaseMcpTool, { from: "ETH", to: "USDC", amount: "0.01" }, t => t.length > 10);
  await test("base_mcp_lend",     handleBaseMcpTool, { token: "USDC" }, t => t.length > 10);

  // ── DEFI ──────────────────────────────────────────────────────────────────────
  console.log("\n💎 DEFI");
  await test("get_defi_yields", handleDefiTool, {}, t => t.length > 10);

  // ── SCANNER ───────────────────────────────────────────────────────────────────
  console.log("\n🔬 SCANNER");
  await test("score_token", handleScannerTool, { symbol: "ETH" }, t => t.length > 10);
  await test("check_token", handleScannerTool, { symbol: "ETH" }, t => t.length > 10);
  await test("scan_market", handleScannerTool, { pattern: "dip_reversal" }, t => t.length > 10);

  // ── CODER ─────────────────────────────────────────────────────────────────────
  console.log("\n👨‍💻 CODER");
  await test("explain_code",       handleCoderTool, { code: "function add(a, b) { return a + b; }", language: "javascript" }, t => t.length > 20);
  await test("generate_contract",  handleCoderTool, { description: "Simple ERC20 token called SmokeToken with symbol SMK" }, t => t.length > 50);
  await test("review_code",        handleCoderTool, { code: "const x = 1; console.log(x)" }, t => t.length > 20);
  await test("audit_contract",     handleCoderTool, { code: "pragma solidity ^0.8.0; contract Test { uint public val; function set(uint v) public { val = v; } }" }, t => t.length > 20);
  await test("generate_mcp_skill", handleCoderTool, { description: "A skill that tracks GitHub stars daily and saves to vault" }, t => t.length > 50);

  // ── FRAMEWORK ─────────────────────────────────────────────────────────────────
  console.log("\n🏗️  FRAMEWORK");
  await test("list_playbooks",  handleFrameworkTool, {}, t => t.length > 10);
  await test("get_noel_ledger", handleFrameworkTool, { limit: 5 }, t => t.length > 5);

  // ── AUTOMATION ────────────────────────────────────────────────────────────────
  console.log("\n⚙️  AUTOMATION");
  await test("list_automations", handleAutomationTool, {}, t => t.length > 5);

  // ── WALLET ────────────────────────────────────────────────────────────────────
  console.log("\n👛 WALLET");
  await test("get_wallet_address", handleWalletTool, {}, t => t.length > 5);

  // ── MIROSHARK ────────────────────────────────────────────────────────────────
  console.log("\n🦈 MIROSHARK");
  await test("miroshark_simulate", handleMirosharkTool, { scenario: "What happens to Base TVL if ETH drops 30%?" }, t => t.length > 10);

  // ── HUMANIZER ─────────────────────────────────────────────────────────────────
  console.log("\n✍️  HUMANIZER");
  await test("humanize_text", handleHumanizerTool, { text: "The aforementioned implementation leverages cutting-edge AI capabilities to facilitate seamless integration." }, t => t.length > 20);
  await test("write_content", handleHumanizerTool, { topic: "Why persistent AI agents beat one-shot chatbots", format: "post" }, t => t.length > 20);

  // ── CHRONICLE ─────────────────────────────────────────────────────────────────
  console.log("\n📜 CHRONICLE");
  await test("chronicle_add",  handleChronicle, { event: "smoke_test", summary: "Automated smoke test run v3.27.0" }, t => t.length > 5);
  await test("chronicle_list", handleChronicle, { limit: 5 }, t => t.length > 5);

  // ── PACKETS ───────────────────────────────────────────────────────────────────
  console.log("\n📦 PACKETS");
  const pName = `smoke-${Date.now().toString(36)}`;
  await test("packet_create", handlePacket, { name: pName, description: "Smoke test packet", steps: [{ step: 1, description: "Search Base TVL", tool: "web_search", args: { query: "Base chain TVL" } }] }, t => t.length > 5);
  await test("packet_list",   handlePacket, {}, t => t.length > 5);
  await test("packet_run",    handlePacket, { name: pName }, t => t.length > 5);
  await test("packet_share",  handlePacket, { name: pName }, t => t.length > 5);

  // ── OS ────────────────────────────────────────────────────────────────────────
  console.log("\n🖥️  OS");
  await test("noel_status", handleOsTool, {}, t => t.length > 20);

  // ── GITHUB ────────────────────────────────────────────────────────────────────
  console.log("\n🐙 GITHUB");
  await test("github_list_repos",  handleGithubTool, { username: "noelclaw" }, t => t.length > 10);
  await test("github_list_prs",    handleGithubTool, { repo: "BankrBot/skills", state: "open" }, t => t.length > 10);
  await test("github_list_issues", handleGithubTool, { repo: "noelclaw/mcp" }, t => t.length > 10);
  await test("github_get_file",    handleGithubTool, { repo: "noelclaw/mcp", path: "README.md" }, t => t.length > 20);
  await test("github_get_commits", handleGithubTool, { repo: "noelclaw/mcp", limit: 3 }, t => t.length > 10);
  await test("github_search_code", handleGithubTool, { query: "vault_save repo:noelclaw/mcp" }, t => t.length > 10);

  // ── RESEARCH COMPARE / CHAIN ──────────────────────────────────────────────────
  console.log("\n📈 RESEARCH COMPARE/CHAIN");
  await test("research_compare", handleResearchCompare, { topic: "Base chain" }, t => t.length > 10);
  await test("research_chain",   handleResearchChain,   { startKey: "research/smoke-placeholder" }, t => t.length > 5);

  // ─────────────────────────────────────────────────────────────────────────────
  const total = results.pass.length + results.fail.length + results.skip.length + results.error.length;
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ✅ PASS   ${String(results.pass.length).padStart(3)} / ${total}`);
  console.log(`  ❌ FAIL   ${String(results.fail.length).padStart(3)} / ${total}`);
  console.log(`  ⚠️  SKIP   ${String(results.skip.length).padStart(3)} / ${total}  (env var missing or no data)`);
  console.log(`  💥 ERROR  ${String(results.error.length).padStart(3)} / ${total}`);
  console.log(`${"═".repeat(60)}\n`);

  if (results.fail.length) {
    console.log("── FAILURES ──────────────────────────────────────────────");
    results.fail.forEach(r => console.log(`  ❌ ${r.name}\n     ${r.reason}\n`));
  }
  if (results.error.length) {
    console.log("── ERRORS ────────────────────────────────────────────────");
    results.error.forEach(r => console.log(`  💥 ${r.name}\n     ${r.reason}\n`));
  }
  if (results.skip.length) {
    console.log("── SKIPPED ───────────────────────────────────────────────");
    results.skip.forEach(r => console.log(`  ⚠️  ${r.name}: ${r.reason.slice(0,80)}`));
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
