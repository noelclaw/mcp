import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";

// Map raw error strings to actionable categories so users debugging a stuck
// automation see WHAT went wrong (e.g. "insufficient balance") instead of
// just a wall of stack trace. Categories drive both the badge in run history
// and the fix-suggestion line.
type ErrorCategory =
  | "insufficient_balance"
  | "quote_failed"
  | "tx_reverted"
  | "rpc_error"
  | "auth_error"
  | "config_missing"
  | "unknown";

const CATEGORY_PATTERNS: Array<[ErrorCategory, RegExp]> = [
  ["insufficient_balance", /insufficient|not enough|balance|exceeds|nsf/i],
  ["quote_failed",         /quote|0x quote|price impact|liquidity|no route|aggregator/i],
  ["tx_reverted",          /revert|transaction failed|out of gas|execution reverted|nonce/i],
  ["rpc_error",            /rpc|timeout|network|fetch failed|econnrefused|enotfound|gateway/i],
  ["auth_error",           /auth|unauthorized|session|token|forbidden|403|401/i],
  ["config_missing",       /not set|missing|required.*env|env.*required|api_key|api key|wallet not/i],
];

const CATEGORY_BADGE: Record<ErrorCategory, string> = {
  insufficient_balance: "💸 INSUFFICIENT_BALANCE",
  quote_failed:         "📉 QUOTE_FAILED",
  tx_reverted:          "🛑 TX_REVERTED",
  rpc_error:             "🌐 RPC_ERROR",
  auth_error:            "🔐 AUTH_ERROR",
  config_missing:        "⚙️ CONFIG_MISSING",
  unknown:               "❓ UNKNOWN",
};

const CATEGORY_FIX: Record<ErrorCategory, string> = {
  insufficient_balance: "Top up the wallet, lower the per-run amount, or check token allowance.",
  quote_failed:         "Token may have low liquidity. Try a different route, smaller size, or wait and retry.",
  tx_reverted:          "Check token approvals, slippage, and that you have ETH for gas.",
  rpc_error:             "Transient. Re-run shortly. Set NOELCLAW_RPC_URL to a faster provider if it persists.",
  auth_error:            "Run `noelclaw login` to refresh session, or re-issue the API key.",
  config_missing:        "Backend env var likely missing - check noelclaw doctor for the specific config.",
  unknown:               "Unrecognized failure. Open get_automation_runs for the raw error and the chronicle log.",
};

function categorizeError(err: string | undefined | null): ErrorCategory {
  if (!err) return "unknown";
  for (const [cat, pat] of CATEGORY_PATTERNS) {
    if (pat.test(err)) return cat;
  }
  return "unknown";
}

export const AUTOMATION_TOOLS: Tool[] = [
  {
    name: "create_automation",
    description: "Create an automation in plain English. Supports DCA, price alerts, conditional buys/sells, and recurring market updates.",
    inputSchema: {
      type: "object",
      properties: { rawInput: { type: "string", description: "Plain English description of the automation" } },
      required: ["rawInput"],
    },
  },
  {
    name: "list_automations",
    description: "List all your automations - active, paused, and completed - with status, run counts, and next scheduled run.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "pause_automation",
    description: "Pause or resume an automation by ID.",
    inputSchema: {
      type: "object",
      properties: { automationId: { type: "string", description: "Automation ID (from list_automations)" } },
      required: ["automationId"],
    },
  },
  {
    name: "delete_automation",
    description: "Permanently delete an automation. Cannot be undone.",
    inputSchema: {
      type: "object",
      properties: { automationId: { type: "string", description: "Automation ID (from list_automations)" } },
      required: ["automationId"],
    },
  },
  {
    name: "get_automation_runs",
    description: "Get the execution history for an automation - each run's status (success/failed/skipped), amount spent, tx hash, and error message if any. Useful for debugging why an automation isn't working.",
    inputSchema: {
      type: "object",
      properties: {
        automationId: { type: "string", description: "Automation ID (from list_automations)" },
        limit: { type: "number", description: "Max runs to return (default 20)" },
      },
      required: ["automationId"],
    },
  },
  {
    name: "run_automation",
    description:
      "Trigger an automation immediately - regardless of its schedule or trigger condition. " +
      "Use to test an automation after creating it, or to run a one-off DCA/swap/alert right now. " +
      "Pass dryRun:true to simulate (no tx broadcast, no funds moved) - useful for verifying config before real money. " +
      "The automation must be active (not paused or deleted). " +
      "Get the ID from list_automations.",
    inputSchema: {
      type: "object",
      properties: {
        automationId: { type: "string", description: "Automation ID to run now (from list_automations)" },
        dryRun: { type: "boolean", description: "Simulate without broadcasting tx. No funds moved. Use to verify config." },
      },
      required: ["automationId"],
    },
  },
];

const CreateAutomationSchema = z.object({ rawInput: z.string().min(1) });
const AutomationIdSchema = z.object({ automationId: z.string().min(1) });
const RunAutomationSchema = z.object({ automationId: z.string().min(1), dryRun: z.boolean().optional() });
const RunsSchema = z.object({ automationId: z.string().min(1), limit: z.number().int().min(1).max(100).optional() });

export async function handleAutomationTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "create_automation": {
      const parsed = CreateAutomationSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: rawInput ${parsed.error.issues[0].message}` }], isError: true };
      const data = await callConvex("/automations/create", "POST", { rawInput: parsed.data.rawInput }, "create_automation");
      if (!data.success) return { content: [{ type: "text", text: `Failed: ${data.error}` }], isError: true };
      const triggerLabel: Record<string, string> = {
        schedule: "⏰ Schedule", price_drop_pct: "📉 Price Drop %", price_rise_pct: "📈 Price Rise %",
        price_below: "⬇️ Price Below", price_above: "⬆️ Price Above",
        dominance_below: "📊 Dominance Below", dominance_above: "📊 Dominance Above",
      };
      const actionLabel: Record<string, string> = { swap: "💱 Swap", send: "📤 Send", alert: "🔔 Alert" };
      return {
        content: [{
          type: "text",
          text: [
            `✅ **Automation Created**`, ``,
            `**Name:** ${data.name}`, `**ID:** \`${data.automationId}\``,
            `**Trigger:** ${triggerLabel[data.triggerType] ?? data.triggerType}`,
            `**Action:** ${actionLabel[data.actionType] ?? data.actionType}`,
            data.priceBaselineUsd ? `**Baseline price:** $${Number(data.priceBaselineUsd).toLocaleString()}` : ``,
            ``, `Use \`list_automations\` to see all your automations.`,
          ].filter(Boolean).join("\n"),
        }],
      };
    }

    case "list_automations": {
      const data = await callConvex("/automations/list", "GET", undefined, "list_automations");
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
      const automations: any[] = data.automations ?? [];
      if (!automations.length) return { content: [{ type: "text", text: "No automations yet. Use `create_automation` to create one." }] };
      const statusIcon: Record<string, string> = { active: "🟢", paused: "⏸️", completed: "✅", error: "❌" };
      const lines: string[] = [`**Your Automations** (${automations.length})`, ""];
      for (const auto of automations) {
        lines.push(`${statusIcon[auto.status] ?? "•"} **${auto.name}** - \`${auto._id}\``);
        lines.push(`  Trigger: ${auto.triggerType} | Action: ${auto.actionType} | Runs: ${auto.totalRuns}`);
        if (auto.totalSpentUsd > 0) lines.push(`  Total spent: $${Number(auto.totalSpentUsd).toFixed(2)}`);
        if (auto.nextRunAt && auto.status === "active") lines.push(`  Next run: ${new Date(auto.nextRunAt).toUTCString()}`);
        if (auto.lastError) {
          const cat = categorizeError(auto.lastError);
          lines.push(`  ⚠️ Last error [${CATEGORY_BADGE[cat]}]: ${auto.lastError}`);
        }
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "pause_automation": {
      const parsed = AutomationIdSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: automationId ${parsed.error.issues[0].message}` }], isError: true };
      const data = await callConvex("/automations/pause", "POST", { automationId: parsed.data.automationId }, "pause_automation");
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
      const icon = data.status === "active" ? "▶️ Resumed" : "⏸️ Paused";
      return { content: [{ type: "text", text: `${icon} successfully.` }] };
    }

    case "delete_automation": {
      const parsed = AutomationIdSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: automationId ${parsed.error.issues[0].message}` }], isError: true };
      const data = await callConvex("/automations/delete", "POST", { automationId: parsed.data.automationId }, "delete_automation");
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
      return { content: [{ type: "text", text: "🗑️ Automation deleted." }] };
    }

    case "get_automation_runs": {
      const parsed = RunsSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: automationId ${parsed.error.issues[0].message}` }], isError: true };
      const { automationId, limit = 20 } = parsed.data;
      const qs = `automationId=${encodeURIComponent(automationId)}&limit=${limit}`;
      const data = await callConvex(`/automations/runs?${qs}`, "GET", undefined, "get_automation_runs");
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      const runs: any[] = data.runs ?? [];
      if (!runs.length) return { content: [{ type: "text", text: "No runs yet for this automation." }] };

      const statusIcon: Record<string, string> = { success: "✅", failed: "❌", skipped: "⏭️" };
      const lines = [`**Run History** (${runs.length} shown)`, ""];
      // Track failure breakdown so we can show a "top failure cause" line at the bottom.
      const failureCounts = new Map<ErrorCategory, number>();
      for (const r of runs) {
        const icon = statusIcon[r.status] ?? "•";
        const time = new Date(r.triggeredAt).toUTCString();
        const spent = r.amountUsd != null ? ` · $${Number(r.amountUsd).toFixed(2)}` : "";
        const tx = r.txHash ? ` · [tx](https://basescan.org/tx/${r.txHash})` : "";
        lines.push(`${icon} **${r.status}**${spent}${tx} - ${time}`);
        if (r.error) {
          const cat = categorizeError(r.error);
          failureCounts.set(cat, (failureCounts.get(cat) ?? 0) + 1);
          lines.push(`   ${CATEGORY_BADGE[cat]} ${r.error}`);
        }
      }
      if (failureCounts.size > 0) {
        const top = [...failureCounts.entries()].sort((a, b) => b[1] - a[1])[0];
        lines.push("", `**Top failure cause:** ${CATEGORY_BADGE[top[0]]} (${top[1]} run${top[1] !== 1 ? "s" : ""})`);
        lines.push(`→ ${CATEGORY_FIX[top[0]]}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "run_automation": {
      const parsed = RunAutomationSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: automationId ${parsed.error.issues[0].message}` }], isError: true };
      const { automationId, dryRun } = parsed.data;
      const data = await callConvex("/automations/run", "POST", { automationId, dryRun: !!dryRun }, "run_automation");
      if (data.error) {
        const cat = categorizeError(data.error);
        return {
          content: [{
            type: "text",
            text: [
              `❌ **Automation run failed** - ${CATEGORY_BADGE[cat]}`,
              ``,
              `Error: ${data.error}`,
              ``,
              `→ ${CATEGORY_FIX[cat]}`,
            ].join("\n"),
          }],
          isError: true,
        };
      }

      const statusIcon: Record<string, string> = { success: "✅", failed: "❌", skipped: "⏭️" };
      const icon = dryRun ? "🧪" : (statusIcon[data.status] ?? "⚡");
      const spent = data.amountUsd != null ? ` · $${Number(data.amountUsd).toFixed(2)}${dryRun ? " simulated" : " spent"}` : "";
      const txLine = data.txHash ? `\nTx: https://basescan.org/tx/${data.txHash}` : "";
      const dryRunNote = dryRun ? `\n${`🧪 **DRY RUN** - no transaction broadcast, no funds moved.`}` : "";

      // If backend signaled failure inside the payload, surface the category too.
      let failureLine = "";
      if (data.status === "failed" && data.error) {
        const cat = categorizeError(data.error);
        failureLine = `\n\n${CATEGORY_BADGE[cat]} → ${CATEGORY_FIX[cat]}`;
      }

      return {
        content: [{
          type: "text",
          text: [
            `${icon} **Automation triggered: ${data.status ?? (dryRun ? "simulated" : "executed")}**${spent}`,
            dryRunNote,
            data.message ?? "",
            txLine,
            failureLine,
            ``,
            `Use \`get_automation_runs automationId: "${automationId}"\` to see full history.`,
          ].filter(Boolean).join("\n"),
        }],
      };
    }

    default:
      return null;
  }
}
