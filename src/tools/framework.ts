import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";

export const FRAMEWORK_TOOLS: Tool[] = [
  {
    name: "list_playbooks",
    description:
      "List available Noel Framework playbooks - predefined multi-step workflows. " +
      "Includes 4 system playbooks (Daily Market Scan, DCA Setup, Portfolio Rebalance Check, " +
      "Research Sweep) plus any you've created. Each step is Sentinel-gated.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "run_playbook",
    description:
      "Execute a Noel Framework playbook. Each step runs through Sentinel before the " +
      "matching tool executes it. Steps map directly to noelclaw tools (market, vault, agent, " +
      "memory, automation). Playbook halts immediately if Sentinel blocks a step.",
    inputSchema: {
      type: "object",
      properties: {
        playbook_name: {
          type: "string",
          description: "Exact name of the playbook. Use list_playbooks to see available ones.",
        },
        task_description: {
          type: "string",
          description: "Optional context passed as overrideParams to the playbook run.",
        },
      },
      required: ["playbook_name"],
    },
  },
  {
    name: "get_noel_ledger",
    description:
      "Get the Noel Framework audit trail - every Sentinel gate decision " +
      "(approved / blocked / warned), which checks ran, duration, and reason. " +
      "Full transparency on what agents are and aren't allowed to do.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

export async function handleFrameworkTool(name: string, args: unknown): Promise<ToolResult | null> {
  const a = (args ?? {}) as Record<string, any>;

  switch (name) {
    // ── list_playbooks ──────────────────────────────────────────────────────
    case "list_playbooks": {
      const result = await callConvex("/framework/playbooks", "GET", undefined, "list_playbooks");
      const pbs: any[] = result.playbooks ?? [];
      if (pbs.length === 0) {
        return { content: [{ type: "text", text: "No playbooks found." }] };
      }
      const list = pbs
        .map((p: any) => {
          const steps = (() => {
            try { return JSON.parse(p.steps).length; } catch { return "?"; }
          })();
          return `• **${p.name}**${p.isPublic ? " 🌐" : " 👤"} - ${steps} steps\n  ${p.description}\n  Used ${p.usageCount} times`;
        })
        .join("\n\n");
      return { content: [{ type: "text", text: `**Available Playbooks**\n\n${list}` }] };
    }

    // ── run_playbook ────────────────────────────────────────────────────────
    case "run_playbook": {
      if (!a.playbook_name) {
        return { content: [{ type: "text", text: "playbook_name is required" }], isError: true };
      }

      // Resolve playbook ID by name
      const pbList = await callConvex("/framework/playbooks", "GET", undefined, "run_playbook");
      const playbook = (pbList.playbooks ?? []).find(
        (p: any) => p.name.toLowerCase() === String(a.playbook_name).toLowerCase(),
      );
      if (!playbook) {
        return {
          content: [{
            type: "text",
            text: `Playbook "${a.playbook_name}" not found. Use list_playbooks to see available ones.`,
          }],
          isError: true,
        };
      }

      const result = await callConvex("/framework/playbook/run", "POST", {
        playbookId: playbook._id,
        overrideParams: a.task_description,
      }, "run_playbook");

      if (result.error) {
        return { content: [{ type: "text", text: `Run failed: ${result.error}` }], isError: true };
      }

      if (result.blocked) {
        return {
          content: [{
            type: "text",
            text: [
              `🛡️ **Sentinel blocked playbook at step ${result.step}**`,
              ``,
              `**Tool:** ${result.tool}`,
              `**Reason:** ${result.reason}`,
              ``,
              `This is a mechanical safety gate. The action violates the agent's permission boundary.`,
              `Completed steps before block: ${result.results?.length ?? 0}`,
            ].join("\n"),
          }],
        };
      }

      const steps: any[] = result.results ?? [];
      const succeeded = steps.filter(r => r.success).length;
      const stepLines = steps.map((r: any) =>
        `${r.success ? "✅" : "❌"} Step ${r.step} [${r.role}]: ${r.tool}${r.error ? ` - ${r.error}` : ""}`,
      );

      return {
        content: [{
          type: "text",
          text: [
            `✅ **Playbook "${a.playbook_name}" completed**`,
            ``,
            `${succeeded}/${steps.length} steps successful`,
            `Run ID: \`${result.runId}\``,
            ``,
            ...stepLines,
          ].join("\n"),
        }],
      };
    }

    // ── get_noel_ledger ─────────────────────────────────────────────────────
    case "get_noel_ledger": {
      const result = await callConvex("/swarm/ledger", "GET", undefined, "get_noel_ledger");
      const entries: any[] = result.entries ?? [];
      if (entries.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No ledger entries yet. Run a playbook to see Sentinel decisions.",
          }],
        };
      }
      const lines = entries.map((e: any) => {
        const icon = e.decision === "approved" ? "✅" : e.decision === "blocked" ? "🚫" : "⚠️";
        return `${icon} **${e.agentId}** → \`${e.action}\`\n  ${e.reason} (${e.durationMs}ms)`;
      });
      return {
        content: [{
          type: "text",
          text: `**Noel Ledger** (last ${entries.length} decisions)\n\n${lines.join("\n\n")}`,
        }],
      };
    }

    default:
      return null;
  }
}
