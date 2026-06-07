import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";

export const OS_TOOLS: Tool[] = [
  {
    name: "noel_status",
    description:
      "Full system dashboard for the Noelclaw AI OS â€” memory usage, swarm health, active automations, " +
      "recent vault research, and execution scores. Like `htop` but for your AI operating system. " +
      "Run this to get a complete picture of what's running and what your OS currently knows.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

export async function handleOsTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "noel_status": {
      const [memRes, swarmRes, autoRes, vaultRes, scoresRes] = await Promise.allSettled([
        callConvex("/memory/profile", "GET"),
        callConvex("/swarm/status", "GET", undefined, "get_swarm_status"),
        callConvex("/automations/list", "GET", undefined, "list_automations"),
        callConvex("/vault/list?type=research&limit=5", "GET", undefined, "noel_status"),
        callConvex("/swarm/scores", "GET", undefined, "get_execution_scores"),
      ]);

      const mem    = memRes.status    === "fulfilled" ? memRes.value    : null;
      const swarm  = swarmRes.status  === "fulfilled" ? swarmRes.value  : null;
      const autos  = autoRes.status   === "fulfilled" ? autoRes.value   : null;
      const vault  = vaultRes.status  === "fulfilled" ? vaultRes.value  : null;
      const scores = scoresRes.status === "fulfilled" ? scoresRes.value : null;

      const automations: any[] = autos?.automations ?? [];
      const activeAutos = automations.filter((a: any) => a.status === "active");
      const vaultEntries: any[] = vault?.entries ?? [];
      const allScores: any[] = (scores?.scores ?? []).sort((a: any, b: any) => b.lastScore - a.lastScore);
      const topScore = allScores[0];
      const swarmActive = swarm?.active ?? false;
      const memTotal = mem?.total ?? 0;
      const memStatus = mem?.status ?? "unknown";

      const lines = [
        `**Noelclaw AI OS â€” System Status**`,
        `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`,
        ``,
        `ðŸ§  **Memory**       ${memStatus === "ok" ? "âœ…" : "âš ï¸"} ${memTotal} memories Â· Space: ${mem?.space ?? "â€”"}`,
        `ðŸ¤– **Swarm**        ${swarmActive ? "âœ… Active" : "â¹ï¸ Offline"} Â· ${swarm?.memory?.length ?? 0} shared memory entries`,
        `âš¡ **Automations**  ${activeAutos.length} active of ${automations.length} total`,
        allScores.length
          ? `ðŸ“Š **Top Skill**    ${topScore.skillName} â€” ${((topScore.lastScore ?? 0) * 100).toFixed(0)}% Â· ${topScore.successCount}W/${topScore.failCount}L`
          : `ðŸ“Š **Skills**       No execution history yet`,
        ``,
      ];

      if (activeAutos.length > 0) {
        lines.push(`**Active Automations:**`);
        for (const a of activeAutos.slice(0, 5)) {
          const next = a.nextRunAt ? ` Â· next ${new Date(a.nextRunAt).toUTCString()}` : "";
          lines.push(`  â€¢ ${a.name} â€” ${a.triggerType}${next}`);
        }
        lines.push("");
      }

      if (vaultEntries.length > 0) {
        lines.push(`**Recent Research:**`);
        for (const e of vaultEntries) {
          lines.push(`  â€¢ [${e.agentId ?? "vault"}] ${e.title}`);
        }
        lines.push("");
      }

      lines.push(
        swarmActive
          ? `ðŸ’¡ Run \`get_swarm_status\` for a live snapshot from all agents.`
          : `ðŸ’¡ Run \`swarm_research\` to start a research session.`
      );

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    default:
      return null;
  }
}
