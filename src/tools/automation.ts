import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";

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
    description: "List all your automations — active, paused, and completed — with status, run counts, and next scheduled run.",
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
    description: "Get the execution history for an automation — each run's status (success/failed/skipped), amount spent, tx hash, and error message if any. Useful for debugging why an automation isn't working.",
    inputSchema: {
      type: "object",
      properties: {
        automationId: { type: "string", description: "Automation ID (from list_automations)" },
        limit: { type: "number", description: "Max runs to return (default 20)" },
      },
      required: ["automationId"],
    },
  },
];

const CreateAutomationSchema = z.object({ rawInput: z.string().min(1) });
const AutomationIdSchema = z.object({ automationId: z.string().min(1) });
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
        lines.push(`${statusIcon[auto.status] ?? "•"} **${auto.name}** — \`${auto._id}\``);
        lines.push(`  Trigger: ${auto.triggerType} | Action: ${auto.actionType} | Runs: ${auto.totalRuns}`);
        if (auto.totalSpentUsd > 0) lines.push(`  Total spent: $${Number(auto.totalSpentUsd).toFixed(2)}`);
        if (auto.nextRunAt && auto.status === "active") lines.push(`  Next run: ${new Date(auto.nextRunAt).toUTCString()}`);
        if (auto.lastError) lines.push(`  ⚠️ Last error: ${auto.lastError}`);
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
      for (const r of runs) {
        const icon = statusIcon[r.status] ?? "•";
        const time = new Date(r.triggeredAt).toUTCString();
        const spent = r.amountUsd != null ? ` · $${Number(r.amountUsd).toFixed(2)}` : "";
        const tx = r.txHash ? ` · [tx](https://basescan.org/tx/${r.txHash})` : "";
        lines.push(`${icon} **${r.status}**${spent}${tx} — ${time}`);
        if (r.error) lines.push(`   ⚠️ ${r.error}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    default:
      return null;
  }
}
