import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";
import { fetchMarketSnapshot } from "./market.js";
import { searchSupermemory } from "./memory.js";

function formatDate(ts: number): string {
  return new Date(ts).toUTCString();
}

export const SWARM_TOOLS: Tool[] = [
  {
    name: "start_swarm",
    description: "Start the multi-agent swarm for autonomous market monitoring, sentiment tracking, and workflow execution.",
    inputSchema: {
      type: "object",
      properties: {
        config: {
          type: "object",
          description: "Optional swarm config",
          properties: {
            enabledAgents: { type: "array", items: { type: "string" }, description: "Agent IDs to enable" },
            byok: { type: "boolean", description: "Use your own Bankr API key" },
          },
        },
      },
      required: [],
    },
  },
  {
    name: "stop_swarm",
    description: "Stop the active swarm session for a user.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_swarm_status",
    description: "Get the current status of the swarm: active agents, shared memory snapshot, execution scores, and recent runs.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "swarm_research",
    description:
      "Research any topic using the multi-agent swarm — automatically starts the swarm if needed, " +
      "triggers market-monitor and sentiment-tracker immediately, and saves all findings to vault. " +
      "Use this when the user asks the swarm to research, analyze, or dig into any token, protocol, or market topic.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "What to research — token name, project, narrative, or market question" },
        depth: { type: "string", enum: ["quick", "standard", "deep"], description: "Research depth (default: standard)" },
      },
      required: ["topic"],
    },
  },
  {
    name: "trigger_agent",
    description:
      "Run a single swarm agent immediately — automatically starts the swarm if needed. " +
      "Agents: market-monitor (live prices), sentiment-tracker (social/sentiment), " +
      "memory-manager (compress memory), risk-verifier (evaluate risk), " +
      "onchain-analyst (on-chain data: wallets, flows, TVL), " +
      "news-aggregator (latest news + narrative tracking). " +
      "Results are saved to vault automatically.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          enum: ["market-monitor", "sentiment-tracker", "memory-manager", "risk-verifier", "workflow-executor", "onchain-analyst", "news-aggregator"],
          description: "Which agent to run",
        },
        params: {
          type: "object",
          description: "Agent-specific params. market-monitor: { token: 'BTC' }. sentiment-tracker: { token: 'ETH' } or { topic: 'Layer 2s' }. onchain-analyst: { address: '0x...' } or { protocol: 'Morpho' }. news-aggregator: { topic: 'Base ecosystem' }.",
        },
      },
      required: ["agentId"],
    },
  },
  {
    name: "swarm_brief",
    description:
      "Get a summary of everything the swarm has researched and saved to your vault. " +
      "Shows the latest research entries written by swarm agents across all sessions. " +
      "Use this to catch up on what the swarm found while you were away.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max entries to return (default 10)" },
      },
      required: [],
    },
  },
];

const StartSwarmSchema = z.object({
  config: z.object({
    enabledAgents: z.array(z.string()).optional(),
    byok: z.boolean().optional(),
  }).optional(),
});
const ResearchSchema = z.object({ topic: z.string().min(1), depth: z.enum(["quick", "standard", "deep"]).optional() });
const BriefSchema = z.object({ limit: z.number().optional() });
const TriggerAgentSchema = z.object({
  agentId: z.enum(["market-monitor", "sentiment-tracker", "memory-manager", "risk-verifier", "workflow-executor", "onchain-analyst", "news-aggregator"]),
  params: z.record(z.string(), z.any()).optional(),
});
const NO_KEY_MSG =
  `🔑 Swarm tools require a NoelClaw API key.\n\n` +
  `→ Get yours free at: https://noelclaw.com\n\n` +
  `Then add it to your MCP config:\n` +
  `  "env": { "NOELCLAW_API_KEY": "noel_sk_..." }`;

function swarmAuthError(err: unknown): ToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  const isAuth = msg.includes("🔑") || msg.includes("Authentication") || msg.includes("401");
  return {
    content: [{ type: "text", text: isAuth ? NO_KEY_MSG : `Swarm error: ${msg}` }],
    isError: true,
  };
}

export async function handleSwarmTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "start_swarm": {
      const parsed = StartSwarmSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: config ${parsed.error.issues[0].message}` }], isError: true };
      let data: any;
      try {
        data = await callConvex("/swarm/start", "POST", { config: parsed.data.config }, "start_swarm");
      } catch (err) { return swarmAuthError(err); }
      if (!data.success) return { content: [{ type: "text", text: `Failed: ${data.error}` }], isError: true };

      const snapshot = await fetchMarketSnapshot();
      if (snapshot) {
        const ts = new Date().toUTCString();
        const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${ts})`;
        const priceOnly = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        await Promise.all([
          callConvex("/swarm/memory/write", "POST", { agentId: "market-monitor", key: "BTC/USD", value: fmt(snapshot.btc) }, "write_swarm_memory"),
          callConvex("/swarm/memory/write", "POST", { agentId: "market-monitor", key: "ETH/USD", value: fmt(snapshot.eth) }, "write_swarm_memory"),
          callConvex("/swarm/memory/write", "POST", { agentId: "market-monitor", key: "SOL/USD", value: fmt(snapshot.sol) }, "write_swarm_memory"),
          callConvex("/swarm/memory/write", "POST", { agentId: "market-monitor", key: "btc_price", value: priceOnly(snapshot.btc) }, "write_swarm_memory"),
          callConvex("/swarm/memory/write", "POST", { agentId: "market-monitor", key: "eth_price", value: priceOnly(snapshot.eth) }, "write_swarm_memory"),
          callConvex("/swarm/memory/write", "POST", { agentId: "market-monitor", key: "sol_price", value: priceOnly(snapshot.sol) }, "write_swarm_memory"),
        ]);
      }

      const p = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      return {
        content: [{
          type: "text",
          text: [
            `🤖 **Swarm Started**`,
            `Session ID: ${data.sessionId}`,
            `Started at: ${data.startedAt}`,
            snapshot ? `Market: BTC ${p(snapshot.btc)} | ETH ${p(snapshot.eth)} | SOL ${p(snapshot.sol)}` : "",
            ``,
            `Use \`get_swarm_status\` to monitor, \`stop_swarm\` to stop.`,
          ].filter(Boolean).join("\n"),
        }],
      };
    }

    case "stop_swarm": {
      let data: any;
      try { data = await callConvex("/swarm/stop", "POST", {}, "stop_swarm"); } catch (err) { return swarmAuthError(err); }
      if (!data.success) return { content: [{ type: "text", text: `Failed: ${data.error}` }], isError: true };
      return { content: [{ type: "text", text: `⏹️ Swarm stopped.` }] };
    }

    case "get_swarm_status": {
      let data: any;
      try { data = await callConvex("/swarm/status", "GET", undefined, "get_swarm_status"); } catch (err) { return swarmAuthError(err); }
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
      const session = data.session;
      const memory: any[] = data.memory ?? [];
      const scores: any[] = data.scores ?? [];
      const lines: string[] = [
        `🤖 **Swarm Status**`,
        data.active && session ? `Status: active | Session: ${session.id}` : `No active swarm.`,
        ``,
      ];
      if (memory.length > 0) {
        lines.push(`**Shared Memory** (${memory.length} entries)`);
        for (const m of memory.slice(0, 5)) lines.push(`• [${m.agentId}] ${m.key}: ${m.value.slice(0, 80)}`);
        if (memory.length > 5) lines.push(`  …and ${memory.length - 5} more`);
        lines.push("");
      }
      if (scores.length > 0) {
        lines.push(`**Execution Scores** (top skills)`);
        const sorted = scores.sort((a: any, b: any) => b.lastScore - a.lastScore).slice(0, 5);
        for (const s of sorted) lines.push(`• ${s.skillName}: ${(s.lastScore * 100).toFixed(0)}% | ${s.successCount}W/${s.failCount}L | avg ${Math.round(s.avgDurationMs / 1000)}s`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "swarm_research": {
      const parsed = ResearchSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { topic, depth = "standard" } = parsed.data;

      // Check what's already known before launching — show value immediately
      const [priorMem] = await Promise.allSettled([searchSupermemory(topic, 4)]);
      const priorResults = priorMem.status === "fulfilled" ? priorMem.value : [];

      await callConvex("/swarm/start", "POST", {}, "start_swarm").catch(() => {});

      let data: any;
      try { data = await callConvex("/swarm/research", "POST", { topic, depth }, "swarm_research"); } catch (err) { return swarmAuthError(err); }
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      const priorSection = priorResults.length > 0
        ? [
            ``,
            `**Prior knowledge loaded (${priorResults.length} memories):**`,
            ...priorResults.map(r => `• ${r.metadata?.title ?? r.content.slice(0, 80).replace(/\n/g, " ")}`),
            `Agents will build on this — no re-discovering what you already know.`,
          ]
        : [``, `No prior knowledge found — agents starting fresh.`];

      return {
        content: [{
          type: "text",
          text: [
            `🔬 **Swarm Research Started**`,
            `Topic: ${topic} · Depth: ${depth}`,
            ...priorSection,
            ``,
            data.message ?? "Research triggered. Findings will appear in vault automatically.",
            ``,
            `**Next:** \`swarm_reflect focus: "${topic}"\` to consolidate findings`,
            `Or: \`memory_insight topic: "${topic}"\` to see full intelligence report`,
          ].join("\n"),
        }],
      };
    }

    case "trigger_agent": {
      const parsed = TriggerAgentSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { agentId, params = {} } = parsed.data;

      await callConvex("/swarm/start", "POST", {}, "start_swarm").catch(() => {});

      // Auto-load prior context so agent doesn't re-discover what's already known
      const contextQuery = [agentId, (params as any)?.token, (params as any)?.topic, (params as any)?.protocol].filter(Boolean).join(" ");
      const priorContext = await searchSupermemory(contextQuery, 3);
      const priorSummary = priorContext.length > 0
        ? priorContext.map(r => r.content.slice(0, 150)).join(" | ")
        : null;
      const enrichedParams = priorSummary ? { ...params, priorContext: priorSummary } : params;

      let data: any;
      try { data = await callConvex("/swarm/trigger", "POST", { agentId, params: enrichedParams }, "trigger_agent"); } catch (err) { return swarmAuthError(err); }
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
      const resultText = data.result ? `\n\`\`\`json\n${JSON.stringify(data.result, null, 2).slice(0, 800)}\n\`\`\`` : "";
      const contextNote = priorContext.length > 0 ? `🧠 ${priorContext.length} prior memory entries injected into agent context.` : "";
      return {
        content: [{
          type: "text",
          text: [
            `⚡ **${agentId} triggered**`,
            contextNote,
            resultText,
            ``,
            `Findings saved to vault automatically.`,
            `Use \`swarm_reflect\` to consolidate or \`memory_insight topic: "${contextQuery.split(" ")[1] ?? agentId}"\` for full report.`,
          ].filter(Boolean).join("\n"),
        }],
      };
    }

    case "swarm_brief": {
      const parsed = BriefSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const limit = parsed.data.limit ?? 10;
      const params = new URLSearchParams({ type: "research", limit: String(limit) });
      let data: any;
      try { data = await callConvex(`/vault/list?${params}`, "GET", undefined, "swarm_brief"); } catch (err) { return swarmAuthError(err); }
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      const entries: any[] = (data.entries ?? []).filter((e: any) =>
        e.agentId === "market-monitor" || e.agentId === "sentiment-tracker"
      );

      if (!entries.length) {
        return { content: [{ type: "text", text: `No swarm research in vault yet.\nStart the swarm with \`start_swarm\` or run \`swarm_research topic: "BTC"\` to build your knowledge base.` }] };
      }

      const lines = [`📋 **Swarm Brief** — ${entries.length} research entries in vault\n`];
      for (const e of entries) {
        lines.push(`**[${e.agentId}]** ${e.title}`);
        lines.push(`  _${e.key}_ · v${e.version} · ${formatDate(e.updatedAt)}`);
      }
      lines.push(`\nUse \`memory_context topic: "<topic>"\` to load full content for any research area.`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    default:
      return null;
  }
}
