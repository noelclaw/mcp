import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";

// ─── Helpers (proxied through Convex — server-side Supermemory key) ──────────

export async function syncToSupermemory(
  content: string,
  metadata: Record<string, unknown>,
  sourceUrl?: string,
): Promise<void> {
  await callConvex("/memory/add", "POST", {
    content,
    metadata,
    ...(sourceUrl ? { sourceUrl } : {}),
  }).catch(() => {});
}

export async function searchSupermemory(
  query: string,
  limit = 10,
): Promise<Array<{ id: string; content: string; metadata: any; score?: number }>> {
  try {
    const data = await callConvex("/memory/search", "POST", { q: query, n: limit });
    return data?.results ?? [];
  } catch {
    return [];
  }
}

// ─── Tool definitions ────────────────────────────────────────────────────────

export const MEMORY_TOOLS: Tool[] = [
  {
    name: "memory_add",
    description:
      "Add content to your Noelclaw semantic memory — no setup needed, no extra API keys. " +
      "Unlike vault_save, memory_add is instant: no versioning, no type required. " +
      "Use for notes, decisions, preferences, or anything you want to find later with natural language. " +
      "Pass sourceUrl to fetch and index any web page, GitHub repo, or Notion page automatically — " +
      "searchable in ~30s. Memory is indexed semantically — 'what did I say about ETH yield?' " +
      "will find it even without exact keywords.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Content to remember — text, markdown, or a note. Use a short title if providing sourceUrl." },
        title: { type: "string", description: "Optional title for this memory" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for grouping" },
        sourceUrl: { type: "string", description: "URL to fetch and index automatically (GitHub, Notion, web page, etc.). Content becomes searchable in ~30s." },
      },
      required: ["content"],
    },
  },
  {
    name: "memory_search",
    description:
      "Semantic search across all your Noelclaw memories. Understands meaning, not just keywords — " +
      "'low risk crypto yield' matches 'conservative DeFi strategies'. " +
      "Also searches memories auto-synced from vault_save.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language query" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_context",
    description:
      "Retrieve the most semantically relevant memories for a topic, formatted as AI-ready context. " +
      "Use at the start of research tasks to prime with everything stored about a topic. " +
      "Uses vector search — finds semantically related content, not just exact keyword matches.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to load context for, e.g. 'ETH liquid staking' or 'user DeFi preferences'" },
        limit: { type: "number", description: "Max entries to include (default 8)" },
      },
      required: ["topic"],
    },
  },
  {
    name: "memory_profile",
    description:
      "Show your semantic memory stats — total memories stored, your memory space, and connected sources. " +
      "Useful for auditing what Noelclaw knows about you.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "memory_list",
    description:
      "List your most recent Noelclaw memories without a search query. " +
      "Useful to browse what's stored or audit before clearing. " +
      "Sorted by most recently added.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max memories to return (default 20)" },
        tag: { type: "string", description: "Optional: filter by tag" },
      },
      required: [],
    },
  },
  {
    name: "memory_delete",
    description:
      "Delete a specific memory by its ID. Get IDs from memory_search or memory_list results. " +
      "This permanently removes the memory from your semantic store.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory ID to delete (from memory_search or memory_list results)" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_insight",
    description:
      "Get a full intelligence report on any topic — combines semantic memory AND vault entries, " +
      "then identifies knowledge gaps and suggests next actions. " +
      "Use this before starting any research or trade decision to see everything Noelclaw already knows. " +
      "Returns: confidence level, what you know, coverage timeline, gaps, and recommended next steps.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to analyze — token, protocol, strategy, or any concept" },
        depth: { type: "string", enum: ["quick", "standard", "deep"], description: "How many sources to pull (default: standard)" },
      },
      required: ["topic"],
    },
  },
  {
    name: "memory_extract",
    description:
      "Auto-extract discrete facts, preferences, and decisions from any text and save them individually to semantic memory. " +
      "Instead of storing a wall of text, Noelclaw breaks it into 3-10 searchable atomic facts using AI. " +
      "Best for processing chat logs, research notes, meeting summaries, or any unstructured content. " +
      "Each extracted fact becomes independently searchable — 'what do I prefer about staking?' will find it.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to extract facts from — notes, research, chat logs, any unstructured content" },
        source: { type: "string", description: "Optional label for where this came from (e.g. 'telegram', 'research', 'meeting')" },
      },
      required: ["text"],
    },
  },
  {
    name: "memory_consolidate",
    description:
      "Fetch all memories on a topic and consolidate them into a single comprehensive summary using AI. " +
      "Removes redundancy, merges overlapping facts, and saves the result as a new 'consolidated' memory. " +
      "Use this to clean up fragmented knowledge after heavy research sessions. " +
      "Returns the summary and saves it automatically — the original memories remain intact.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to consolidate memories for (e.g. 'ETH liquid staking', 'Base DeFi')" },
        limit: { type: "number", description: "Max source memories to consolidate (default 12)" },
      },
      required: ["topic"],
    },
  },
];

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const AddSchema = z.object({
  content: z.string().min(1),
  title: z.string().optional(),
  tags: z.array(z.string()).optional(),
  sourceUrl: z.string().url().optional(),
});

const SearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().optional(),
});

const ContextSchema = z.object({
  topic: z.string().min(1),
  limit: z.number().optional(),
});

const ListSchema = z.object({
  limit: z.number().optional(),
  tag: z.string().optional(),
});

const DeleteMemSchema = z.object({ id: z.string().min(1) });
const InsightSchema = z.object({
  topic: z.string().min(1),
  depth: z.enum(["quick", "standard", "deep"]).optional(),
});
const ExtractSchema = z.object({
  text: z.string().min(1),
  source: z.string().optional(),
});
const ConsolidateSchema = z.object({
  topic: z.string().min(1),
  limit: z.number().optional(),
});

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleMemoryTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "memory_add": {
      const parsed = AddSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

      const { content, title, tags, sourceUrl } = parsed.data;
      const data = await callConvex("/memory/add", "POST", {
        content,
        metadata: { title, tags, source: "memory_add", addedAt: Date.now() },
        ...(sourceUrl ? { sourceUrl } : {}),
      }).catch((err: any) => ({ error: err.message }));

      if (data?.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      return {
        content: [{
          type: "text",
          text: [
            `🧠 **Memory added** — ID: \`${data?.id ?? "saved"}\``,
            title ? `Title: ${title}` : "",
            sourceUrl ? `Source: ${sourceUrl} (indexing in background…)` : "",
            tags?.length ? `Tags: ${tags.join(", ")}` : "",
            ``,
            `Find it with: \`memory_search query: "${(title ?? content).slice(0, 40)}"\``,
          ].filter(Boolean).join("\n"),
        }],
      };
    }

    case "memory_search": {
      const parsed = SearchSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

      const { query, limit = 10 } = parsed.data;
      const results = await searchSupermemory(query, limit);

      if (!results.length) return { content: [{ type: "text", text: `No memories found for: "${query}"\nTry adding content with \`memory_add\` or \`vault_save\`.` }] };

      const header = `🔍 **Semantic Memory Search**: "${query}" — ${results.length} result(s)`;
      const rows = results.map((r, i) => {
        const score = r.score != null ? ` [${(r.score * 100).toFixed(0)}%]` : "";
        const title = r.metadata?.title ?? "";
        const preview = r.content.slice(0, 200).replace(/\n/g, " ");
        return [
          `${i + 1}.${score}${title ? ` **${title}**` : ""} \`${r.id}\``,
          `   ${preview}${r.content.length > 200 ? "…" : ""}`,
        ].join("\n");
      });
      return { content: [{ type: "text", text: [header, "", ...rows].join("\n") }] };
    }

    case "memory_context": {
      const parsed = ContextSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

      const { topic, limit = 8 } = parsed.data;
      const results = await searchSupermemory(topic, limit);

      if (!results.length) return { content: [{ type: "text", text: `No semantic context found for: "${topic}"\nBuild your memory base with vault_save or memory_add.` }] };

      const contextParts = results.map((r, i) => {
        const title = r.metadata?.title ? `### ${r.metadata.title}` : `### Memory ${i + 1}`;
        return `${title}\n${r.content}`;
      });
      const summary = results.map(r => r.metadata?.title ?? r.content.slice(0, 50)).join(", ");

      return {
        content: [{
          type: "text",
          text: [
            `🧠 **Semantic Context** for: "${topic}"`,
            `Loaded ${results.length} relevant memories: ${summary}`,
            ``,
            `---`,
            ``,
            contextParts.join("\n\n---\n\n"),
          ].join("\n"),
        }],
      };
    }

    case "memory_profile": {
      const data = await callConvex("/memory/profile", "GET").catch(() => null);
      const total = data?.total ?? 0;
      const status = data?.status ?? "unknown";
      const space = data?.space ?? "—";

      return {
        content: [{
          type: "text",
          text: [
            `🧠 **Noelclaw Semantic Memory**`,
            ``,
            `Space: \`${space}\``,
            `Total memories: **${total}**`,
            `Status: ${status === "ok" ? "✅ Active" : status === "not_configured" ? "⏳ Setting up" : "⚠️ " + status}`,
            ``,
            `**Auto-synced sources:**`,
            `• vault_save — ✅`,
            `• memory_add (URL indexing) — ✅`,
            `• Google Drive / Gmail / Notion — connect at noelclaw.com`,
            ``,
            `**Capabilities:** Semantic search · Vector context · 81.6% LongMemEval`,
          ].join("\n"),
        }],
      };
    }

    case "memory_list": {
      const parsed = ListSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { limit = 20, tag } = parsed.data;
      const data = await callConvex("/memory/list", "POST", { n: limit, tag }).catch((err: any) => ({ error: err.message }));
      if (data?.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
      const results: any[] = data?.results ?? [];
      if (!results.length) return { content: [{ type: "text", text: `No memories stored yet. Use \`memory_add\` to start building your knowledge base.` }] };
      const header = `🧠 **Memories** (${results.length} shown${tag ? `, tag: ${tag}` : ""})`;
      const rows = results.map((r: any, i: number) => {
        const title = r.metadata?.title ?? "";
        const preview = r.content.slice(0, 100).replace(/\n/g, " ");
        return `${i + 1}. \`${r.id}\`${title ? ` **${title}**` : ""}\n   ${preview}${r.content.length > 100 ? "…" : ""}`;
      });
      return { content: [{ type: "text", text: [header, "", ...rows].join("\n") }] };
    }

    case "memory_delete": {
      const parsed = DeleteMemSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const data = await callConvex("/memory/delete", "POST", { id: parsed.data.id }).catch((err: any) => ({ error: err.message }));
      if (data?.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
      return { content: [{ type: "text", text: `🗑️ Memory deleted: \`${parsed.data.id}\`` }] };
    }

    case "memory_insight": {
      const parsed = InsightSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

      const { topic, depth = "standard" } = parsed.data;
      const memLimit = depth === "deep" ? 15 : depth === "quick" ? 5 : 8;

      // Pull from semantic memory and vault in parallel
      const [memResults, vaultData] = await Promise.all([
        searchSupermemory(topic, memLimit),
        callConvex(`/vault/search?q=${encodeURIComponent(topic)}&limit=6`, "GET", undefined, "memory_insight").catch(() => ({ results: [] })),
      ]);

      const vaultResults: any[] = vaultData.results ?? [];
      const total = memResults.length + vaultResults.length;

      if (!total) {
        return {
          content: [{
            type: "text",
            text: [
              `🔮 **Intelligence Report: "${topic}"**`,
              ``,
              `No knowledge found yet.`,
              ``,
              `**Start building:**`,
              `• \`swarm_research topic: "${topic}"\` — run deep research now`,
              `• \`memory_add content: "..." \` — add a manual note`,
              `• \`swarm_watch topic: "${topic}"\` — start monitoring`,
            ].join("\n"),
          }],
        };
      }

      // Confidence tier
      const confidence = total >= 10 ? "🟢 High" : total >= 4 ? "🟡 Medium" : "🔴 Low";

      // Timeline from metadata timestamps
      const timestamps = memResults.map(r => r.metadata?.addedAt as number).filter(Boolean);
      const oldest = timestamps.length ? Math.min(...timestamps) : null;
      const newest = timestamps.length ? Math.max(...timestamps) : null;
      const daysSinceUpdate = newest ? Math.round((Date.now() - newest) / 86_400_000) : null;

      // Knowledge summary lines
      const memLines = memResults.slice(0, 6).map(r => {
        const title = r.metadata?.title ?? r.content.slice(0, 70).replace(/\n/g, " ");
        const score = r.score != null ? ` [${(r.score * 100).toFixed(0)}%]` : "";
        return `  •${score} ${title}`;
      });
      const vaultLines = vaultResults.slice(0, 4).map((r: any) =>
        `  • [vault/${r.type}] ${r.title} — v${r.version}`
      );

      // Gap analysis
      const gaps: string[] = [];
      if (daysSinceUpdate !== null && daysSinceUpdate > 7) {
        gaps.push(`Stale data — last update ${daysSinceUpdate} day${daysSinceUpdate !== 1 ? "s" : ""} ago`);
      }
      if (!vaultResults.some((r: any) => r.type === "research")) {
        gaps.push("No formal research saved — only informal notes exist");
      }
      if (memResults.length < 3) {
        gaps.push("Thin coverage — fewer than 3 semantic memories on this topic");
      }
      if (!vaultResults.some((r: any) => r.type === "execution")) {
        gaps.push("No execution history — no trades or actions logged");
      }

      const lines = [
        `🔮 **Intelligence Report: "${topic}"**`,
        `Confidence: ${confidence} · ${memResults.length} semantic memories · ${vaultResults.length} vault entries`,
        oldest ? `Coverage: ${new Date(oldest).toLocaleDateString("en-US")} – ${daysSinceUpdate === 0 ? "today" : daysSinceUpdate !== null ? `${daysSinceUpdate}d ago` : "unknown"}` : "",
        ``,
        `**What you know:**`,
        ...memLines,
        ...(vaultLines.length ? ["", "**Vault entries:**", ...vaultLines] : []),
        ``,
      ];

      if (gaps.length) {
        lines.push(`**⚠️ Knowledge gaps:**`);
        gaps.forEach(g => lines.push(`  • ${g}`));
        lines.push("");
      }

      lines.push(`**Suggested actions:**`);
      if (gaps.some(g => g.includes("research") || g.includes("Stale"))) {
        lines.push(`• \`swarm_research topic: "${topic}"\` — refresh with deep research`);
      }
      if (gaps.some(g => g.includes("Stale"))) {
        lines.push(`• \`trigger_agent agentId: "market-monitor" params: { token: "${topic.split(" ")[0].toUpperCase()}" }\``);
      }
      lines.push(`• \`memory_context topic: "${topic}"\` — inject full context into your next prompt`);
      lines.push(`• \`swarm_watch topic: "${topic}"\` — monitor this topic continuously`);

      return { content: [{ type: "text", text: lines.filter(l => l !== undefined).join("\n") }] };
    }

    case "memory_extract": {
      const parsed = ExtractSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { text, source = "extract" } = parsed.data;
      const data = await callConvex("/memory/extract", "POST", { text, source }).catch((err: any) => ({ error: err.message }));
      if (data?.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
      const facts: string[] = data?.facts ?? [];
      return {
        content: [{
          type: "text",
          text: [
            `🧠 **Auto-extracted ${data?.extracted ?? facts.length} facts** (${data?.saved ?? 0} saved)`,
            ``,
            ...facts.map((f: string, i: number) => `${i + 1}. ${f}`),
            ``,
            `All facts are now searchable via \`memory_search\`.`,
          ].join("\n"),
        }],
      };
    }

    case "memory_consolidate": {
      const parsed = ConsolidateSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { topic, limit = 12 } = parsed.data;
      const data = await callConvex("/memory/consolidate", "POST", { topic, n: limit }).catch((err: any) => ({ error: err.message }));
      if (data?.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
      return {
        content: [{
          type: "text",
          text: [
            `🧠 **Consolidated "${topic}"** — merged ${data?.consolidatedFrom ?? "?"} memories`,
            `Saved as: \`${data?.id ?? "consolidated"}\``,
            ``,
            `**Summary:**`,
            data?.summary ?? "",
            ``,
            `Use \`memory_search query: "${topic}"\` to find it.`,
          ].join("\n"),
        }],
      };
    }

    default:
      return null;
  }
}
