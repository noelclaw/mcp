import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";
import { fetchMarketSnapshot } from "./market.js";

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
];

const StartSwarmSchema = z.object({
  config: z.object({
    enabledAgents: z.array(z.string()).optional(),
    byok: z.boolean().optional(),
  }).optional(),
});
const WriteMemorySchema = z.object({ agentId: z.string().min(1), key: z.string().min(1), value: z.string(), ttlSeconds: z.number().optional() });
const GetMemorySchema = z.object({ key: z.string().min(1) });

export async function handleSwarmTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "start_swarm": {
      const parsed = StartSwarmSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: config ${parsed.error.issues[0].message}` }], isError: true };
      const data = await callConvex("/swarm/start", "POST", { config: parsed.data.config }, "start_swarm");
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
      const data = await callConvex("/swarm/stop", "POST", {}, "stop_swarm");
      if (!data.success) return { content: [{ type: "text", text: `Failed: ${data.error}` }], isError: true };
      return { content: [{ type: "text", text: `⏹️ Swarm stopped.` }] };
    }

    case "get_swarm_status": {
      const data = await callConvex("/swarm/status", "GET", undefined, "get_swarm_status");
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

    default:
      return null;
  }
}
