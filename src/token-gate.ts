import { getOrCreateWallet, BASE_RPC } from "./wallet.js";
import { getSavedToken } from "./config.js";
import type { ToolResult } from "./types.js";

const NOELCLAW_TOKEN = "0x4B524015D54a27d4472F5c59c570730D69499Ba3";
const BALANCE_SELECTOR = "0x70a08231"; // balanceOf(address)
const CACHE_TTL = 5 * 60 * 1000;      // 5 min — avoid per-call RPC

// 1 NOELCLAW (18 decimals). Override via NOELCLAW_MIN_BALANCE env var.
const MIN_BALANCE = BigInt(process.env.NOELCLAW_MIN_BALANCE ?? "1000000000000000000");

export type Tier = "holder" | "basic";

let _cache: { tier: Tier; at: number } | null = null;

async function erc20BalanceOf(address: string): Promise<bigint> {
  const padded = address.toLowerCase().replace("0x", "").padStart(64, "0");
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "eth_call",
      params: [{ to: NOELCLAW_TOKEN, data: BALANCE_SELECTOR + padded }, "latest"],
    }),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json() as { result?: string };
  return BigInt(data.result ?? "0x0");
}

// Session token or API key → always holder (authenticated user)
function hasAuthBypass(): boolean {
  return !!(getSavedToken() || process.env.NOELCLAW_API_KEY);
}

export async function getTier(): Promise<Tier> {
  if (hasAuthBypass()) return "holder";
  if (_cache && Date.now() - _cache.at < CACHE_TTL) return _cache.tier;

  try {
    const wallet = await getOrCreateWallet();
    const balance = await erc20BalanceOf(wallet.address);
    const tier: Tier = balance >= MIN_BALANCE ? "holder" : "basic";
    _cache = { tier, at: Date.now() };
    return tier;
  } catch {
    // RPC unreachable — don't block, degrade gracefully
    return "basic";
  }
}

// Tools that require NOELCLAW token to unlock
export const PREMIUM_TOOLS = new Set<string>([
  // Multi-agent swarm
  "swarm_research", "trigger_agent", "swarm_synthesize", "stop_swarm", "get_swarm_status",
  // Simulation
  "miroshark_simulate", "miroshark_status", "miroshark_stop",
  // AI analysis
  "market_thesis", "trade_plan",
  // Advanced memory
  "memory_insight", "memory_extract", "memory_consolidate",
  // Automations
  "create_automation", "run_automation", "pause_automation", "delete_automation", "get_automation_runs",
  // Autonomous monitors
  "schedule_research", "create_monitor",
  // Persistent agents
  "hire_agent", "agent_spawn", "agent_recall", "agent_update",
]);

export function tokenGateError(toolName: string): ToolResult {
  return {
    content: [{
      type: "text",
      text: [
        "🔒 **Premium Tool**",
        "",
        `\`${toolName}\` requires a Noelclaw account or NOELCLAW token.`,
        "",
        "**Option 1 — Sign in (easiest):**",
        "1. Go to noelclaw.com and sign in",
        "2. Copy your session token from Settings",
        "3. Add to your MCP config: `NOELCLAW_SESSION_TOKEN=noel_...`",
        "",
        "**Option 2 — Hold NOELCLAW token on Base:**",
        "1. Get NOELCLAW  —  CA: `0x4B524015D54a27d4472F5c59c570730D69499Ba3`",
        "2. Hold at least 1 NOELCLAW in your local wallet",
        "3. Access unlocks automatically",
        "",
        "Run `noel_status` to check your current tier.",
      ].join("\n"),
    }],
    isError: true,
  };
}
