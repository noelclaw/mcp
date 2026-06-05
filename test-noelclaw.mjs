import { ethers } from "ethers";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";

const BASE_URL = "https://befitting-porcupine-276.convex.site";
const WALLET_FILE = path.join(os.homedir(), ".noelclaw", "wallet.json");

// ── Same machine key logic as mcp-server/src/wallet.ts ────────────────────────
function getMachineKey() {
  const passphrase = process.env.NOELCLAW_WALLET_PASSPHRASE ?? "";
  return crypto
    .createHash("sha256")
    .update(passphrase + os.hostname() + os.platform() + os.arch())
    .digest("hex")
    .slice(0, 32);
}

async function getWallet() {
  const encrypted = fs.readFileSync(WALLET_FILE, "utf8");
  return ethers.Wallet.fromEncryptedJson(encrypted, getMachineKey());
}

async function sign(wallet, toolName) {
  const timestamp = Date.now().toString();
  const signature = await wallet.signMessage(`noelclaw:${toolName}:${timestamp}`);
  return {
    "X-Wallet-Address": wallet.address,
    "X-Wallet-Signature": signature,
    "X-Wallet-Timestamp": timestamp,
  };
}

async function get(wallet, path, toolName) {
  const headers = await sign(wallet, toolName);
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function post(wallet, path, toolName, payload) {
  const headers = { ...(await sign(wallet, toolName)), "Content-Type": "application/json" };
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

function ok(label, result) {
  const pass = result.status >= 200 && result.status < 300;
  const icon = pass ? "✅" : result.status === 402 ? "💰" : "❌";
  const preview = JSON.stringify(result.body)?.slice(0, 120);
  console.log(`${icon} [${result.status}] ${label}`);
  if (!pass) console.log(`   └─ ${preview}`);
  return pass;
}

async function main() {
  console.log("Loading wallet…");
  const wallet = await getWallet();
  console.log(`Wallet: ${wallet.address}\n`);

  const results = { pass: 0, fail: 0, pay: 0 };

  function record(label, r) {
    ok(label, r);
    if (r.status >= 200 && r.status < 300) results.pass++;
    else if (r.status === 402) results.pay++;
    else results.fail++;
  }

  // ── MARKET ────────────────────────────────────────────────────────────────
  console.log("\n📈 MARKET");
  record("GET /mcp/market (ETH)", await get(wallet, "/mcp/market?token=ETH", "get_market_data"));
  record("POST /mcp/chat (ask_noel)", await post(wallet, "/mcp/chat", "ask_noel", { question: "What is the price of ETH?", agentId: "noel-default" }));
  record("POST /mcp/research", await post(wallet, "/mcp/research", "research", { query: "Bitcoin trend" }));

  // ── DEFI ─────────────────────────────────────────────────────────────────
  console.log("\n💎 DEFI");
  record("GET /mcp/defi/portfolio", await get(wallet, "/mcp/defi/portfolio", "get_portfolio"));
  record("GET /wallet/scan", await get(wallet, "/wallet/scan", "scan_wallet"));

  // ── AUTOMATIONS ──────────────────────────────────────────────────────────
  console.log("\n⚙️ AUTOMATIONS");
  record("GET /automations/list", await get(wallet, "/automations/list", "list_automations"));
  record("GET /automations/runs", await get(wallet, "/automations/runs", "get_runs"));

  // ── SWARM ─────────────────────────────────────────────────────────────────
  console.log("\n🐝 SWARM");
  record("GET /swarm/status", await get(wallet, "/swarm/status", "get_swarm_status"));
  record("GET /swarm/scores", await get(wallet, "/swarm/scores", "get_execution_scores"));
  record("GET /swarm/memory", await get(wallet, "/swarm/memory", "get_swarm_memory"));
  record("GET /swarm/ledger", await get(wallet, "/swarm/ledger", "ledger"));

  // ── FRAMEWORK ─────────────────────────────────────────────────────────────
  console.log("\n🏛️ FRAMEWORK");
  record("GET /framework/tasks", await get(wallet, "/framework/tasks", "list_tasks"));
  record("GET /framework/playbooks", await get(wallet, "/framework/playbooks", "list_playbooks"));
  record("GET /framework/runs", await get(wallet, "/framework/runs", "get_runs"));

  // ── VAULT ─────────────────────────────────────────────────────────────────
  console.log("\n🗄️ VAULT");
  record("GET /vault/list", await get(wallet, "/vault/list", "vault_list"));
  record("POST /vault/save", await post(wallet, "/vault/save", "vault_save", { key: "_test_ping", value: "ok", tags: ["test"] }));
  record("GET /vault/entry?key=_test_ping", await get(wallet, "/vault/entry?key=_test_ping", "vault_read"));
  record("GET /vault/search?q=test", await get(wallet, "/vault/search?q=test", "vault_search"));
  record("GET /vault/export", await get(wallet, "/vault/export", "vault_export"));
  record("GET /vault/context", await get(wallet, "/vault/context", "vault_context"));
  record("GET /vault/community", await get(wallet, "/vault/community", "vault_explore"));
  record("GET /vault/credential", await get(wallet, "/vault/credential?key=test", "get_credential"));

  // ── AGENTS ────────────────────────────────────────────────────────────────
  console.log("\n🤖 AGENTS");
  record("GET /agents/list", await get(wallet, "/agents/list", "list_agents"));

  // ── SCANNER ───────────────────────────────────────────────────────────────
  console.log("\n🔍 SCANNER");
  record("GET /wallet/scan (USDC)", await get(wallet, "/wallet/scan?address=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "score_token"));

  // ── BUILD/CODER ───────────────────────────────────────────────────────────
  console.log("\n💻 BUILD");
  record("POST /build/generate", await post(wallet, "/build/generate", "scaffold_project", { type: "component", prompt: "A simple button" }));

  // ── STATS ─────────────────────────────────────────────────────────────────
  console.log("\n📊 STATS");
  record("GET /stats/platform", await get(wallet, "/stats/platform", "get_stats"));

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`✅ ${results.pass} passed  ❌ ${results.fail} failed  💰 ${results.pay} need payment`);
  console.log(`Total: ${results.pass + results.fail + results.pay}`);
}

main().catch(console.error);
