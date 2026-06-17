import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import * as crypto from "crypto";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";

// ─── Helpers (proxied through Convex - server-side Supermemory key) ──────────

// Normalize content for dedup: lowercase + collapse whitespace + trim. This
// catches accidental duplicates from agents that re-emit the same fact with
// different leading/trailing whitespace or casing.
function contentHash(content: string): string {
  const normalized = content.toLowerCase().replace(/\s+/g, " ").trim();
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

// In-process LRU cache of content hashes added in this session. Supermemory
// is eventually consistent - calling memory_add twice rapidly with the same
// content would otherwise both succeed because /memory/list doesn't see
// the just-inserted entry yet. The cache closes that race so same-session
// duplicates are caught even before the index sees them.
const RECENT_HASH_TTL_MS = 60 * 60 * 1000; // 1 hour
const RECENT_HASH_MAX = 500;
const recentHashCache = new Map<string, { id: string; title?: string; addedAt: number }>();

function rememberRecentHash(hash: string, id: string, title?: string): void {
  // Re-insert moves it to the end of the Map (most-recently-used).
  recentHashCache.delete(hash);
  recentHashCache.set(hash, { id, title, addedAt: Date.now() });
  while (recentHashCache.size > RECENT_HASH_MAX) {
    const oldest = recentHashCache.keys().next().value;
    if (oldest === undefined) break;
    recentHashCache.delete(oldest);
  }
}

function lookupRecentHash(hash: string): { id: string; title?: string; addedAt: number } | null {
  const hit = recentHashCache.get(hash);
  if (!hit) return null;
  if (Date.now() - hit.addedAt > RECENT_HASH_TTL_MS) {
    recentHashCache.delete(hash);
    return null;
  }
  return hit;
}

// Two-tier dedup lookup: in-process cache first (catches same-session
// dupes during eventual-consistency window), then a list call (catches
// cross-session dupes once they've been indexed). Returns null on any
// failure - dedup must never block legitimate writes.
async function findDuplicateMemory(hash: string): Promise<{ id: string; title?: string; addedAt?: number } | null> {
  const cached = lookupRecentHash(hash);
  if (cached) return cached;
  try {
    const data: any = await callConvex("/memory/list", "POST", { n: 50 });
    const results: any[] = data?.results ?? [];
    const match = results.find((r) => r.metadata?.contentHash === hash);
    if (!match) return null;
    return { id: match.id, title: match.metadata?.title, addedAt: match.metadata?.addedAt };
  } catch {
    return null;
  }
}

const SYNC_RETRY_DELAYS_MS = [500, 2000, 5000];

export async function syncToSupermemory(
  content: string,
  metadata: Record<string, unknown>,
  sourceUrl?: string,
): Promise<void> {
  const payload = {
    content,
    metadata,
    ...(sourceUrl ? { sourceUrl } : {}),
  };

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= SYNC_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await callConvex("/memory/add", "POST", payload);
      return;
    } catch (err) {
      lastError = err;
      const delay = SYNC_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
  const preview = content.slice(0, 120).replace(/\s+/g, " ");
  await callConvex("/chronicle/add", "POST", {
    type: "system",
    title: `Supermemory sync failed after ${SYNC_RETRY_DELAYS_MS.length + 1} attempts`,
    detail: `Error: ${errMsg}\nPreview: ${preview}`,
    metadata: { ...metadata, sourceUrl, attempts: SYNC_RETRY_DELAYS_MS.length + 1, kind: "memory_sync_failed" },
    source: "mcp",
  }).catch(() => {
    // Chronicle write itself failed - last-resort console; supermemory is best-effort.
    console.error(`[memory] sync_failed: ${errMsg} | preview: "${preview}"`);
  });
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

// Lexical (full-text / BM25-style) search over the Convex memories mirror.
// Returns rows in relevance-rank order so the fusion step can use rank
// directly without re-normalizing raw scores.
async function lexicalSearch(
  query: string,
  limit = 30,
): Promise<Array<{ id: string; content: string; metadata: any; rank: number }>> {
  try {
    const data = await callConvex("/memory/lexical", "POST", { q: query, n: limit });
    const rows = (data?.results ?? []) as any[];
    return rows.map((r, idx) => ({
      id:       r.id,
      content:  r.content ?? "",
      metadata: r.metadata ?? {},
      rank:     typeof r.rank === "number" ? r.rank : idx,
    }));
  } catch {
    return [];
  }
}

// Reciprocal Rank Fusion - combines two ranked lists into one without needing
// to normalize raw scores. Each list contributes 1/(k + rank) to a doc's
// final score; docs that appear in both lists rank above docs in only one.
// k=60 is the canonical TREC/Lucene default; ours can be tuned via the eval
// suite. See: "Reciprocal Rank Fusion outperforms Condorcet and individual
// Rank Learning Methods" (Cormack et al., SIGIR 2009).
const RRF_K = 60;

export interface HybridResult {
  id: string;
  content: string;
  metadata: any;
  fusedScore: number;
  semanticRank: number | null;
  lexicalRank: number | null;
  // Final score post-decay weighting - what we rank the user-facing list by.
  finalScore?: number;
  // Internal - preserved for callers (memory_search prints these).
  score?: number;
}

export function fuseRRF(
  semantic: Array<{ id: string; content: string; metadata: any; score?: number }>,
  lexical: Array<{ id: string; content: string; metadata: any; rank: number }>,
  k = RRF_K,
): HybridResult[] {
  const merged = new Map<string, HybridResult>();

  semantic.forEach((doc, rank) => {
    merged.set(doc.id, {
      id: doc.id,
      content: doc.content,
      metadata: doc.metadata,
      fusedScore: 1 / (k + rank),
      semanticRank: rank,
      lexicalRank: null,
      score: doc.score,
    });
  });

  lexical.forEach((doc) => {
    const existing = merged.get(doc.id);
    const lexContrib = 1 / (k + doc.rank);
    if (existing) {
      existing.fusedScore += lexContrib;
      existing.lexicalRank = doc.rank;
    } else {
      merged.set(doc.id, {
        id: doc.id,
        content: doc.content,
        metadata: doc.metadata,
        fusedScore: lexContrib,
        semanticRank: null,
        lexicalRank: doc.rank,
      });
    }
  });

  return [...merged.values()].sort((a, b) => b.fusedScore - a.fusedScore);
}

// Hybrid retrieval: fan out semantic + lexical in parallel, fuse via RRF.
// Returns the unified candidate list - callers (memory_search) layer their
// own decay + reranking on top.
export async function hybridMemorySearch(query: string, limit = 30): Promise<HybridResult[]> {
  // Over-fetch from each side so the fusion has enough overlap to find
  // co-ranked docs. Each side returns up to `limit` items; the union is
  // capped to keep response size bounded.
  const [semantic, lexical] = await Promise.all([
    searchSupermemory(query, limit),
    lexicalSearch(query, limit),
  ]);
  return fuseRRF(semantic, lexical);
}

// ─── Tool definitions ────────────────────────────────────────────────────────

export const MEMORY_TOOLS: Tool[] = [
  {
    name: "memory_add",
    description:
      "Add content to your Noelclaw semantic memory - no setup needed, no extra API keys. " +
      "Unlike vault_save, memory_add is instant: no versioning, no type required. " +
      "Use for notes, decisions, preferences, or anything you want to find later with natural language. " +
      "Pass sourceUrl to fetch and index any web page, GitHub repo, or Notion page automatically - " +
      "searchable in ~30s. Memory is indexed semantically - 'what did I say about ETH yield?' " +
      "will find it even without exact keywords. " +
      "Auto-deduplicates: identical content in your recent 50 memories is skipped (override with force:true).",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Content to remember - text, markdown, or a note. Use a short title if providing sourceUrl." },
        title: { type: "string", description: "Optional title for this memory" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for grouping" },
        sourceUrl: { type: "string", description: "URL to fetch and index automatically (GitHub, Notion, web page, etc.). Content becomes searchable in ~30s." },
        force: { type: "boolean", description: "Bypass duplicate detection. Set true to allow a second copy of identical content." },
      },
      required: ["content"],
    },
  },
  {
    name: "memory_search",
    description:
      "Hybrid memory search - fuses semantic (embedding) + lexical (full-text BM25) retrieval via Reciprocal Rank Fusion. " +
      "Catches both meaning matches ('low risk crypto yield' → 'conservative DeFi strategies') and exact-token lookups (env var names, contract addresses, IDs) that pure semantic search misses. " +
      "90-day time-decay weighting on top so recent precise notes outrank stale ones. " +
      "Falls back to semantic-only for memories added before v3.24 (no lexical mirror).",
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
      "Uses vector search - finds semantically related content, not just exact keyword matches.",
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
      "Show your semantic memory stats - total memories stored, your memory space, and connected sources. " +
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
      "Get a full intelligence report on any topic - combines semantic memory AND vault entries, " +
      "then identifies knowledge gaps and suggests next actions. " +
      "Use this before starting any research or trade decision to see everything Noelclaw already knows. " +
      "Returns: confidence level, what you know, coverage timeline, gaps, and recommended next steps.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to analyze - token, protocol, strategy, or any concept" },
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
      "Each extracted fact becomes independently searchable - 'what do I prefer about staking?' will find it.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to extract facts from - notes, research, chat logs, any unstructured content" },
        source: { type: "string", description: "Optional label for where this came from (e.g. 'telegram', 'research', 'meeting')" },
      },
      required: ["text"],
    },
  },
  {
    name: "memory_publish",
    description:
      "Publish a memory snippet to the Memory Marketplace - makes it publicly visible to all Noelclaw users. " +
      "Great for sharing curated knowledge, useful context, research findings, or prompts. " +
      "Saved as a public vault entry (type=memory). Once published it appears at /memory-marketplace in the app.",
    inputSchema: {
      type: "object",
      properties: {
        title:      { type: "string",                   description: "Short title for the memory (shown in marketplace)" },
        content:    { type: "string",                   description: "The memory content to share" },
        tags:       { type: "array", items: { type: "string" }, description: "Optional tags (e.g. ['DeFi', 'Base', 'research'])" },
        authorName: { type: "string",                   description: "Display name for the author (defaults to your wallet address)" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "memory_consolidate",
    description:
      "Fetch all memories on a topic and consolidate them into a single comprehensive summary using AI. " +
      "Removes redundancy, merges overlapping facts, and saves the result as a new 'consolidated' memory. " +
      "Use this to clean up fragmented knowledge after heavy research sessions. " +
      "Returns the summary and saves it automatically - the original memories remain intact.",
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
  force: z.boolean().optional(),
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

      const { content, title, tags, sourceUrl, force } = parsed.data;
      const hash = contentHash(content);

      // Dedup: skip if an identical-content memory exists in recent history,
      // unless caller passed `force: true`. URL-sourced memories skip dedup -
      // the same URL may legitimately be re-indexed after content changes.
      if (!force && !sourceUrl) {
        const existing = await findDuplicateMemory(hash);
        if (existing) {
          const age = existing.addedAt ? Math.max(0, Math.round((Date.now() - existing.addedAt) / 60_000)) : null;
          return {
            content: [{
              type: "text",
              text: [
                `↩️ **Duplicate skipped** - identical content already stored.`,
                `Existing ID: \`${existing.id}\`${existing.title ? ` · ${existing.title}` : ""}${age !== null ? ` · added ${age}m ago` : ""}`,
                ``,
                `Override with \`memory_add content: "…" force: true\` if you really want a second copy.`,
              ].join("\n"),
            }],
          };
        }
      }

      const data = await callConvex("/memory/add", "POST", {
        content,
        metadata: { title, tags, source: "memory_add", addedAt: Date.now(), contentHash: hash },
        ...(sourceUrl ? { sourceUrl } : {}),
      }).catch((err: any) => ({ error: err.message }));

      if (data?.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      // Cache the hash so an immediate second call with identical content
      // dedupes even before supermemory has indexed the first one.
      if (!sourceUrl) rememberRecentHash(hash, data?.id ?? "saved", title);

      return {
        content: [{
          type: "text",
          text: [
            `🧠 **Memory added** - ID: \`${data?.id ?? "saved"}\``,
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
      // Over-fetch so post-decay ranking still has enough material.
      const overfetch = Math.min(50, Math.max(limit * 2, 20));

      // ─── Hybrid retrieval ────────────────────────────────────────────
      // Fan out semantic (Supermemory embedding) + lexical (Convex full-text)
      // in parallel, fuse via Reciprocal Rank Fusion. Falls back gracefully:
      // if lexical is empty (e.g. user has only pre-v3.24 memories) the
      // fused list equals semantic.
      const fused = await hybridMemorySearch(query, overfetch);
      const raw = fused as Array<{
        id: string; content: string; metadata: any; fusedScore: number;
        semanticRank: number | null; lexicalRank: number | null; score?: number;
      }>;

      if (!raw.length) return { content: [{ type: "text", text: `No memories found for: "${query}"\nTry adding content with \`memory_add\` or \`vault_save\`.` }] };

      // ─── Time-decay weighting ─────────────────────────────────────────
      // Apply an age-aware multiplier to the fused RRF score so a relevant
      // old casual note doesn't outrank a recent precise one. Half-life of
      // 90 days - a memory loses ~30% relevance over a quarter.
      // Pinned memories (metadata.pinned) bypass decay.
      const HALF_LIFE_DAYS = 90;
      const decayed = raw.map((r) => {
        const ageMs = Date.now() - (r.metadata?.addedAt ?? 0);
        const ageDays = ageMs > 0 ? ageMs / 86_400_000 : 0;
        const pinned = r.metadata?.pinned === true;
        const decayMul = pinned ? 1 : Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
        return {
          ...r,
          _decayedScore: r.fusedScore * decayMul,
          _ageDays:      ageDays,
          _pinned:       pinned,
        };
      })
        .sort((a, b) => b._decayedScore - a._decayedScore)
        .slice(0, limit);

      // Hybrid mode is on if any result was lexically ranked too.
      const hybridHits = decayed.filter((r) => r.lexicalRank !== null).length;
      const modeLabel = hybridHits > 0
        ? `Hybrid (semantic + lexical), ${hybridHits} dual-ranked`
        : `Semantic only (lexical empty for this query)`;
      const header = `🔍 **Memory Search**: "${query}" - ${decayed.length} result(s) · ${modeLabel} · time-decay 90d half-life`;
      const rows = decayed.map((r, i) => {
        // Per-result rank annotation: shows whether each hit came from
        // semantic, lexical, or both. Cheap signal of retrieval quality.
        const tags: string[] = [];
        if (r.semanticRank !== null) tags.push(`sem#${r.semanticRank + 1}`);
        if (r.lexicalRank !== null)  tags.push(`lex#${r.lexicalRank + 1}`);
        const tagStr = tags.length ? ` (${tags.join(", ")})` : "";
        const score = ` [${(r._decayedScore * 1000).toFixed(0)}]`;
        const title = r.metadata?.title ?? "";
        const ageNote = r._ageDays > 0 ? ` · ${Math.round(r._ageDays)}d` : "";
        const pinBadge = r._pinned ? " 📌" : "";
        const preview = r.content.slice(0, 200).replace(/\n/g, " ");
        return [
          `${i + 1}.${score}${pinBadge}${title ? ` **${title}**` : ""}${ageNote}${tagStr} \`${r.id}\``,
          `   ${preview}${r.content.length > 200 ? "…" : ""}`,
        ].join("\n");
      });

      // ─── Promotion hint when N+ memories cluster on a topic ───────────
      // If 4+ memories surface for one query they're collectively load-
      // bearing - suggest the user promote them to a single versioned vault
      // entry so the knowledge becomes structured and citable.
      let promotionHint = "";
      if (decayed.length >= 4) {
        const topic = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
        promotionHint = [
          ``,
          `💡 **${decayed.length} memories on this topic.** Consider promoting to a vault entry for cleaner versioning + linking:`,
          ``,
          `\`\`\``,
          `memory_consolidate topic="${query}" n=${Math.min(decayed.length, 8)}`,
          `# Then: copy the summary and:`,
          `vault_save type=research key=memory-cluster/${topic} content="<the consolidation>"`,
          `\`\`\``,
        ].join("\n");
      }

      return { content: [{ type: "text", text: [header, "", ...rows, promotionHint].filter(Boolean).join("\n") }] };
    }

    case "memory_context": {
      const parsed = ContextSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

      const { topic, limit = 8 } = parsed.data;
      // v3.25.1: use hybrid retrieval so context loading picks up exact-token
      // matches (env var names, model IDs, contract addresses) that semantic-
      // only would miss. Same fusion as memory_search.
      const results = await hybridMemorySearch(topic, limit);

      if (!results.length) return { content: [{ type: "text", text: `No context found for: "${topic}"\nBuild your memory base with vault_save or memory_add.` }] };

      const contextParts = results.map((r, i) => {
        const title = r.metadata?.title ? `### ${r.metadata.title}` : `### Memory ${i + 1}`;
        return `${title}\n${r.content}`;
      });
      const summary = results.map(r => r.metadata?.title ?? r.content.slice(0, 50)).join(", ");

      return {
        content: [{
          type: "text",
          text: [
            `🧠 **Context** for: "${topic}" (hybrid retrieval)`,
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
      const space = data?.space ?? "-";

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
            `• vault_save - ✅`,
            `• memory_add (URL indexing) - ✅`,
            `• Google Drive / Gmail / Notion - connect at noelclaw.com`,
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

      // v3.25.1: hybrid retrieval for memory side (was semantic-only) so the
      // intelligence report surfaces exact-token matches alongside meaning
      // matches. Vault side runs in parallel as before.
      const [memResults, vaultData] = await Promise.all([
        hybridMemorySearch(topic, memLimit),
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
              `• \`deep_research query: "${topic}" depth: "standard"\` - multi-agent research now`,
              `• \`memory_add content: "..." \` - add a manual note`,
              `• \`schedule_research topic: "${topic}"\` - recurring monitor that saves to vault`,
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
        `  • [vault/${r.type}] ${r.title} - v${r.version}`
      );

      // Gap analysis
      const gaps: string[] = [];
      if (daysSinceUpdate !== null && daysSinceUpdate > 7) {
        gaps.push(`Stale data - last update ${daysSinceUpdate} day${daysSinceUpdate !== 1 ? "s" : ""} ago`);
      }
      if (!vaultResults.some((r: any) => r.type === "research")) {
        gaps.push("No formal research saved - only informal notes exist");
      }
      if (memResults.length < 3) {
        gaps.push("Thin coverage - fewer than 3 semantic memories on this topic");
      }
      if (!vaultResults.some((r: any) => r.type === "execution")) {
        gaps.push("No execution history - no trades or actions logged");
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
        lines.push(`• \`deep_research query: "${topic}" depth: "standard"\` - refresh with multi-agent research`);
      }
      lines.push(`• \`memory_context topic: "${topic}"\` - inject full context into your next prompt`);
      lines.push(`• \`schedule_research topic: "${topic}"\` - monitor this topic continuously`);

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
            `🧠 **Consolidated "${topic}"** - merged ${data?.consolidatedFrom ?? "?"} memories`,
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

    case "memory_publish": {
      const { title, content, tags, authorName } = args as {
        title: string; content: string; tags?: string[]; authorName?: string;
      };
      if (!title || !content) return { content: [{ type: "text", text: "title and content are required" }], isError: true };

      const data = await callConvex("/vault/save", "POST", {
        type:       "memory",
        title,
        content,
        tags:       tags ?? [],
        isPublic:   true,
        authorName: authorName ?? "Anonymous",
        commitMsg:  "published to marketplace",
      }, "vault_save") as { key?: string; version?: number; error?: string };

      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
      return {
        content: [{
          type: "text",
          text: [
            `🧠 **Memory Published**`,
            ``,
            `**Title:** ${title}`,
            `**Key:** \`${data.key}\``,
            `**Version:** ${data.version ?? 1}`,
            ``,
            `Now visible at the Memory Marketplace in the Noelclaw app.`,
          ].join("\n"),
        }],
      };
    }

    default:
      return null;
  }
}
