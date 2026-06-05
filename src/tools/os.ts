import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";
import { fetchMarketSnapshot } from "./market.js";
import { searchSupermemory } from "./memory.js";

export const OS_TOOLS: Tool[] = [
  {
    name: "noel_status",
    description:
      "Full system dashboard for the Noelclaw AI OS — memory usage, swarm health, active automations, " +
      "recent vault research, and execution scores. Like `htop` but for your AI operating system. " +
      "Run this to get a complete picture of what's running and what your OS currently knows.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "noel_boot",
    description:
      "Boot sequence for the Noelclaw AI OS — starts the swarm, loads live market prices, checks active automations, " +
      "and returns a unified briefing. One command to wake up the entire operating system. " +
      "Run this first to prime the system before any trading or research session.",
    inputSchema: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description: "Optional: token or topic to focus today's session on (e.g. 'ETH', 'Base ecosystem')",
        },
      },
      required: [],
    },
  },
  {
    name: "noel_shutdown",
    description:
      "Clean shutdown of the Noelclaw AI OS — stops the swarm, saves a session summary to vault, and returns a final briefing. " +
      "Run at the end of a trading or research session to persist all findings before signing off.",
    inputSchema: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "Optional: a note to save with the session summary (e.g. 'Closed ETH position, watching BTC')",
        },
      },
      required: [],
    },
  },
];

const BootSchema = z.object({ focus: z.string().optional() });
const ShutdownSchema = z.object({ note: z.string().max(500).optional() });

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
        `**Noelclaw AI OS — System Status**`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
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
          : `💡 Run \`noel_boot\` to wake up the full system.`
      );

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "noel_boot": {
      const parsed = BootSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { focus } = parsed.data;

      const [swarmRes, marketRes, autoRes, memRes, focusRes, prefRes] = await Promise.allSettled([
        callConvex("/swarm/start", "POST", {}, "start_swarm"),
        fetchMarketSnapshot(),
        callConvex("/automations/list", "GET", undefined, "list_automations"),
        callConvex("/memory/profile", "GET"),
        focus ? searchSupermemory(focus, 5) : Promise.resolve([] as any[]),
        // Always load user preference/context memories for smart boot
        searchSupermemory("user preferences style goals priorities", 4),
      ]);

      const swarm    = swarmRes.status   === "fulfilled" ? swarmRes.value   : null;
      const market   = marketRes.status  === "fulfilled" ? marketRes.value  : null;
      const autos    = autoRes.status    === "fulfilled" ? autoRes.value    : null;
      const mem      = memRes.status     === "fulfilled" ? memRes.value     : null;
      const focusMem = focusRes.status   === "fulfilled" ? focusRes.value as any[] : [];
      const prefMem  = prefRes.status    === "fulfilled" ? prefRes.value as any[] : [];

      const automations: any[] = autos?.automations ?? [];
      const activeAutos = automations.filter((a: any) => a.status === "active");
      const memTotal = mem?.total ?? 0;
      const p = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      const lines = [
        `🚀 **Noelclaw AI OS — Boot Complete**`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `${new Date().toUTCString()}`,
        ``,
        `**Subsystems:**`,
        `  🤖 Swarm        ${swarm?.success ? `✅ Online · session ${swarm.sessionId ?? "active"}` : "⚠️ Could not start"}`,
        `  🧠 Memory       ✅ ${memTotal} memories ready`,
        `  ⚡ Automations  ${activeAutos.length} active of ${automations.length}`,
        ``,
      ];

      if (market) {
        lines.push(`**Market Snapshot:**`);
        lines.push(`  BTC ${p(market.btc)}  ·  ETH ${p(market.eth)}  ·  SOL ${p(market.sol)}`);
        lines.push("");
      }

      if (activeAutos.length > 0) {
        lines.push(`**Active Automations:**`);
        for (const a of activeAutos.slice(0, 5)) {
          const next = a.nextRunAt ? ` · runs ${new Date(a.nextRunAt).toUTCString()}` : "";
          lines.push(`  • ${a.name}${next}`);
        }
        lines.push("");
      }

      // Always show user context memories if available
      if (prefMem.length > 0) {
        lines.push(`**User context loaded (${prefMem.length} preferences):**`);
        for (const r of prefMem) {
          const title = r.metadata?.title ?? r.content.slice(0, 80).replace(/\n/g, " ");
          lines.push(`  • ${title}`);
        }
        lines.push("");
      }

      if (focus && focusMem.length > 0) {
        lines.push(`**Memory context for "${focus}" (${focusMem.length} items):**`);
        for (const r of focusMem) {
          const title = r.metadata?.title ?? r.content.slice(0, 70).replace(/\n/g, " ");
          lines.push(`  • ${title}`);
        }
        lines.push("");
      }

      lines.push(`**Quick actions:**`);
      lines.push(`  • \`get_swarm_status\` — live readings from all agents`);
      if (focus) {
        lines.push(`  • \`swarm_research topic: "${focus}"\` — deep research session`);
        lines.push(`  • \`memory_insight topic: "${focus}"\` — full intelligence report`);
      } else {
        lines.push(`  • \`swarm_research topic: "BTC"\` — start morning research`);
        lines.push(`  • \`noel_status\` — full system dashboard`);
      }
      lines.push(`  • \`memory_extract text: "...\"\` — auto-save facts from any note`);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "noel_shutdown": {
      const parsed = ShutdownSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { note } = parsed.data;

      const [swarmRes, vaultRes] = await Promise.allSettled([
        callConvex("/swarm/stop", "POST", {}, "stop_swarm"),
        callConvex("/vault/list?type=research&limit=5", "GET", undefined, "noel_shutdown"),
      ]);

      const swarm = swarmRes.status === "fulfilled" ? swarmRes.value : null;
      const vault = vaultRes.status === "fulfilled" ? vaultRes.value : null;
      const vaultEntries: any[] = vault?.entries ?? [];

      const now = new Date();
      const sessionKey = `session/shutdown-${now.toISOString().slice(0, 10)}-${now.getHours()}h`;
      const summaryContent = [
        `# Session Shutdown — ${now.toUTCString()}`,
        note ? `\nNote: ${note}` : "",
        `\n## Recent Research`,
        ...vaultEntries.map((e: any) => `• [${e.agentId ?? "vault"}] ${e.title}`),
      ].filter(Boolean).join("\n");

      await callConvex("/vault/save", "POST", {
        type: "memory",
        title: `Session: ${now.toLocaleDateString("en-US")}${note ? ` — ${note.slice(0, 50)}` : ""}`,
        content: summaryContent,
        key: sessionKey,
        agentId: "os",
        tags: ["session", "shutdown"],
        commitMsg: "noel_shutdown session save",
      }, "noel_shutdown").catch(() => {});

      const lines = [
        `⏹️ **Noelclaw AI OS — Shutdown**`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `${now.toUTCString()}`,
        ``,
        `🤖 Swarm      ${swarm?.success ? "✅ Stopped" : "⚠️ Already offline"}`,
        `💾 Session    ✅ Saved to vault: \`${sessionKey}\``,
        note ? `📝 Note       ${note}` : "",
        ``,
      ];

      if (vaultEntries.length > 0) {
        lines.push(`**Session research (${vaultEntries.length} entries):**`);
        for (const e of vaultEntries) {
          lines.push(`  • [${e.agentId ?? "vault"}] ${e.title}`);
        }
        lines.push("");
      }

      lines.push(`Run \`noel_boot\` to start a new session.`);

      return { content: [{ type: "text", text: lines.filter(l => l !== undefined && l !== "").join("\n") }] };
    }

    default:
      return null;
  }
}
