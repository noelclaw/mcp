import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";
import { callLLM } from "../llm.js";
import { callConvex } from "../convex.js";

const FC_BASE = "https://api.firecrawl.dev/v1";

// ─── Tool schema ──────────────────────────────────────────────────────────────

export const DEEP_RESEARCH_TOOLS: Tool[] = [
  {
    name: "deep_research",
    description:
      "End-to-end deep research on any topic — decomposes the question into sub-queries, searches the web in parallel, scrapes top sources, cross-references them, and writes a structured report with inline citations [1] [2]. " +
      "Auto-saves the report to vault as type:research. Requires FIRECRAWL_API_KEY. " +
      "Use for: market analysis, competitor research, technical investigation, news synthesis, due diligence. " +
      "Cost per run: ~2 LLM calls + 3-7 web searches + 6-15 page scrapes. Takes 20-90s depending on depth.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Research question or topic — be specific (e.g. 'state of Base chain TVL Q2 2026' beats 'Base chain')" },
        depth: {
          type: "string",
          enum: ["fast", "standard", "deep"],
          description: "fast=3 sub-Qs, ~6 sources, ~30s. standard=5 sub-Qs, ~10 sources, ~60s. deep=7 sub-Qs, ~15 sources, ~90s. Default standard.",
        },
        saveToVault: { type: "boolean", description: "Auto-save the report to vault (default true)" },
      },
      required: ["query"],
    },
  },
];

const InputSchema = z.object({
  query: z.string().min(3).max(500),
  depth: z.enum(["fast", "standard", "deep"]).optional(),
  saveToVault: z.boolean().optional(),
});

interface Source {
  n: number;
  url: string;
  title: string;
  excerpt: string;
}

// ─── Firecrawl helpers ────────────────────────────────────────────────────────

async function fcSearch(
  query: string,
  limit: number,
): Promise<Array<{ url: string; title: string; description?: string }>> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(`${FC_BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, limit }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ url: string; title: string; description?: string }> };
    return data.data ?? [];
  } catch {
    return [];
  }
}

async function fcScrape(url: string): Promise<string | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${FC_BASE}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { markdown?: string } };
    return data.data?.markdown ?? null;
  } catch {
    return null;
  }
}

// ─── LLM stages ───────────────────────────────────────────────────────────────

async function decomposeQuery(query: string, n: number): Promise<string[]> {
  const systemPrompt = "You are a research planner. Output JSON only.";
  const userPrompt = `Break this research question into ${n} focused sub-questions that cover the topic from different angles. Each sub-question must be a standalone web search query under 80 characters.

QUESTION: "${query}"

Return ONLY a JSON array of strings. Example output: ["What is X?", "How does X compare to Y in 2026?", "Recent news on X"]`;

  let raw = "";
  try {
    raw = await callLLM(systemPrompt, userPrompt, 400, [], 30_000);
  } catch {
    return [query];
  }
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    const arr: unknown = match ? JSON.parse(match[0]) : [];
    if (!Array.isArray(arr)) return [query];
    const filtered = arr.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 200);
    return filtered.length > 0 ? filtered.slice(0, n) : [query];
  } catch {
    return [query];
  }
}

async function synthesize(query: string, sources: Source[]): Promise<string> {
  const sourceBlocks = sources
    .map((s) => `[${s.n}] ${s.title}\nURL: ${s.url}\n\n${s.excerpt.slice(0, 1800)}`)
    .join("\n\n---\n\n");

  const systemPrompt = `You are a senior analyst writing a structured research report from numbered web sources.

REPORT FORMAT (Markdown — output exactly these sections, in this order):

# {short title — 8 words max}

## TL;DR
2-3 sentences answering the question directly.

## Key Findings
- 5-8 substantive bullets, each citing source numbers like [1] or [2,4]
- Cover different angles and sources — don't keep citing the same one

## Analysis
2-4 paragraphs synthesizing the sources. Note where they agree, disagree, or leave gaps. Use inline citations.

## What to Watch
3-5 forward-looking signals, open questions, or things to monitor.

CITATION RULES:
- Cite using [N] inline matching the source numbers exactly
- Distinguish primary evidence (data, official statements) from secondary commentary
- Flag thin or single-source claims as such

STYLE RULES:
- Be specific: numbers, names, dates over vague claims
- No filler phrases ("it is important to note", "in conclusion", "in today's world")
- No hedging when the evidence is strong; no false confidence when it's weak
- Don't write a "Sources" section — that gets appended automatically`;

  const userPrompt = `RESEARCH QUESTION: ${query}

SOURCES:
${sourceBlocks}

Write the report now. Output Markdown only — no preamble, no postamble.`;

  return await callLLM(systemPrompt, userPrompt, 3500, [], 90_000);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleDeepResearch(
  name: string,
  args: unknown,
): Promise<ToolResult | null> {
  if (name !== "deep_research") return null;

  const parsed = InputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }],
      isError: true,
    };
  }
  const { query } = parsed.data;
  const depth = parsed.data.depth ?? "standard";
  const saveToVault = parsed.data.saveToVault ?? true;

  if (!process.env.FIRECRAWL_API_KEY) {
    return {
      content: [{
        type: "text",
        text: [
          "⚠️ deep_research requires FIRECRAWL_API_KEY.",
          "",
          "Get a free key at firecrawl.dev, then add to your MCP config env block:",
          `\`"FIRECRAWL_API_KEY": "fc-..."\``,
        ].join("\n"),
      }],
      isError: true,
    };
  }

  const subN        = depth === "fast" ? 3 : depth === "deep" ? 7 : 5;
  const searchLimit = depth === "fast" ? 3 : depth === "deep" ? 5 : 4;
  const scrapeTop   = depth === "fast" ? 2 : depth === "deep" ? 3 : 2;
  const maxScrape   = depth === "fast" ? 6 : depth === "deep" ? 15 : 10;
  const maxSources  = depth === "fast" ? 6 : depth === "deep" ? 12 : 10;

  // Stage 1 — plan
  const subQs = await decomposeQuery(query, subN);

  // Stage 2 — parallel web search across all sub-questions
  const searchResults = await Promise.all(subQs.map((q) => fcSearch(q, searchLimit)));

  // Dedupe candidate URLs across sub-questions, preserving order
  const seen = new Set<string>();
  const candidates: { url: string; title: string; desc: string }[] = [];
  for (const results of searchResults) {
    for (const r of results.slice(0, scrapeTop)) {
      if (r.url && !seen.has(r.url)) {
        seen.add(r.url);
        candidates.push({ url: r.url, title: r.title ?? r.url, desc: r.description ?? "" });
      }
    }
  }

  if (candidates.length === 0) {
    return {
      content: [{ type: "text", text: `No sources found for: "${query}"` }],
      isError: true,
    };
  }

  // Stage 3 — parallel scrape of top candidates
  const scraped = await Promise.all(
    candidates.slice(0, maxScrape).map(async (c) => {
      const md = await fcScrape(c.url);
      if (!md) return null;
      return { url: c.url, title: c.title, excerpt: md.slice(0, 2000) };
    }),
  );

  const sources: Source[] = scraped
    .filter((s): s is NonNullable<typeof s> => s !== null && s.excerpt.length > 100)
    .slice(0, maxSources)
    .map((s, i) => ({ n: i + 1, url: s.url, title: s.title, excerpt: s.excerpt }));

  if (sources.length === 0) {
    return {
      content: [{ type: "text", text: `Found ${candidates.length} candidate URLs but could not scrape any for: "${query}"` }],
      isError: true,
    };
  }

  // Stage 4 — synthesize
  let report: string;
  try {
    report = await synthesize(query, sources);
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `Synthesis failed: ${err.message ?? err}` }],
      isError: true,
    };
  }

  // Append numbered sources list
  const sourcesSection = sources.map((s) => `[${s.n}] ${s.title} — ${s.url}`).join("\n");
  const fullReport = `${report.trim()}\n\n## Sources\n\n${sourcesSection}`;

  // Stage 5 — best-effort vault save
  let vaultKey: string | null = null;
  if (saveToVault) {
    try {
      const r = (await callConvex(
        "/vault/save",
        "POST",
        {
          type: "research",
          title: `Deep Research: ${query.slice(0, 80)}`,
          content: fullReport,
          tags: ["deep-research", depth],
          agentId: "research",
          commitMsg: "deep_research run",
        },
        "vault_save",
      )) as { key?: string } | null;
      vaultKey = r?.key ?? null;
    } catch {
      // user may not be authenticated to vault — return report inline anyway
    }
  }

  const meta = [
    `🔬 **Deep Research** — depth: ${depth} · ${subQs.length} sub-questions · ${sources.length} sources`,
    vaultKey ? `📁 Saved to vault: \`${vaultKey}\`` : (saveToVault ? `⚠️ Vault save skipped (not authenticated — sign in with \`noelclaw login\`)` : ""),
    "",
  ].filter(Boolean).join("\n");

  return {
    content: [{ type: "text", text: `${meta}\n${fullReport}` }],
  };
}
