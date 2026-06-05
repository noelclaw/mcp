import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";

const FC_BASE = "https://api.firecrawl.dev/v1";

export const RESEARCH_TOOLS: Tool[] = [
  {
    name: "web_scrape",
    description:
      "Fetch and extract clean readable content from any URL — returns markdown. " +
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
      "Search the web and get clean results: titles, URLs, and content snippets. " +
      "Use for research on any topic, finding recent news, or gathering live information. " +
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
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${FC_BASE}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.data?.markdown ?? null;
  } catch {
    return null;
  }
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
      return { content: [{ type: "text", text: `Could not fetch ${url} — page may require JavaScript or block crawlers.` }], isError: true };
    }

    const focusNote = focus ? `\n\n_Focus: ${focus}_\n\n` : "\n\n";
    const body = content.length > 6000 ? content.slice(0, 6000) + "\n\n…(truncated)" : content;

    return { content: [{ type: "text", text: `**${url}**${focusNote}${body}\n\n_Source: ${source}_` }] };
  }

  if (name === "web_search") {
    const parsed = SearchSchema.safeParse(args);
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
    const { query, limit = 5 } = parsed.data;

    const key = process.env.FIRECRAWL_API_KEY;
    if (!key) {
      return {
        content: [{
          type: "text",
          text: [
            `web_search requires FIRECRAWL_API_KEY.`,
            ``,
            `Get a free key at firecrawl.dev, then add to your MCP config:`,
            `\`"env": { "FIRECRAWL_API_KEY": "fc-..." }\``,
          ].join("\n"),
        }],
        isError: true,
      };
    }

    try {
      const res = await fetch(`${FC_BASE}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ query, limit }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const err = await res.text();
        return { content: [{ type: "text", text: `Search failed: ${err}` }], isError: true };
      }
      const data = await res.json() as any;
      const results: any[] = data.data ?? [];

      if (!results.length) {
        return { content: [{ type: "text", text: `No results found for: "${query}"` }] };
      }

      const lines = [`🔍 **Web Search: "${query}"** — ${results.length} results\n`];
      for (const r of results) {
        lines.push(`**${r.title ?? r.url}**`);
        lines.push(r.url);
        if (r.description) lines.push(r.description.slice(0, 200));
        lines.push("");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Search error: ${err.message}` }], isError: true };
    }
  }

  return null;
}
