import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import type { ToolResult } from "../types.js";

const CHRONICLE_TYPES = ["vault", "memory", "agent", "tool", "automation", "monitor", "system", "custom"] as const;

export const CHRONICLE_TOOLS: Tool[] = [
  {
    name: "chronicle_add",
    description:
      "Log an event to Noel Chronicle - the system-wide audit log for your AI runtime. " +
      "Records anything meaningful: vault saves, agent updates, automation triggers, " +
      "custom milestones, research completions. Chronicle is your permanent timeline of what happened. " +
      "Types: vault | memory | agent | tool | automation | monitor | system | custom.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: [...CHRONICLE_TYPES],
          description: "Event category",
        },
        title: {
          type: "string",
          description: "Short event title, e.g. 'Saved ETH research to vault'",
        },
        detail: {
          type: "string",
          description: "Optional longer description or result summary",
        },
        metadata: {
          type: "object",
          description: "Optional extra data (key, agentId, topic, etc.)",
        },
      },
      required: ["type", "title"],
    },
  },
  {
    name: "chronicle_list",
    description:
      "Read the Noel Chronicle event log - your AI runtime timeline. Returns recent events in reverse chronological order. " +
      "Filter by type to see only vault saves, agent activity, automations, etc.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max events to return (default 20, max 100)",
        },
        type: {
          type: "string",
          enum: [...CHRONICLE_TYPES],
          description: "Filter by event type (optional)",
        },
      },
    },
  },
];

// Keep "swarm" emoji for backward compatibility - legacy chronicle entries
// may still have this type even though it's no longer accepted on new writes.
const TYPE_EMOJI: Record<string, string> = {
  vault:       "🗄️",
  memory:      "🧠",
  agent:       "🤖",
  tool:        "🔧",
  automation:  "⚡",
  monitor:     "👁️",
  system:      "⚙️",
  custom:      "📌",
  swarm:       "🐝",
};

export async function handleChronicle(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {

  if (name === "chronicle_add") {
    const { type = "custom", title, detail, metadata } = args as {
      type?: string; title: string; detail?: string; metadata?: unknown;
    };

    await callConvex("/chronicle/add", "POST", {
      type,
      title,
      detail,
      metadata,
      source: "mcp",
    }, "chronicle_add");

    const emoji = TYPE_EMOJI[type] ?? "📌";
    return {
      content: [{
        type: "text",
        text: [
          `${emoji} **Logged to Chronicle**`,
          ``,
          `**${title}**${detail ? `\n${detail}` : ""}`,
          ``,
          `Type: \`${type}\` · Use \`chronicle_list\` to view your timeline.`,
        ].join("\n"),
      }],
    };
  }

  if (name === "chronicle_list") {
    const limit = Math.min(Number(args.limit ?? 20), 100);
    const type = args.type as string | undefined;

    const data = await callConvex(
      `/chronicle/list?limit=${limit}${type ? `&type=${type}` : ""}`,
      "GET",
      undefined,
      "chronicle_list",
    );

    const entries: any[] = data.entries ?? [];

    if (entries.length === 0) {
      return {
        content: [{
          type: "text",
          text: "No chronicle entries yet. Use `chronicle_add` to start logging events.",
        }],
      };
    }

    const lines: string[] = [
      `## 📜 Noel Chronicle${type ? ` · ${type}` : ""}`,
      `*${entries.length} event${entries.length !== 1 ? "s" : ""}*`,
      "",
    ];

    for (const e of entries) {
      const emoji = TYPE_EMOJI[e.type] ?? "📌";
      const date = new Date(e.ts).toLocaleString("en-US", {
        month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
      lines.push(`${emoji} **${e.title}** · \`${e.type}\` · ${date}`);
      if (e.detail) lines.push(`   ${e.detail}`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  return { content: [{ type: "text", text: `Unknown chronicle tool: ${name}` }], isError: true };
}
