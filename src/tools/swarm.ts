import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";
import { fetchMarketSnapshot } from "./market.js";
import { searchSupermemory, syncToSupermemory } from "./memory.js";

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
    name: "write_swarm_memory",
    description: "Write a key-value pair to the swarm's shared memory.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "ID of the agent writing this memory entry" },
        key: { type: "string", description: "Memory key" },
        value: { type: "string", description: "Value to store" },
        ttlSeconds: { type: "number", description: "Optional TTL in seconds" },
      },
      required: ["agentId", "key", "value"],
    },
  },
  {
    name: "get_swarm_memory",
    description: "Read a value from the swarm's shared memory by key.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string", description: "Memory key to read" } },
      required: ["key"],
    },
  },
  {
    name: "get_execution_scores",
    description: "Get the self-improvement scores for all skills.",
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
  {
    name: "swarm_broadcast",
    description:
      "Broadcast a message or signal to all active swarm agents simultaneously. " +
      "All agents will receive and act on the message in their next cycle. " +
      "Use to coordinate the swarm: change focus, alert about market conditions, or inject a directive.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message to broadcast to all agents (max 500 chars)" },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"], description: "Message priority (default: normal)" },
        targetAgents: { type: "array", items: { type: "string" }, description: "Optional: target specific agent IDs. Omit to broadcast to all." },
      },
      required: ["message"],
    },
  },
  {
    name: "swarm_pulse",
    description:
      "Get an instant snapshot from all swarm agents — market prices, sentiment, on-chain activity, and agent health. " +
      "Unlike get_swarm_status, swarm_pulse triggers all agents to report their latest readings right now. " +
      "Best for a quick market briefing or sanity check before making decisions.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Optional: focus the pulse on a specific token (e.g. 'BTC', 'ETH')" },
      },
      required: [],
    },
  },
  {
    name: "swarm_reflect",
    description:
      "Consolidate everything the swarm has learned into a single coherent intelligence summary. " +
      "Reads all recent research vault entries from swarm agents, groups by agent, extracts key signals, " +
      "and saves a unified reflection to vault. " +
      "Run this after swarm_research or swarm_pulse to crystallize findings into long-term memory. " +
      "Best used once per research session or daily for ongoing monitoring.",
    inputSchema: {
      type: "object",
      properties: {
        hoursBack: { type: "number", description: "How many hours of swarm activity to include (default: 24)" },
        focus: { type: "string", description: "Optional: focus reflection on a specific topic or token" },
      },
      required: [],
    },
  },
  {
    name: "swarm_watch",
    description:
      "Register a topic or token for continuous swarm monitoring. " +
      "Swarm agents will prioritize this topic in every cycle — price changes, sentiment shifts, news, on-chain flows. " +
      "Findings are saved to vault and semantic memory automatically. " +
      "Use memory_insight or swarm_brief to check accumulated findings. " +
      "Alert conditions: price_spike | sentiment_shift | news | whale_move | all.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "What to watch — token symbol, protocol name, or any topic (e.g. 'ETH', 'Lido', 'Base ecosystem')" },
        priority: { type: "string", enum: ["low", "normal", "high"], description: "Monitoring priority (default: normal)" },
        alertOn: {
          type: "array",
          items: { type: "string", enum: ["price_spike", "sentiment_shift", "news", "whale_move", "all"] },
          description: "Which signals to watch for (default: price_spike, sentiment_shift, news)",
        },
      },
      required: ["topic"],
    },
  },
];

const StartSwarmSchema = z.object({
  config: z.object({
    enabledAgents: z.array(z.string()).optional(),
    byok: z.boolean().optional(),
  }).optional(),
});
const WriteMemorySchema = z.object({ agentId: z.string().min(1), key: z.string().min(1), value: z.string(), ttlSeconds: z.number().optional() });
const GetMemorySchema = z.object({ key: z.string().min(1) });
const ResearchSchema = z.object({ topic: z.string().min(1), depth: z.enum(["quick", "standard", "deep"]).optional() });
const BriefSchema = z.object({ limit: z.number().optional() });
const TriggerAgentSchema = z.object({
  agentId: z.enum(["market-monitor", "sentiment-tracker", "memory-manager", "risk-verifier", "workflow-executor", "onchain-analyst", "news-aggregator"]),
  params: z.record(z.string(), z.any()).optional(),
});
const BroadcastSchema = z.object({
  message: z.string().min(1).max(500),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  targetAgents: z.array(z.string()).optional(),
});
const PulseSchema = z.object({ token: z.string().optional() });
const ReflectSchema = z.object({ hoursBack: z.number().positive().optional(), focus: z.string().optional() });
const WatchSchema = z.object({
  topic: z.string().min(1),
  priority: z.enum(["low", "normal", "high"]).optional(),
  alertOn: z.array(z.enum(["price_spike", "sentiment_shift", "news", "whale_move", "all"])).optional(),
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

    case "write_swarm_memory": {
      const parsed = WriteMemorySchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${String(parsed.error.issues[0].path[0])} ${parsed.error.issues[0].message}` }], isError: true };
      const { agentId, key, value, ttlSeconds } = parsed.data;
      await callConvex("/swarm/memory/write", "POST", { agentId, key, value, ttlSeconds }, "write_swarm_memory");
      return { content: [{ type: "text", text: `✅ Memory written: [${agentId}] ${key}${ttlSeconds ? ` (expires in ${ttlSeconds}s)` : ""}` }] };
    }

    case "get_swarm_memory": {
      const parsed = GetMemorySchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: key ${parsed.error.issues[0].message}` }], isError: true };
      const data = await callConvex(`/swarm/memory/read?key=${encodeURIComponent(parsed.data.key)}`, "GET", undefined, "get_swarm_memory");
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
      if (data.value === null || data.value === undefined) return { content: [{ type: "text", text: `No value found for key: ${parsed.data.key}` }] };
      return { content: [{ type: "text", text: `**${parsed.data.key}**: ${data.value}` }] };
    }

    case "get_execution_scores": {
      const data = await callConvex("/swarm/scores", "GET", undefined, "get_execution_scores");
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
      const scores: any[] = data.scores ?? [];
      if (!scores.length) return { content: [{ type: "text", text: "No execution scores yet. Run some swarm agents to build a history." }] };
      const sorted = scores.sort((a: any, b: any) => b.lastScore - a.lastScore);
      const lines = [
        `**Execution Scores**`, ``,
        `| Skill | Score | W | L | Avg Duration | Last Adapted |`,
        `|-------|-------|---|---|--------------|--------------|`,
        ...sorted.map((s: any) => `| ${s.skillName} | ${(s.lastScore * 100).toFixed(0)}% | ${s.successCount} | ${s.failCount} | ${Math.round(s.avgDurationMs / 1000)}s | ${new Date(s.lastAdaptedAt).toUTCString()} |`),
      ];
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

    case "swarm_broadcast": {
      const parsed = BroadcastSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { message, priority = "normal", targetAgents } = parsed.data;
      let data: any;
      try {
        data = await callConvex("/swarm/broadcast", "POST", { message, priority, targetAgents }, "swarm_broadcast");
      } catch (err) { return swarmAuthError(err); }
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
      const targets = targetAgents?.join(", ") ?? "all agents";
      return {
        content: [{
          type: "text",
          text: [
            `📡 **Broadcast sent** [${priority}]`,
            `To: ${targets}`,
            `Message: "${message}"`,
            data.deliveredTo ? `Delivered to ${data.deliveredTo} agent(s)` : "",
          ].filter(Boolean).join("\n"),
        }],
      };
    }

    case "swarm_pulse": {
      const parsed = PulseSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { token } = parsed.data;

      await callConvex("/swarm/start", "POST", {}, "start_swarm").catch(() => {});

      let data: any;
      try {
        data = await callConvex("/swarm/pulse", "POST", { token }, "swarm_pulse");
      } catch (err) { return swarmAuthError(err); }
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      const readings: any[] = data.readings ?? [];
      const lines = [
        `💓 **Swarm Pulse**${token ? ` — ${token}` : ""}`,
        `Agents reporting: ${readings.length}`,
        ``,
      ];
      for (const r of readings) {
        lines.push(`**[${r.agentId}]** ${r.summary ?? "No data"}`);
        if (r.data) {
          const preview = JSON.stringify(r.data).slice(0, 120);
          lines.push(`  ${preview}${preview.length === 120 ? "…" : ""}`);
        }
        lines.push("");
      }
      if (!readings.length) lines.push("No agents responding. Use `start_swarm` first.");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "swarm_reflect": {
      const parsed = ReflectSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { hoursBack = 24, focus } = parsed.data;

      const params = new URLSearchParams({ type: "research", limit: "30" });
      let data: any;
      try { data = await callConvex(`/vault/list?${params}`, "GET", undefined, "swarm_reflect"); } catch (err) { return swarmAuthError(err); }
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      const SWARM_AGENTS = new Set(["market-monitor", "sentiment-tracker", "onchain-analyst", "news-aggregator", "risk-verifier", "memory-manager"]);
      const cutoff = Date.now() - hoursBack * 3_600_000;

      const entries: any[] = (data.entries ?? []).filter((e: any) => {
        const isSwarm = SWARM_AGENTS.has(e.agentId);
        const isRecent = e.updatedAt >= cutoff;
        const matchesFocus = !focus || e.title.toLowerCase().includes(focus.toLowerCase());
        return isSwarm && isRecent && matchesFocus;
      });

      if (!entries.length) {
        return {
          content: [{
            type: "text",
            text: [
              `📋 **Swarm Reflection** — Nothing to consolidate`,
              ``,
              `No swarm research found in the last ${hoursBack}h${focus ? ` about "${focus}"` : ""}.`,
              ``,
              `Start one: \`swarm_research topic: "${focus ?? "market overview"}"\``,
            ].join("\n"),
          }],
        };
      }

      // Group by agent
      const byAgent: Record<string, any[]> = {};
      for (const e of entries) {
        const a = e.agentId ?? "unknown";
        (byAgent[a] ??= []).push(e);
      }

      const agentSummaries = Object.entries(byAgent).map(([agent, es]) => {
        const items = es.map((e: any) => `  • ${e.title}`).join("\n");
        return `**[${agent}]** — ${es.length} finding(s)\n${items}`;
      });

      const signals = entries
        .sort((a: any, b: any) => b.updatedAt - a.updatedAt)
        .slice(0, 6)
        .map((e: any) => `• [${e.agentId}] ${e.title}`);

      // Write synthesis to vault for long-term memory
      const now = new Date();
      const reflectionKey = `swarm/reflection-${now.toISOString().slice(0, 10)}-${now.getHours()}h`;
      const reflectionContent = [
        `# Swarm Reflection — ${now.toUTCString()}`,
        `Period: last ${hoursBack}h${focus ? ` · Focus: ${focus}` : ""} · ${entries.length} entries from ${Object.keys(byAgent).length} agent(s)`,
        ``,
        `## Agent Findings`,
        agentSummaries.join("\n\n"),
        ``,
        `## Key Signals`,
        signals.join("\n"),
      ].join("\n");

      const saved = await callConvex("/vault/save", "POST", {
        type: "research",
        title: `Swarm Reflection — ${now.toLocaleDateString("en-US")}${focus ? ` — ${focus}` : ""}`,
        content: reflectionContent,
        key: reflectionKey,
        agentId: "swarm-coordinator",
        tags: ["reflection", "swarm", ...(focus ? [focus] : [])],
        commitMsg: "swarm_reflect auto-consolidation",
      }, "swarm_reflect").catch(() => null);

      // Also sync to semantic memory so it's retrievable by topic
      if (saved) {
        syncToSupermemory(reflectionContent, {
          vaultKey: reflectionKey, title: `Swarm Reflection ${now.toLocaleDateString("en-US")}`,
          type: "research", tags: ["reflection"], source: "swarm_reflect",
        });
      }

      return {
        content: [{
          type: "text",
          text: [
            `📋 **Swarm Reflection** — ${entries.length} findings from ${Object.keys(byAgent).length} agent(s)`,
            `Period: last ${hoursBack}h${focus ? ` · Focus: ${focus}` : ""}`,
            ``,
            agentSummaries.join("\n\n"),
            ``,
            `**Key signals:**`,
            ...signals,
            ``,
            saved ? `✅ Synthesis saved to vault: \`${reflectionKey}\`` : "⚠️ Could not save synthesis",
            ``,
            `Use \`memory_insight topic: "${focus ?? "swarm research"}"\` for the full intelligence picture.`,
          ].filter(Boolean).join("\n"),
        }],
      };
    }

    case "swarm_watch": {
      const parsed = WatchSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { topic, priority = "normal", alertOn = ["price_spike", "sentiment_shift", "news"] } = parsed.data;

      const watchKey = `watch:${topic.toLowerCase().replace(/\s+/g, "-")}`;
      const watchConfig = JSON.stringify({
        topic, priority,
        alertOn: alertOn.includes("all") ? ["price_spike", "sentiment_shift", "news", "whale_move"] : alertOn,
        registeredAt: Date.now(),
      });

      // Write to swarm shared memory (picked up by agents in next cycle)
      await callConvex("/swarm/memory/write", "POST", {
        agentId: "swarm-coordinator",
        key: watchKey,
        value: watchConfig,
      }, "swarm_watch").catch(() => {});

      // Persist to vault so it survives swarm restarts
      await callConvex("/vault/save", "POST", {
        type: "memory",
        title: `Watch: ${topic}`,
        content: watchConfig,
        key: `watch/${topic.toLowerCase().replace(/\s+/g, "-")}`,
        agentId: "swarm-coordinator",
        tags: ["watch", "monitor", topic.toLowerCase()],
        commitMsg: "swarm_watch registered",
      }, "swarm_watch").catch(() => {});

      const alertList = (alertOn.includes("all")
        ? ["price_spike", "sentiment_shift", "news", "whale_move"]
        : alertOn
      ).join(", ");

      return {
        content: [{
          type: "text",
          text: [
            `👁️ **Watch Registered: ${topic}**`,
            `Priority: ${priority} · Alerts: ${alertList}`,
            ``,
            `Swarm agents will now prioritize "${topic}" in every monitoring cycle.`,
            `Watch key: \`${watchKey}\``,
            ``,
            `**What happens next:**`,
            `• market-monitor will track price & volume anomalies`,
            `• sentiment-tracker will watch social signal shifts`,
            `• news-aggregator will flag relevant news & narratives`,
            alertOn.includes("whale_move") || alertOn.includes("all") ? `• onchain-analyst will detect large wallet movements` : "",
            ``,
            `**Check findings:**`,
            `• \`swarm_brief\` — latest research entries`,
            `• \`memory_insight topic: "${topic}"\` — full intelligence report`,
            `• \`swarm_reflect focus: "${topic}"\` — consolidated summary`,
          ].filter(Boolean).join("\n"),
        }],
      };
    }

    default:
      return null;
  }
}
