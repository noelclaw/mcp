import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";
import { fetchMarketSnapshot } from "./market.js";
import { searchSupermemory } from "./memory.js";

function formatDate(ts: number): string {
  return new Date(ts).toUTCString();
}

async function fetchFearGreed(): Promise<string> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return "";
    const data = await res.json() as any;
    const val  = data?.data?.[0];
    if (!val) return "";
    const score = parseInt(val.value ?? "0");
    const emoji = score >= 75 ? "😈" : score >= 55 ? "😏" : score >= 45 ? "😐" : score >= 25 ? "😰" : "🫨";
    return `${emoji} Fear & Greed: ${score}/100 (${val.value_classification})`;
  } catch { return ""; }
}

export const SWARM_TOOLS: Tool[] = [
  {
    name: "stop_swarm",
    description: "Stop the active swarm session.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_swarm_status",
    description:
      "Live swarm dashboard — shows active agents, shared memory snapshot, execution scores (win/loss/avg speed), " +
      "and recent research entries in vault. Use to see what the swarm is tracking right now.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "swarm_research",
    description:
      "Launch a coordinated multi-agent research swarm on any topic — automatically starts the swarm, " +
      "fires relevant agents in parallel, and saves all findings to vault. " +
      "Returns a synthesized intelligence report immediately (current knowledge + what new agents are finding). " +
      "Best for: deep research on any topic — token analysis, industry trends, competitor analysis, protocol deep-dives, macro narratives, news coverage.",
    inputSchema: {
      type: "object",
      properties: {
        topic:     { type: "string", description: "Token, protocol, narrative, or market question to research" },
        depth:     { type: "string", enum: ["quick", "standard", "deep"], description: "quick=2 agents, standard=4 agents, deep=all 7 agents (default: standard)" },
        synthesize: { type: "boolean", description: "Return synthesized report immediately (default: true)" },
      },
      required: ["topic"],
    },
  },
  {
    name: "trigger_agent",
    description:
      "Run a single specialist agent immediately for a focused task. Auto-starts swarm if needed. " +
      "Use for targeted analysis: market-monitor (live prices, volume, resistance breaks for a token), " +
      "sentiment-tracker (social signals, community mood, narrative momentum), " +
      "onchain-analyst (wallet flows, smart money, TVL, protocol stats), " +
      "news-aggregator (latest news, macro developments, narrative tracking), " +
      "risk-verifier (position risk, protocol risk, market exposure assessment), " +
      "memory-manager (consolidate and compress swarm memory), " +
      "workflow-executor (fire scheduled automations or DCA strategies).",
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
          description: "Agent params. market-monitor: { token }. sentiment-tracker: { token } or { topic }. onchain-analyst: { address } or { protocol }. news-aggregator: { topic }. risk-verifier: { token } or { position }.",
        },
      },
      required: ["agentId"],
    },
  },
  {
    name: "swarm_synthesize",
    description:
      "Synthesize all swarm research findings into one coherent intelligence report. " +
      "Fetches all vault entries from swarm agents, consolidates overlapping facts, " +
      "identifies key signals and gaps, and produces a structured report with actionable next steps. " +
      "Call this after swarm_research to turn raw agent findings into a decision-ready summary.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to synthesize research on. Uses all swarm findings if omitted." },
        depth: { type: "string", enum: ["summary", "full"], description: "summary=key bullets, full=detailed report (default: full)" },
      },
      required: [],
    },
  },
];

// ── Schemas ───────────────────────────────────────────────────────────────────

const StartSwarmSchema = z.object({
  config: z.object({
    enabledAgents: z.array(z.string()).optional(),
    byok: z.boolean().optional(),
  }).optional(),
});
const ResearchSchema    = z.object({ topic: z.string().min(1), depth: z.enum(["quick", "standard", "deep"]).optional(), synthesize: z.boolean().optional() });
const BriefSchema       = z.object({ limit: z.number().optional() });
const SynthesizeSchema   = z.object({ topic: z.string().optional(), depth: z.enum(["summary", "full"]).optional() });
const TriggerAgentSchema = z.object({
  agentId: z.enum(["market-monitor", "sentiment-tracker", "memory-manager", "risk-verifier", "workflow-executor", "onchain-analyst", "news-aggregator"]),
  params: z.record(z.string(), z.any()).optional(),
});

const NO_KEY_MSG =
  `⚠️ Swarm auth failed.\n\n` +
  `Your local wallet auto-generates on first use at ~/.noelclaw/wallet.json — no API key needed.\n\n` +
  `Try restarting your MCP client. If the error persists, run \`get_wallet_address\` to confirm the wallet is initialised.`;

function swarmAuthError(err: unknown): ToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  const isAuth = msg.includes("🔑") || msg.includes("Authentication") || msg.includes("401");
  return {
    content: [{ type: "text", text: isAuth ? NO_KEY_MSG : `Swarm error: ${msg}` }],
    isError: true,
  };
}

const SWARM_AGENTS = new Set([
  "market-monitor", "sentiment-tracker", "onchain-analyst",
  "news-aggregator", "risk-verifier", "memory-manager", "workflow-executor",
]);

const AGENT_EMOJI: Record<string, string> = {
  "market-monitor":    "📊",
  "sentiment-tracker": "💬",
  "onchain-analyst":   "🔗",
  "news-aggregator":   "📰",
  "risk-verifier":     "🛡️",
  "memory-manager":    "🧠",
  "workflow-executor": "⚙️",
};

// ── Shared synthesis helper ────────────────────────────────────────────────────

async function runSynthesis(topic: string | undefined, depth: "summary" | "full" = "full"): Promise<string | null> {
  const [briefRes, memRes] = await Promise.allSettled([
    callConvex(`/vault/list?type=research&limit=15`, "GET", undefined, "swarm_synthesize"),
    topic ? searchSupermemory(topic, 8) : searchSupermemory("swarm research findings", 8),
  ]);

  const vaultData = briefRes.status === "fulfilled" ? briefRes.value : null;
  const memories  = memRes.status   === "fulfilled" ? memRes.value   : [];

  const allEntries: any[] = ((vaultData?.entries ?? []) as any[]).filter((e: any) => e.agentId && SWARM_AGENTS.has(e.agentId));
  const relevant = topic
    ? allEntries.filter((e: any) =>
        e.title?.toLowerCase().includes(topic.toLowerCase()) ||
        e.tags?.some((t: string) => t.toLowerCase().includes(topic.toLowerCase())) ||
        e.preview?.toLowerCase().includes(topic.toLowerCase())
      )
    : allEntries;
  const entries = relevant.length > 0 ? relevant : allEntries;

  if (!entries.length && (memories as any[]).length === 0) return null;

  let synthesized: string | null = null;
  try {
    const consolidateData = await callConvex("/memory/consolidate", "POST", {
      topic: topic ?? (entries[0]?.title ?? "swarm findings"),
      limit: 12,
    }, "swarm_synthesize");
    synthesized = consolidateData?.summary ?? consolidateData?.result ?? null;
  } catch { /* proceed without AI synthesis */ }

  const lines: string[] = [];

  if (synthesized) {
    lines.push(`## Synthesized Analysis`);
    lines.push(synthesized.slice(0, depth === "summary" ? 600 : 2000));
    lines.push(``);
  }

  if (depth === "full" && entries.length > 0) {
    const byAgent: Record<string, any[]> = {};
    for (const e of entries) {
      if (!byAgent[e.agentId]) byAgent[e.agentId] = [];
      byAgent[e.agentId].push(e);
    }
    lines.push(`## Agent Coverage (${entries.length} entries)`);
    for (const [agentId, agentEntries] of Object.entries(byAgent)) {
      lines.push(`${AGENT_EMOJI[agentId] ?? "•"} **${agentId}**: ${(agentEntries as any[]).map((e: any) => e.title).join(" · ")}`);
    }
    lines.push(``);
  }

  const mems = memories as any[];
  if (mems.length > 0) {
    lines.push(`## Related Context (${mems.length} memories)`);
    for (const m of mems.slice(0, 5)) {
      lines.push(`• ${m.content.slice(0, 100).replace(/\n/g, " ")}`);
    }
    lines.push(``);
  }

  const missingAgents = [...SWARM_AGENTS].filter(a => !entries.some((e: any) => e.agentId === a));
  if (missingAgents.length > 0 && depth === "full") {
    lines.push(`## Coverage Gaps`);
    lines.push(`No data yet from: ${missingAgents.map(a => `${AGENT_EMOJI[a]} ${a}`).join(", ")}`);
    lines.push(``);
  }

  return lines.join("\n");
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handleSwarmTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {

    case "start_swarm": {
      const parsed = StartSwarmSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      let data: any;
      try {
        data = await callConvex("/swarm/start", "POST", { config: parsed.data.config }, "start_swarm");
      } catch (err) { return swarmAuthError(err); }
      if (!data.success) return { content: [{ type: "text", text: `Failed: ${data.error}` }], isError: true };

      // Seed market prices + fear & greed into shared memory
      const [snapshotRes, fgRes] = await Promise.allSettled([fetchMarketSnapshot(), fetchFearGreed()]);
      const snapshot = snapshotRes.status === "fulfilled" ? snapshotRes.value : null;
      const fearGreed = fgRes.status === "fulfilled" ? fgRes.value : "";

      if (snapshot) {
        const ts  = new Date().toUTCString();
        const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${ts})`;
        const p   = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const writes = [
          callConvex("/swarm/memory/write", "POST", { agentId: "market-monitor", key: "BTC/USD",   value: fmt(snapshot.btc) }, "write_swarm_memory"),
          callConvex("/swarm/memory/write", "POST", { agentId: "market-monitor", key: "ETH/USD",   value: fmt(snapshot.eth) }, "write_swarm_memory"),
          callConvex("/swarm/memory/write", "POST", { agentId: "market-monitor", key: "SOL/USD",   value: fmt(snapshot.sol) }, "write_swarm_memory"),
          callConvex("/swarm/memory/write", "POST", { agentId: "market-monitor", key: "btc_price", value: p(snapshot.btc) }, "write_swarm_memory"),
          callConvex("/swarm/memory/write", "POST", { agentId: "market-monitor", key: "eth_price", value: p(snapshot.eth) }, "write_swarm_memory"),
          callConvex("/swarm/memory/write", "POST", { agentId: "market-monitor", key: "sol_price", value: p(snapshot.sol) }, "write_swarm_memory"),
        ];
        if (fearGreed) {
          writes.push(
            callConvex("/swarm/memory/write", "POST", { agentId: "sentiment-tracker", key: "fear_greed", value: fearGreed }, "write_swarm_memory"),
          );
        }
        await Promise.allSettled(writes);
      }

      const pFmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const lines = [
        `🤖 **Swarm Started**`,
        `Session: ${data.sessionId} · ${new Date().toUTCString()}`,
        ``,
      ];
      if (snapshot) {
        lines.push(`**Prices seeded into agent memory:**`);
        lines.push(`  BTC ${pFmt(snapshot.btc)}  ·  ETH ${pFmt(snapshot.eth)}  ·  SOL ${pFmt(snapshot.sol)}`);
        if (fearGreed) lines.push(`  ${fearGreed}`);
        lines.push(``);
      }
      lines.push(`**Agents ready:** ${[...SWARM_AGENTS].map(a => `${AGENT_EMOJI[a]} ${a}`).join("  ")}`);
      lines.push(``);
      lines.push(`**Next:** \`swarm_research topic: "ETH"\` to launch a research session`);
      lines.push(`Or: \`get_swarm_status\` to monitor live agent activity`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "stop_swarm": {
      let data: any;
      try { data = await callConvex("/swarm/stop", "POST", {}, "stop_swarm"); } catch (err) { return swarmAuthError(err); }
      if (!data.success) return { content: [{ type: "text", text: `Failed: ${data.error}` }], isError: true };
      return { content: [{ type: "text", text: `⏹️ Swarm stopped. Use \`swarm_synthesize\` to get a full intelligence report from all findings.` }] };
    }

    case "get_swarm_status": {
      let data: any;
      try { data = await callConvex("/swarm/status", "GET", undefined, "get_swarm_status"); } catch (err) { return swarmAuthError(err); }
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      const session  = data.session;
      const memory: any[] = data.memory ?? [];
      const scores:  any[] = data.scores ?? [];

      const lines: string[] = [
        `🤖 **Swarm Status**`,
        data.active && session
          ? `✅ Active · Session: ${session.id?.slice(0, 16)}... · Since: ${formatDate(session.startedAt ?? Date.now())}`
          : `⏹️ No active swarm. Run \`start_swarm\` or \`noel_boot\`.`,
        ``,
      ];

      if (memory.length > 0) {
        // Group memory by agent for readability
        const byAgent: Record<string, any[]> = {};
        for (const m of memory) {
          if (!byAgent[m.agentId]) byAgent[m.agentId] = [];
          byAgent[m.agentId].push(m);
        }
        lines.push(`**Shared Memory** (${memory.length} entries):`);
        for (const [agentId, entries] of Object.entries(byAgent)) {
          const emoji = AGENT_EMOJI[agentId] ?? "•";
          lines.push(`  ${emoji} ${agentId}:`);
          for (const m of entries.slice(0, 3)) {
            lines.push(`    ${m.key}: ${String(m.value).slice(0, 70)}`);
          }
        }
        lines.push(``);
      }

      if (scores.length > 0) {
        lines.push(`**Agent Performance:**`);
        const sorted = scores.sort((a: any, b: any) => b.lastScore - a.lastScore).slice(0, 6);
        for (const s of sorted) {
          const bar = "█".repeat(Math.round(s.lastScore * 8)) + "░".repeat(8 - Math.round(s.lastScore * 8));
          lines.push(`  ${bar} ${s.skillName}: ${(s.lastScore * 100).toFixed(0)}% · ${s.successCount}W/${s.failCount}L · avg ${Math.round(s.avgDurationMs / 1000)}s`);
        }
        lines.push(``);
      }

      lines.push(`💡 \`swarm_research topic: "..."\` to launch research · \`swarm_synthesize\` to get the full report`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "swarm_research": {
      const parsed = ResearchSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { topic, depth = "standard", synthesize = true } = parsed.data;

      const agentMap: Record<string, string[]> = {
        quick:    ["market-monitor", "sentiment-tracker"],
        standard: ["market-monitor", "sentiment-tracker", "onchain-analyst", "news-aggregator"],
        deep:     ["market-monitor", "sentiment-tracker", "onchain-analyst", "news-aggregator", "risk-verifier", "memory-manager", "workflow-executor"],
      };
      const agents = agentMap[depth];

      // Launch research + load prior context in parallel
      const [priorResults, launchData] = await Promise.all([
        searchSupermemory(topic, 5).catch(() => [] as any[]),
        callConvex("/swarm/start", "POST", {}, "start_swarm").catch(() => null)
          .then(() => callConvex("/swarm/research", "POST", { topic, depth }, "swarm_research").catch((err: unknown) => ({ error: String(err) }))),
      ]);

      if ((launchData as any)?.error && !(launchData as any)?.message) {
        return swarmAuthError((launchData as any).error);
      }

      const lines = [
        `🔬 **Swarm Research — ${topic}**`,
        `Depth: ${depth} · ${agents.length} agents running`,
        ``,
        agents.map(a => `${AGENT_EMOJI[a] ?? "•"} ${a}`).join("  ·  "),
        ``,
      ];

      if ((priorResults as any[]).length > 0) {
        lines.push(`🧠 ${(priorResults as any[]).length} prior memories injected → agents build on existing knowledge`);
        lines.push(``);
      }

      lines.push(`_Agents are working — new findings saved to vault automatically._`);
      lines.push(``);
      lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      lines.push(``);

      // Auto-synthesize existing knowledge immediately
      if (synthesize) {
        const synthesis = await runSynthesis(topic, "full");
        if (synthesis) {
          lines.push(`🧠 **Intelligence Report — ${topic}**`);
          lines.push(`_(Based on current vault knowledge — new agent findings will enrich this. Call \`swarm_synthesize\` in 30–60s for the updated report.)_`);
          lines.push(``);
          lines.push(synthesis);
        } else {
          lines.push(`No prior research on "${topic}" in vault yet.`);
          lines.push(`New agent findings will be saved automatically — call \`swarm_synthesize topic: "${topic}"\` in ~60s for the full report.`);
        }
      } else {
        lines.push(`**When ready:** \`swarm_synthesize topic: "${topic}"\` — consolidated intelligence report`);
        lines.push(`Or: \`swarm_synthesize\` — synthesize all findings into an intelligence report`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "trigger_agent": {
      const parsed = TriggerAgentSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { agentId, params = {} } = parsed.data;

      await callConvex("/swarm/start", "POST", {}, "start_swarm").catch(() => {});

      // Inject prior context so agent doesn't re-discover known facts
      const contextQuery = [agentId, (params as any)?.token, (params as any)?.topic, (params as any)?.protocol, (params as any)?.address].filter(Boolean).join(" ");
      const priorContext = await searchSupermemory(contextQuery, 3).catch(() => [] as any[]);
      const priorSummary = priorContext.length > 0
        ? priorContext.map((r: any) => r.content.slice(0, 150)).join(" | ")
        : null;
      const enrichedParams = priorSummary ? { ...params, priorContext: priorSummary } : params;

      let data: any;
      try {
        data = await callConvex("/swarm/trigger", "POST", { agentId, params: enrichedParams }, "trigger_agent");
      } catch (err) { return swarmAuthError(err); }
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      // Format result as readable text, not raw JSON
      let resultSection = "";
      if (data.result) {
        const raw = typeof data.result === "string" ? data.result : JSON.stringify(data.result, null, 2);
        resultSection = `\n**Findings:**\n${raw.slice(0, 1200)}${raw.length > 1200 ? "\n… (full result saved to vault)" : ""}`;
      }

      const vaultKey = data.vaultKey ?? data.savedTo ?? null;
      const contextNote = priorContext.length > 0 ? `🧠 ${priorContext.length} prior memories injected into context.` : "";
      const focusTerm = (params as any)?.token ?? (params as any)?.topic ?? (params as any)?.protocol ?? agentId;

      return {
        content: [{
          type: "text",
          text: [
            `${AGENT_EMOJI[agentId] ?? "⚡"} **${agentId} — Done**`,
            contextNote,
            resultSection,
            vaultKey ? `\n💾 Full result saved → \`${vaultKey}\`` : "",
            ``,
            `**Next:** \`swarm_synthesize topic: "${focusTerm}"\` · or \`trigger_agent\` another agent for more depth`,
          ].filter(Boolean).join("\n"),
        }],
      };
    }

    case "swarm_synthesize": {
      const parsed = SynthesizeSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { topic, depth = "full" } = parsed.data;

      const synthesis = await runSynthesis(topic, depth);

      if (!synthesis) {
        return {
          content: [{ type: "text", text: `No swarm research to synthesize${topic ? ` on "${topic}"` : ""}.\n\nRun \`swarm_research topic: "${topic ?? "..."}"\` first to build your knowledge base.` }],
        };
      }

      const header = [
        `🧠 **Swarm Intelligence Report**${topic ? ` — ${topic}` : ""}`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `${new Date().toUTCString()}`,
        ``,
      ].join("\n");

      const footer = [
        ``,
        `**Actions:**`,
        topic
          ? `  • \`memory_insight topic: "${topic}"\` — full intelligence report with gap analysis\n  • \`swarm_research topic: "${topic}" depth: "deep"\` — expand coverage`
          : `  • \`swarm_research topic: "..."\` — deep-dive on a specific topic\n  • \`memory_insight topic: "..."\` — full intelligence report`,
      ].join("\n");

      return { content: [{ type: "text", text: header + synthesis + footer }] };
    }

    default:
      return null;
  }
}
