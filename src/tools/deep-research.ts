import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";
import { callLLM } from "../llm.js";
import { callConvex } from "../convex.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const FC_BASE = "https://api.firecrawl.dev/v1";
const MAX_PER_DOMAIN = 2;          // source diversity — cap hits per domain
const EXCERPT_CHARS_PER_CHUNK = 600;
const EXCERPT_TOP_CHUNKS = 4;       // pick top N relevant chunks per source

// Quality scoring — higher = more trustworthy primary source
const DOMAIN_TIER_BONUS: Array<[RegExp, number]> = [
  [/\.gov(\b|\/|$)/i, 4],
  [/\.edu(\b|\/|$)/i, 3],
  [/(?:nature|science|nih|arxiv|acm|ieee|sciencedirect)\.(?:org|com)/i, 3],
  [/(?:reuters|apnews|bbc|economist|ft|wsj|bloomberg)\.com/i, 2],
  [/(?:wikipedia|github|stackoverflow)\.(?:org|com)/i, 1],
  [/(?:medium|substack|reddit|twitter|x)\.com/i, -1],
];

// ─── Tool schema ──────────────────────────────────────────────────────────────

export const DEEP_RESEARCH_TOOLS: Tool[] = [
  {
    name: "deep_research",
    description:
      "End-to-end deep research with reflection loop — decomposes the question, " +
      "searches the web in parallel, scrapes & ranks sources, drafts a report, " +
      "self-critiques to find gaps, searches once more for the gaps, then writes " +
      "a final structured Markdown report with inline [N] citations and follow-up " +
      "questions. Auto-saves to vault as type:research. Requires FIRECRAWL_API_KEY. " +
      "Use for: market analysis, competitor research, technical investigation, " +
      "news synthesis, due diligence. Cost per run: 3-5 LLM calls + 6-15 web " +
      "searches + 10-20 page scrapes. Takes 60-180s depending on depth.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Research question. Be specific: 'state of Base chain TVL Q2 2026' beats 'Base chain'.",
        },
        depth: {
          type: "string",
          enum: ["fast", "standard", "deep"],
          description: "fast=3 sub-Qs, ~10 sources, no reflection (~45s). standard=5 sub-Qs, ~14 sources, 1 reflection round (~90s). deep=7 sub-Qs, ~20 sources, 1 reflection round (~150s). Default standard.",
        },
        focus: {
          type: "string",
          description: "Optional angle hint — 'technical', 'investment', 'news', 'comparison'. Steers planning.",
        },
        saveToVault: { type: "boolean", description: "Auto-save report to vault (default true)" },
      },
      required: ["query"],
    },
  },
];

const InputSchema = z.object({
  query: z.string().min(3).max(500),
  depth: z.enum(["fast", "standard", "deep"]).optional(),
  focus: z.string().max(80).optional(),
  saveToVault: z.boolean().optional(),
});

interface Source {
  n: number;
  url: string;
  domain: string;
  title: string;
  excerpt: string;
  score: number;
  publishedAt?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeParseJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch {}
  const stripped = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  try { return JSON.parse(stripped) as T; } catch {}
  const arrMatch = stripped.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]) as T; } catch {} }
  const objMatch = stripped.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]) as T; } catch {} }
  return fallback;
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "unknown"; }
}

function tierBonus(url: string): number {
  for (const [re, bonus] of DOMAIN_TIER_BONUS) if (re.test(url)) return bonus;
  return 0;
}

// Split markdown into ~600-char chunks at paragraph boundaries.
function chunkMarkdown(md: string, chunkSize = EXCERPT_CHARS_PER_CHUNK): string[] {
  const paragraphs = md.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current.length + p.length + 2 <= chunkSize) {
      current = current ? `${current}\n\n${p}` : p;
    } else {
      if (current) chunks.push(current);
      current = p.slice(0, chunkSize * 2); // very long single paragraph → cap
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Score a chunk against the query using term overlap. Cheap, no LLM call.
function chunkRelevance(chunk: string, queryTerms: string[]): number {
  const lower = chunk.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    const occurrences = lower.split(term).length - 1;
    score += Math.min(occurrences, 5); // cap each term so a spammy page can't win
  }
  return score;
}

function pickBestExcerpt(md: string, queryTerms: string[]): string {
  const chunks = chunkMarkdown(md);
  if (chunks.length === 0) return md.slice(0, 1500);
  const scored = chunks.map((c, i) => ({ c, i, score: chunkRelevance(c, queryTerms) }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, EXCERPT_TOP_CHUNKS).sort((a, b) => a.i - b.i);
  return top.map((t) => t.c).join("\n\n---\n\n");
}

function extractQueryTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    )
  ).slice(0, 10);
}

const STOPWORDS = new Set([
  "the","and","for","with","that","this","what","when","where","how","why",
  "have","has","had","are","was","were","will","would","could","should","does",
  "did","being","been","from","into","over","under","about","into","than","then",
  "your","yours","their","they","them","there","here","just","also","more","most",
]);

// ─── Firecrawl ────────────────────────────────────────────────────────────────

async function fcSearch(query: string, limit: number): Promise<Array<{ url: string; title: string; description?: string }>> {
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

async function fcScrape(url: string): Promise<{ markdown: string; publishedAt?: string } | null> {
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
    const data = (await res.json()) as { data?: { markdown?: string; metadata?: { publishedAt?: string; ogPublishedTime?: string; "article:published_time"?: string } } };
    const md = data.data?.markdown;
    if (!md) return null;
    const meta = data.data?.metadata;
    const publishedAt = meta?.publishedAt ?? meta?.ogPublishedTime ?? meta?.["article:published_time"];
    return { markdown: md, publishedAt };
  } catch {
    return null;
  }
}

// ─── LLM stages ───────────────────────────────────────────────────────────────

async function planQueries(query: string, n: number, focus?: string): Promise<string[]> {
  const focusNote = focus ? ` Focus angle: ${focus}.` : "";
  const sys = "You are a research planner. Output strict JSON only — no preamble, no markdown.";
  const user = `Decompose this research question into ${n} sub-questions that together cover the topic from different angles.${focusNote}

Rules:
- Each sub-question must be a standalone web search query, under 90 chars.
- Cover different facets: definition, current state, key actors, comparisons, counterarguments, recent news, forward outlook.
- No duplicates, no near-paraphrases.
- Prefer concrete proper nouns and dates when relevant.

Question: "${query}"

Return: {"queries": ["...", "..."]} — exactly ${n} items.`;

  let raw = "";
  try { raw = await callLLM(sys, user, 500, [], 30_000); } catch { return [query]; }

  const parsed = safeParseJson<{ queries?: unknown }>(raw, {});
  if (!parsed.queries || !Array.isArray(parsed.queries)) return [query];
  const queries = parsed.queries
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 200)
    .slice(0, n);
  return queries.length > 0 ? queries : [query];
}

async function reflectAndExtend(query: string, draft: string, existingQueries: string[], n: number): Promise<string[]> {
  const sys = "You are a research auditor. Find gaps in a draft report and propose follow-up search queries. Output strict JSON.";
  const user = `Original question: "${query}"

Queries already run:
${existingQueries.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Draft report:
"""
${draft.slice(0, 4000)}
"""

Identify ${n} GAPS in the draft — angles missing, claims that need verification, counter-perspectives not represented, or recent developments not covered. For each gap, give ONE web search query (≤90 chars) that would fill it.

Return: {"gap_queries": ["...", "..."]} — exactly ${n} items, no duplicates of existing queries.`;

  let raw = "";
  try { raw = await callLLM(sys, user, 500, [], 30_000); } catch { return []; }

  const parsed = safeParseJson<{ gap_queries?: unknown }>(raw, {});
  if (!parsed.gap_queries || !Array.isArray(parsed.gap_queries)) return [];
  return parsed.gap_queries
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 200)
    .slice(0, n);
}

async function synthesize(query: string, sources: Source[], isFinal: boolean): Promise<string> {
  const sourceBlocks = sources
    .map((s) => {
      const dateNote = s.publishedAt ? ` (published ${s.publishedAt.slice(0, 10)})` : "";
      return `[${s.n}] ${s.title} — ${s.domain}${dateNote}\nURL: ${s.url}\n\n${s.excerpt}`;
    })
    .join("\n\n---\n\n");

  const finalSections = isFinal
    ? `## TL;DR
2-3 sentences answering the question directly. No hedging unless evidence demands it.

## Key Findings
- 6-10 substantive bullets, each citing source numbers like [1] or [2,4]
- Mix angles — definition, current state, comparisons, criticisms
- Tag each bullet with a confidence level at the end: \`(high)\` / \`(medium)\` / \`(low)\`
- "high" means primary sources or strong consensus; "low" means single source or contested

## Analysis
3-5 paragraphs synthesizing the sources. Connect findings, note tensions and gaps, distinguish correlation from causation. Use inline citations throughout.

## Counterevidence & Limitations
- 2-4 bullets listing what could change the conclusion: weak sources, missing data, conflicting findings, age of evidence
- This section is required — never skip it

## Follow-up Questions
- 3-5 questions a curious reader would ask after reading this report
- Make them concrete and answerable, not philosophical`
    : `## Draft Summary
Single paragraph synthesis covering the main findings from sources, with inline citations.`;

  const sys = `You are a senior analyst writing a structured research report from numbered web sources.

OUTPUT FORMAT (strict — exact Markdown sections, in this order):

# {short concrete title — max 10 words}

${finalSections}

CITATION RULES:
- Cite using [N] inline, matching source numbers exactly
- Cite at least once per non-trivial claim
- Distinguish primary evidence (data, official statements, .gov/.edu) from secondary commentary
- Flag any claim from a single source as "(single source [N])"
- Note source dates when relevant — older sources may be stale

STYLE RULES:
- Be specific: numbers, names, dates over vague claims
- No filler ("it is important to note", "in conclusion", "in today's world", "navigate the landscape")
- No hedging when evidence is strong; no false confidence when it's weak
- Don't write a Sources section — that gets appended automatically`;

  const user = `RESEARCH QUESTION: ${query}

SOURCES:
${sourceBlocks}

Write the ${isFinal ? "final" : "draft"} report now. Markdown only — no preamble, no postamble.`;

  return await callLLM(sys, user, isFinal ? 4000 : 2000, [], 90_000);
}

// ─── Source ranking ───────────────────────────────────────────────────────────

function rankAndDedupe(
  candidates: Array<{ url: string; title: string; desc: string; queryRank: number }>,
): Array<{ url: string; title: string; desc: string }> {
  // Score: search-rank inverse + domain tier bonus. Lower queryRank = higher.
  const scored = candidates.map((c) => ({
    ...c,
    score: -c.queryRank + tierBonus(c.url),
    domain: domainOf(c.url),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Domain diversity — cap MAX_PER_DOMAIN sources from same domain
  const seenDomain = new Map<string, number>();
  const seenUrl = new Set<string>();
  const result: typeof candidates = [];
  for (const c of scored) {
    if (seenUrl.has(c.url)) continue;
    const count = seenDomain.get(c.domain) ?? 0;
    if (count >= MAX_PER_DOMAIN) continue;
    seenUrl.add(c.url);
    seenDomain.set(c.domain, count + 1);
    result.push(c);
  }
  return result;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleDeepResearch(name: string, args: unknown): Promise<ToolResult | null> {
  if (name !== "deep_research") return null;

  const parsed = InputSchema.safeParse(args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
  }

  const { query, focus } = parsed.data;
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

  // Depth knobs
  const subN        = depth === "fast" ? 3 : depth === "deep" ? 7 : 5;
  const searchLimit = depth === "fast" ? 4 : depth === "deep" ? 6 : 5;
  const maxScrape   = depth === "fast" ? 10 : depth === "deep" ? 22 : 16;
  const maxSources  = depth === "fast" ? 10 : depth === "deep" ? 20 : 14;
  const useReflection = depth !== "fast";

  const queryTerms = extractQueryTerms(query);
  const progress: string[] = [];
  const log = (line: string) => progress.push(line);

  // ── Stage 1: plan ──
  log(`🧭 Planning ${subN} sub-questions...`);
  const subQs = await planQueries(query, subN, focus);

  // ── Stage 2: parallel search ──
  log(`🔎 Searching ${subQs.length} queries × ${searchLimit} results each...`);
  const searchResults = await Promise.all(subQs.map((q) => fcSearch(q, searchLimit)));

  // Flatten with rank info
  const allCandidates: Array<{ url: string; title: string; desc: string; queryRank: number }> = [];
  for (const results of searchResults) {
    results.forEach((r, idx) => {
      if (r.url) allCandidates.push({ url: r.url, title: r.title ?? r.url, desc: r.description ?? "", queryRank: idx });
    });
  }

  if (allCandidates.length === 0) {
    return { content: [{ type: "text", text: `No sources found for: "${query}". Try a more specific query or a different focus angle.` }], isError: true };
  }

  const ranked = rankAndDedupe(allCandidates).slice(0, maxScrape);
  log(`📊 Ranked ${allCandidates.length} candidates → ${ranked.length} after domain dedup (max ${MAX_PER_DOMAIN}/domain).`);

  // ── Stage 3: parallel scrape ──
  log(`📥 Scraping ${ranked.length} sources in parallel...`);
  const scraped = await Promise.all(
    ranked.map(async (c) => {
      const r = await fcScrape(c.url);
      if (!r) return null;
      const excerpt = pickBestExcerpt(r.markdown, queryTerms);
      if (excerpt.length < 150) return null;
      return {
        url: c.url,
        domain: domainOf(c.url),
        title: c.title,
        excerpt,
        publishedAt: r.publishedAt,
        score: tierBonus(c.url),
      };
    }),
  );

  let sources: Source[] = scraped
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .slice(0, maxSources)
    .map((s, i) => ({ n: i + 1, ...s }));

  if (sources.length === 0) {
    return { content: [{ type: "text", text: `Could not scrape any usable sources for: "${query}". Sites may be blocking or paywalled.` }], isError: true };
  }

  // ── Stage 4: draft synthesis (only if reflection enabled) ──
  let draft = "";
  if (useReflection) {
    log(`✍️  Drafting initial report (will reflect & refine)...`);
    try {
      draft = await synthesize(query, sources, false);
    } catch {
      // If draft fails, fall through to final synth with what we have
      draft = "";
    }
  }

  // ── Stage 5: reflection — find gaps, search again ──
  if (useReflection && draft) {
    log(`🤔 Auditing draft for gaps...`);
    const gapQs = await reflectAndExtend(query, draft, subQs, depth === "deep" ? 3 : 2);
    if (gapQs.length > 0) {
      log(`🔁 Running ${gapQs.length} gap-search(es)...`);
      const gapResults = await Promise.all(gapQs.map((q) => fcSearch(q, 3)));
      const gapCandidates: Array<{ url: string; title: string; desc: string; queryRank: number }> = [];
      const existingUrls = new Set(sources.map((s) => s.url));
      for (const results of gapResults) {
        results.forEach((r, idx) => {
          if (r.url && !existingUrls.has(r.url)) {
            gapCandidates.push({ url: r.url, title: r.title ?? r.url, desc: r.description ?? "", queryRank: idx });
          }
        });
      }
      const gapRanked = rankAndDedupe(gapCandidates).slice(0, gapQs.length * 2);
      const gapScraped = await Promise.all(
        gapRanked.map(async (c) => {
          const r = await fcScrape(c.url);
          if (!r || r.markdown.length < 200) return null;
          return {
            url: c.url,
            domain: domainOf(c.url),
            title: c.title,
            excerpt: pickBestExcerpt(r.markdown, queryTerms),
            publishedAt: r.publishedAt,
            score: tierBonus(c.url),
          };
        }),
      );
      const newSources = gapScraped.filter((s): s is NonNullable<typeof s> => s !== null);
      const startN = sources.length;
      const appended = newSources.map((s, i) => ({ n: startN + i + 1, ...s }));
      sources = [...sources, ...appended].slice(0, maxSources + 4);
      log(`✅ Added ${appended.length} gap-fill source(s).`);
    } else {
      log(`✅ No gaps found — draft is complete.`);
    }
  }

  // ── Stage 6: final synthesis ──
  log(`📝 Writing final report from ${sources.length} sources...`);
  let report: string;
  try {
    report = await synthesize(query, sources, true);
  } catch (err: any) {
    return { content: [{ type: "text", text: `Synthesis failed: ${err.message ?? err}` }], isError: true };
  }

  // Append sources list with snippets
  const sourcesSection = sources
    .map((s) => {
      const date = s.publishedAt ? ` (${s.publishedAt.slice(0, 10)})` : "";
      const tier = s.score > 0 ? " · primary" : s.score < 0 ? " · informal" : "";
      return `[${s.n}] **${s.title}** — ${s.domain}${date}${tier}\n   ${s.url}`;
    })
    .join("\n\n");
  const fullReport = `${report.trim()}\n\n## Sources\n\n${sourcesSection}`;

  // ── Stage 7: vault save ──
  let vaultKey: string | null = null;
  if (saveToVault) {
    try {
      const r = (await callConvex("/vault/save", "POST", {
        type: "research",
        title: `Deep Research: ${query.slice(0, 80)}`,
        content: fullReport,
        tags: ["deep-research", depth, ...(focus ? [focus] : [])],
        agentId: "research",
        commitMsg: "deep_research run",
      }, "vault_save")) as { key?: string } | null;
      vaultKey = r?.key ?? null;
    } catch { /* keep going — return report inline */ }
  }

  const header = [
    `🔬 **Deep Research v2** — depth: ${depth} · ${subQs.length} planned + ${useReflection ? "reflection" : "no reflection"} · ${sources.length} sources`,
    vaultKey ? `📁 Saved to vault: \`${vaultKey}\`` : (saveToVault ? `⚠️ Vault save skipped (not authenticated — sign in with \`noelclaw login\`)` : ""),
    ``,
    `<details><summary>📋 Process log</summary>`,
    ``,
    progress.map((p) => `- ${p}`).join("\n"),
    ``,
    `</details>`,
    ``,
  ].filter(Boolean).join("\n");

  return { content: [{ type: "text", text: `${header}\n${fullReport}` }] };
}
