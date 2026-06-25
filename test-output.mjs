/**
 * Quick MCP test — spawns the server over stdio, sends JSON-RPC calls,
 * prints real output so we can base the visual mockup on actual data.
 */
import { spawn } from "child_process";

const srv = spawn("node", ["dist/index.js"], {
  env: { ...process.env },
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
const pending = new Map();
let id = 0;

srv.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  const lines = buf.split("\n");
  buf = lines.pop(); // keep incomplete line
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    } catch {}
  }
});

srv.stderr.on("data", (d) => {
  // suppress server startup noise
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const reqId = ++id;
    pending.set(reqId, { resolve, reject });
    const msg = JSON.stringify({ jsonrpc: "2.0", id: reqId, method, params });
    srv.stdin.write(msg + "\n");
    setTimeout(() => {
      if (pending.has(reqId)) {
        pending.delete(reqId);
        reject(new Error(`Timeout: ${method}`));
      }
    }, 120_000);
  });
}

async function callTool(name, args) {
  return send("tools/call", { name, arguments: args });
}

async function main() {
  // 1. Initialize
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-runner", version: "1" },
  });

  console.log("=".repeat(60));
  console.log("TEST 1: vault_read with wrong key (error message test)");
  console.log("=".repeat(60));
  const vaultErr = await callTool("vault_read", { key: "research/nonexistent-key-test" });
  const vaultText = vaultErr?.result?.content?.[0]?.text ?? JSON.stringify(vaultErr);
  console.log(vaultText);

  console.log("\n" + "=".repeat(60));
  console.log("TEST 2: ask_noel (context transparency test)");
  console.log("=".repeat(60));
  const askRes = await callTool("ask_noel", {
    question: "what are the best Base DeFi yields right now?",
  });
  const askText = askRes?.result?.content?.[0]?.text ?? JSON.stringify(askRes);
  // Show first 800 chars — enough to see the context header
  console.log(askText.slice(0, 800));
  if (askText.length > 800) console.log("\n... [truncated]");

  console.log("\n" + "=".repeat(60));
  console.log("TEST 3: deep_research fast mode (source class tag test)");
  console.log("=".repeat(60));
  console.log("Running deep_research depth=fast — takes ~45s...");
  const drRes = await callTool("deep_research", {
    query: "Model Context Protocol MCP servers adoption across AI coding tools 2025 2026",
    depth: "fast",
  });
  const drText = drRes?.result?.content?.[0]?.text ?? JSON.stringify(drRes);
  console.log(drText.slice(0, 2000));
  if (drText.length > 2000) console.log("\n... [truncated, full output is " + drText.length + " chars]");

  srv.stdin.end();
  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e.message);
  srv.stdin.end();
  process.exit(1);
});
