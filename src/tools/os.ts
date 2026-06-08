import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";
import { getTier } from "../token-gate.js";
import { getOrCreateWallet } from "../wallet.js";

export const OS_TOOLS: Tool[] = [
  {
    name: "noel_status",
    description:
      "Full system dashboard for the Noelclaw AI OS — memory usage, swarm health, active automations, " +
      "recent vault research, execution scores, and your token tier. Like `htop` but for your AI operating system. " +
      "Run this to get a complete picture of what's running and what your OS currently knows.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

export async function handleOsTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "noel_status": {
      const [tierResult, walletResult, memRes, swarmRes, autoRes, vaultRes, scoresRes] = await Promise.allSettled([
        getTier(),
        getOrCreateWallet(),
        callConvex("/memory/profile", "GET"),
        callConvex("/swarm/status", "GET", undefined, "get_swarm_status"),
        callConvex("/automations/list", "GET", undefined, "list_automations"),
        callConvex("/vault/list?type=research&limit=5", "GET", undefined, "noel_status"),
        callConvex("/swarm/scores", "GET", undefined, "get_execution_scores"),
      ]);

      const tier   = tierResult.status   === "fulfilled" ? tierResult.value   : "basic";
      const wallet = walletResult.status === "fulfilled" ? walletResult.value : null;
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

      const tierLabel = tier === "holder"
        ? "\u{1F7E2} **Holder**  — all 90 tools unlocked"
        : "⚪ **Basic**   — hold NOELCLAW on Base to unlock premium tools";
      const walletShort = wallet
        ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
        : "not configured";

      const lines = [
        `**Noelclaw AI OS — System Status**`,
        `────────────────────────────────`,
        ``,
        `🔑 **Tier**         ${tierLabel}`,
        `👛 **Wallet**       ${walletShort}`,
        ``,
        `🧠 **Memory**       ${memStatus === "ok" ? "✅" : "⚠️"} ${memTotal} memories · Space: ${mem?.space ?? "—"}`,
        `🤖 **Swarm**        ${swarmActive ? "✅ Active" : "⏹️ Offline"} · ${swarm?.memory?.length ?? 0} shared memory entries`,
        `⚡ **Automations**  ${activeAutos.length} active of ${automations.length} total`,
        allScores.length
          ? `📊 **Top Skill**    ${topScore.skillName} — ${((topScore.lastScore ?? 0) * 100).toFixed(0)}% · ${topScore.successCount}W/${topScore.failCount}L`
          : `📊 **Skills**       No execution history yet`,
        ``,
      ];

      if (activeAutos.length > 0) {
        lines.push(`**Active Automations:**`);
        for (const a of activeAutos.slice(0, 5)) {
          const next = a.nextRunAt ? ` · next ${new Date(a.nextRunAt).toUTCString()}` : "";
          lines.push(`  • ${a.name} — ${a.triggerType}${next}`);
        }
        lines.push("");
      }

      if (vaultEntries.length > 0) {
        lines.push(`**Recent Research:**`);
        for (const e of vaultEntries) {
          lines.push(`  • [${e.agentId ?? "vault"}] ${e.title}`);
        }
        lines.push("");
      }

      lines.push(
        swarmActive
          ? `💡 Run \`get_swarm_status\` for a live snapshot from all agents.`
          : `💡 Run \`swarm_research\` to start a research session.`
      );

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    default:
      return null;
  }
}
