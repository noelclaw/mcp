import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";
import { callConvex } from "../convex.js";

const FC_BASE = "https://api.firecrawl.dev/v1";

export const RESEARCH_TOOLS: Tool[] = [
  {
    name: "web_scrape",
    description:
      "Fetch and extract clean readable content from any URL - returns markdown. " +
      "Use when an agent needs to read an article, docs page, GitHub repo, or any web page. " +
      "Set FIRECRAWL_API_KEY for best quality (firecrawl.dev). Falls back to basic fetch if not set.",
    inputSchema: {
      type: "object",
      properties: {
        url:   { type: "string", description: "URL to fetch" },
        focus: { type: "string", description: "Optional: specific topic or section to extract from the page" },
      },
      required: ["url"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web and return raw results: titles, URLs, and snippets. No synthesis or analysis — " +
      "use this for quick lookups, finding sources, or fetching recent news. " +
      "For multi-source research with LLM synthesis, use deep_research instead. " +
      "Requires FIRECRAWL_API_KEY (firecrawl.dev).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default 5, max 10)" },
      },
      required: ["query"],
    },
  },
];

const ScrapeSchema = z.object({
  url:   z.string().url(),
  focus: z.string().optional(),
});

const SearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).optional(),
});

async function firecrawlScrape(url: string): Promise<string | null> {
  // Priority 1: user's own FIRECRAWL_API_KEY (BYOK fast-path, zero network detour).
  const key = process.env.FIRECRAWL_API_KEY;
  if (key) {
    try {
      const res = await fetch(`${FC_BASE}/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const data = await res.json() as any;
        return data.data?.markdown ?? null;
      }
    } catch { /* fall through to backend proxy */ }
  }

  // Priority 2: route through Noelclaw backend (session-token authed, backend
  // pays for the Firecrawl call). The backend returns 503 if it doesn't have
  // FIRECRAWL_API_KEY set either, in which case web_scrape silently falls
  // through to basicFetch below.
  try {
    const data = await callConvex("/research/firecrawl-scrape", "POST", { url }, "web_scrape_proxy", 25_000);
    if (data?.markdown) return data.markdown as string;
  } catch { /* fall through */ }

  return null;
}

async function basicFetch(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NoelclawBot/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
  } catch {
    return null;
  }
}

export async function handleResearchTool(name: string, args: unknown): Promise<ToolResult | null> {
  if (name === "web_scrape") {
    const parsed = ScrapeSchema.safeParse(args);
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
    const { url, focus } = parsed.data;

    let content = await firecrawlScrape(url);
    const source = content ? "Firecrawl" : "basic fetch";
    if (!content) content = await basicFetch(url);

    if (!content) {
      return { content: [{ type: "text", text: `Could not fetch ${url} - page may require JavaScript or block crawlers.` }], isError: true };
    }

    const focusNote = focus ? `\n\n_Focus: ${focus}_\n\n` : "\n\n";
    const body = content.length > 6000 ? content.slice(0, 6000) + "\n\n…(truncated)" : content;

    return { content: [{ type: "text", text: `**${url}**${focusNote}${body}\n\n_Source: ${source}_` }] };
  }

  if (name === "web_search") {
    const parsed = SearchSchema.safeParse(args);
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
    const { query, limit = 5 } = parsed.data;

    // Priority 1: user BYOK direct path. Priority 2: Noelclaw proxy.
    // Same data shape so the formatting code below is identical for both.
    const key = process.env.FIRECRAWL_API_KEY;
    let results: any[] | null = null;
    let lastErr: string | null = null;

    if (key) {
      try {
        const res = await fetch(`${FC_BASE}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
          body: JSON.stringify({ query, limit }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) {
          const data = await res.json() as any;
          results = data.data ?? [];
        } else {
          lastErr = `${res.status}: ${(await res.text()).slice(0, 200)}`;
        }
      } catch (err: any) {
        lastErr = err?.message ?? "BYOK search failed";
      }
    }

    if (!results) {
      try {
        const data = await callConvex("/research/firecrawl-search", "POST", { query, limit }, "web_search_proxy", 30_000);
        results = data?.results ?? [];
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        return {
          content: [{
            type: "text",
            text: [
              `web_search failed.`,
              ``,
              `Tried backend proxy: ${msg.slice(0, 200)}`,
              lastErr ? `Direct call also failed: ${lastErr}` : "",
              ``,
              `Fix: either run \`/login\` so the Noelclaw backend can pay, or set FIRECRAWL_API_KEY in your MCP env block.`,
            ].filter(Boolean).join("\n"),
          }],
          isError: true,
        };
      }
    }

    const safeResults = results ?? [];
    if (!safeResults.length) {
      return { content: [{ type: "text", text: `No results found for: "${query}"` }] };
    }

    const lines = [`🔍 **Web Search: "${query}"** - ${safeResults.length} results\n`];
    for (const r of safeResults) {
      lines.push(`**${r.title ?? r.url}**`);
      lines.push(r.url);
      if (r.description) lines.push(r.description.slice(0, 200));
      lines.push("");
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  return null;
}
