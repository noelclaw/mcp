import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";
import { callLLM, isGrokActive, type LiveSearchOptions, type LiveSearchSource } from "../llm.js";
import { callConvex } from "../convex.js";
import { checkSignal } from "../signal-gate.js";
import { enrichQuery, todayContext } from "../enrichment-router.js";
import { searchSupermemory } from "./memory.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const FC_BASE = "https://api.firecrawl.dev/v1";
const MAX_PER_DOMAIN = 2;          // source diversity - cap hits per domain
const EXCERPT_CHARS_PER_CHUNK = 600;
const EXCERPT_TOP_CHUNKS = 4;       // pick top N relevant chunks per source

// Quality scoring - higher = more trustworthy primary source
const DOMAIN_TIER_BONUS: Array<[RegExp, number]> = [
  [/\.gov(\b|\/|$)/i, 4],
  [/\.edu(\b|\/|$)/i, 3],
  [/(?:nature|science|nih|arxiv|acm|ieee|sciencedirect)\.(?:org|com)/i, 3],
  // Crypto primary-source boost - these are the authoritative data sources
  // for protocol TVL, yields, prices, and on-chain analytics. Rank above
  // generic news for crypto queries.
  [/(?:defillama|tokenterminal|coingecko|coinmarketcap|dune|messari|artemis)\.(?:com|fi)/i, 3],
  [/(?:etherscan|basescan|arbiscan|solscan|polygonscan|optimistic\.etherscan)\.(?:io|com)/i, 2],
  [/(?:reuters|apnews|bbc|economist|ft|wsj|bloomberg)\.com/i, 2],
  [/(?:coindesk|theblock|cointelegraph|decrypt|theinformation)\.(?:co|com|io)/i, 1],
  [/(?:wikipedia|github|stackoverflow)\.(?:org|com)/i, 1],
  [/(?:medium|substack|reddit|twitter|x)\.com/i, -1],
];

// News-domain bonus - applied additionally in fresh mode
const NEWS_DOMAIN_BOOST_RE = /(?:reuters|apnews|bbc|economist|ft|wsj|bloomberg|cnbc|theverge|techcrunch|axios|coindesk|theinformation|nytimes|guardian|aljazeera)\.com/i;

// Keywords that signal a time-sensitive query - trigger fresh mode auto.
const FRESH_TRIGGER_RE = /\b(today|tonight|tomorrow|yesterday|this week|last week|past week|latest|breaking|just now|recent|currently|now|live|happening|this month|last month|past month|past \d+ days?|last \d+ days?|q[1-4]|h[12]|202[6-9])\b/i;

// ─── Tool schema ──────────────────────────────────────────────────────────────

export const DEEP_RESEARCH_TOOLS: Tool[] = [
  {
    name: "deep_research",
    description:
      "Multi-agent research: decomposes the topic into specialist angles, runs each as its own search-and-synth lane, then a synthesizer consolidates everything into one structured report with inline [N] citations. " +
      "Depths: fast (~45s) · standard (~90s) · deep (~180s, adds adversarial critic). " +
      "Profile-aware, auto-saves to vault, auto-links to related past reports. " +
      "When Grok is active, Live Search pulls real-time X/news/web.",
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
          description: "fast=flat planner, 3 sub-Qs, ~10 sources (~45s). standard=3 specialist angles, ~14 sources, reflection round (~90s). deep=5 angles + adversarial critic + reflection, ~20 sources (~180s). Default standard.",
        },
        focus: {
          type: "string",
          description: "Optional angle hint - 'technical', 'investment', 'news', 'comparison'. Steers planning.",
        },
        continueFrom: {
          type: "string",
          description: "Vault key of a previous deep_research report to build on. When provided, the planner focuses on UPDATES, GAPS, and NEW developments since that report - not re-treading covered ground. The new report explicitly references and extends the prior findings. Format: 'research/...' (use vault_list type:research to find candidates). This is the multi-session research feature - Perplexity / ChatGPT Deep Research don't have an equivalent.",
        },
        freshMode: {
          type: "boolean",
          description: "Force time-sensitive research mode: planner appends recency hints to sub-queries, source ranking boosts news domains (Reuters, AP, Bloomberg, etc.), and the synthesizer is told to prioritize current/recent claims. Auto-enabled when the query contains time-sensitive keywords (today, latest, breaking, this week, etc.).",
        },
        freshDays: {
          type: "number",
          description: "When freshMode is on, restrict to results from the last N days. Default 14 days. Capped at 90.",
        },
        liveSearch: {
          type: "boolean",
          description: "Enable Grok Live Search - pulls real-time results from X (Twitter), news, web, RSS during synthesis. Only works when Grok is the active LLM provider. Adds ~5-15s per Grok call. Default: auto (on when Grok is active).",
        },
        liveSearchSources: {
          type: "array",
          items: { type: "string", enum: ["web", "x", "news", "rss"] },
          description: "Which Live Search sources to pull from. Default: ['web', 'x', 'news']. Only respected when liveSearch is true and Grok is active.",
        },
        liveSearchDays: {
          type: "number",
          description: "Restrict Live Search to results from the last N days (max 365). Useful for time-sensitive queries. Default: no date filter.",
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
  continueFrom: z.string().max(200).optional(),
  freshMode: z.boolean().optional(),
  freshDays: z.number().int().min(1).max(90).optional(),
  liveSearch: z.boolean().optional(),
  liveSearchSources: z.array(z.enum(["web", "x", "news", "rss"])).optional(),
  liveSearchDays: z.number().int().min(1).max(365).optional(),
  saveToVault: z.boolean().optional(),
});

type SourceClass = "primary" | "expert" | "secondary" | "market" | "unclassified";

function classifySource(score: number): SourceClass {
  if (score >= 3) return "primary";
  if (score === 2) return "expert";
  if (score === 1) return "secondary";
  if (score < 0) return "market";
  return "unclassified";
}

interface Source {
  n: number;
  url: string;
  domain: string;
  title: string;
  excerpt: string;
  score: number;
  class: SourceClass;
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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentYearMonth(): string {
  const now = new Date();
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${months[now.getMonth()]} ${now.getFullYear()}`;
}

// ─── Firecrawl ────────────────────────────────────────────────────────────────

async function fcSearch(query: string, limit: number): Promise<Array<{ url: string; title: string; description?: string }>> {
  // BYOK path - direct call to Firecrawl with user's key. Fastest, no proxy hop.
  const key = process.env.FIRECRAWL_API_KEY;
  if (key) {
    try {
      const res = await fetch(`${FC_BASE}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query, limit }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ url: string; title: string; description?: string }> };
        return data.data ?? [];
      }
    } catch { /* fall through */ }
  }

  // Backend-proxy path - session-authed; Noelclaw covers Firecrawl cost.
  try {
    const data = await callConvex(
      "/research/firecrawl-search",
      "POST",
      { query, limit },
      "deep_research_search_proxy",
      20_000,
    ) as { results?: Array<{ url: string; title: string; description?: string }> } | null;
    return data?.results ?? [];
  } catch {
    return [];
  }
}

async function fcScrape(url: string): Promise<{ markdown: string; publishedAt?: string } | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (key) {
    try {
      const res = await fetch(`${FC_BASE}/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: { markdown?: string; metadata?: { publishedAt?: string; ogPublishedTime?: string; "article:published_time"?: string } } };
        const md = data.data?.markdown;
        if (md) {
          const meta = data.data?.metadata;
          const publishedAt = meta?.publishedAt ?? meta?.ogPublishedTime ?? meta?.["article:published_time"];
          return { markdown: md, publishedAt };
        }
      }
    } catch { /* fall through */ }
  }

  // Backend-proxy path. Returns markdown only - no metadata extraction yet,
  // which means continueFrom can't auto-date proxied scrapes. Acceptable
  // tradeoff for now; markdown is the primary signal.
  try {
    const data = await callConvex(
      "/research/firecrawl-scrape",
      "POST",
      { url },
      "deep_research_scrape_proxy",
      25_000,
    ) as { markdown?: string } | null;
    if (data?.markdown) return { markdown: data.markdown };
  } catch { /* swallow */ }
  return null;
}

// ─── LLM stages ───────────────────────────────────────────────────────────────

async function planQueries(query: string, n: number, focus?: string, priorContext?: string, freshMode?: { days: number }): Promise<string[]> {
  const focusNote = focus ? ` Focus angle: ${focus}.` : "";
  const sys = "You are a research planner. Output strict JSON only - no preamble, no markdown.";

  const freshNote = freshMode
    ? `

⏱ FRESH MODE - last ${freshMode.days} days:
- Add a recency hint to most sub-questions: "in ${currentYearMonth()}", "last ${freshMode.days} days", "this week", "as of ${todayISO()}", etc.
- Prefer queries that surface news / press releases / X posts over evergreen background.
- Skip generic background - the user wants what's CURRENT, not historical.
- At least 70% of sub-questions must include a date or recency token.`
    : "";

  const continuationNote = priorContext
    ? `

⚠️ CONTINUATION MODE - there is a PRIOR research report on this topic:

"""
${priorContext.slice(0, 2500)}
"""

Your sub-questions must focus on:
1. UPDATES - what has changed since the prior report (new releases, news, data revisions)
2. GAPS - angles the prior report explicitly listed as open questions or follow-ups
3. NEW developments - entities/events the prior report doesn't mention
4. VERIFICATION - claims the prior report flagged as low-confidence or single-source

DO NOT re-tread material already well-covered in the prior report. The user already has those answers.`
    : "";

  const user = `Decompose this research question into ${n} sub-questions that together cover the topic from different angles.${focusNote}${continuationNote}${freshNote}

Rules:
- Each sub-question must be a standalone web search query, under 90 chars.
- Cover different facets: definition, current state, key actors, comparisons, counterarguments, recent news, forward outlook.
- No duplicates, no near-paraphrases.

ENTITY-HUNTING - at least HALF of your sub-questions must target queries likely to surface:
- Specific company / product / framework names (e.g., "LangGraph adoption stats", "Manus orchestration funding")
- Dollar amounts (acquisitions, funding rounds, revenue, ARR, market size)
- Benchmark numbers (% adoption, latency ms, accuracy scores, MMLU/HumanEval/SWE-bench results)
- Specific dates and timeline events (when X launched, when Y reached scale)
- Named studies / surveys / reports (e.g., "Anthropic Economic Index 2026", "a16z AI infrastructure report")

Bad: "what is X" → too generic, returns Wikipedia
Good: "X adoption rate enterprise 2026 survey" → returns concrete stats

Question: "${query}"

Return: {"queries": ["...", "..."]} - exactly ${n} items.`;

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

// ─── Multi-agent angle decomposition ─────────────────────────────────────────
// Replaces flat sub-query planning for standard/deep depths. Each angle is a
// labeled facet of the topic - what would be a "specialist agent's territory"
// in a swarm. The synthesizer consumes findings ORGANIZED by angle, so the
// final report has structural diversity (not all sources blended together).
//
// Effect at runtime: same number of LLM calls as the flat path (one planner
// + one synthesizer), but angle structure flows through every stage. In
// deep mode, an extra critic call audits findings before final synthesis.

export type ResearchAngle = {
  label: string;            // "on-chain data + TVL flows"
  rationale: string;        // why this angle matters for the topic
  queries: string[];        // 2-3 web search queries for this angle
};

async function planAngles(
  query: string,
  n: number,
  focus?: string,
  priorContext?: string,
  freshMode?: { days: number },
): Promise<ResearchAngle[]> {
  const focusNote = focus ? ` Focus angle: ${focus}.` : "";

  const freshNote = freshMode
    ? `\n\n⏱ FRESH MODE - last ${freshMode.days} days: bias each angle's queries toward news/recent press/dated reports.`
    : "";

  const continuationNote = priorContext
    ? `\n\n⚠️ CONTINUATION - prior report exists. Angles must focus on UPDATES, GAPS, NEW developments since:\n"""\n${priorContext.slice(0, 1500)}\n"""`
    : "";

  const sys = "You are a research planner that decomposes topics into specialist angles. Output strict JSON only.";

  const user = `Break this research topic into ${n} DIFFERENT specialist angles. Each angle gets its own 2-3 search queries.${focusNote}${continuationNote}${freshNote}

Topic: "${query}"

Pick angles that are GENUINELY different - not paraphrases of the same question. Good angle diversity examples:
- data / quantitative metrics
- competitive landscape
- team / governance / actors
- recent news / catalysts
- counterarguments / risks / criticism
- forward outlook / projections
- historical context / origins
- regulatory / policy angle
- technical / mechanism
- ecosystem partners

Pick the ${n} angles that most fit THIS specific topic. Each angle should have a label (3-6 words) and rationale (1 sentence). Queries must be standalone, ≤90 chars, entity-rich (specific names, dollar amounts, dates, benchmark numbers - NOT generic background).

Return strict JSON:
{
  "angles": [
    {
      "label": "...",
      "rationale": "...",
      "queries": ["...", "..."]
    }
  ]
}

Exactly ${n} angles. 2-3 queries per angle. No duplicate queries across angles.`;

  let raw = "";
  try { raw = await callLLM(sys, user, 1200, [], 30_000); } catch { return []; }

  const parsed = safeParseJson<{ angles?: unknown }>(raw, {});
  if (!parsed.angles || !Array.isArray(parsed.angles)) return [];

  const angles: ResearchAngle[] = [];
  for (const a of parsed.angles) {
    if (typeof a !== "object" || a === null) continue;
    const o = a as any;
    if (typeof o.label !== "string" || typeof o.rationale !== "string") continue;
    if (!Array.isArray(o.queries)) continue;
    const queries = (o.queries as unknown[])
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.trim())
      .filter((q) => q.length > 0 && q.length <= 200)
      .slice(0, 3);
    if (queries.length === 0) continue;
    angles.push({
      label: o.label.trim().slice(0, 80),
      rationale: o.rationale.trim().slice(0, 200),
      queries,
    });
    if (angles.length >= n) break;
  }
  return angles;
}

// Adversarial critic - only runs for depth=deep. Reads the draft + sources
// already gathered and produces a structured challenge block: single-source
// claims, contradictions across angles, speculation framed as fact. The
// final synthesizer is told to incorporate or refute these challenges
// explicitly, lifting the quality floor.
async function runCritic(
  query: string,
  draft: string,
  angles: ResearchAngle[],
  sourceCount: number,
): Promise<string> {
  const sys = "You are an adversarial research critic. Be terse, specific, and unsparing. Output markdown.";

  const angleLabels = angles.map((a, i) => `${i + 1}. ${a.label}`).join("\n");

  const user = `Original question: "${query}"

Specialist angles investigated:
${angleLabels}

Total sources gathered: ${sourceCount}

Draft report:
"""
${draft.slice(0, 5000)}
"""

Audit the draft for quality problems. Be specific and quote spans where possible.

Identify:
1. **Single-source claims** - major assertions resting on one [N] citation that aren't widely corroborated
2. **Contradictions** - places where different sources disagree but the draft doesn't surface the disagreement
3. **Speculation framed as fact** - confident statements about future/intent/cause without evidence
4. **Coverage gaps** - angles from the list above that got shallow treatment
5. **Stale or weak sources** - dated material treated as current, blog posts cited as primary data

Output format:
## Critic notes
- **[type]**: specific issue + relevant quote or claim. (1-2 sentences each)
- Skip categories with no findings - don't pad.

End with one line: "Net recommendation: [accept|revise|reject]"

If the draft is solid, say so plainly - don't manufacture issues.`;

  try {
    const notes = await callLLM(sys, user, 1500, [], 60_000);
    return notes.trim();
  } catch {
    return ""; // critic failure shouldn't block final synth
  }
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

Identify ${n} GAPS in the draft - angles missing, claims that need verification, counter-perspectives not represented, or recent developments not covered. For each gap, give ONE web search query (≤90 chars) that would fill it.

Return: {"gap_queries": ["...", "..."]} - exactly ${n} items, no duplicates of existing queries.`;

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

async function synthesize(
  query: string,
  sources: Source[],
  isFinal: boolean,
  liveSearch?: LiveSearchOptions,
  priorContext?: { key: string; content: string },
  freshMode?: boolean,
  angles?: ResearchAngle[],
  criticNotes?: string,
): Promise<{ report: string; liveCitations: string[] }> {
  const sourceBlocks = sources
    .map((s) => {
      const dateNote = s.publishedAt ? ` (published ${s.publishedAt.slice(0, 10)})` : "";
      const classNote = s.class !== "unclassified" ? ` [${s.class}]` : "";
      return `[${s.n}]${classNote} ${s.title} - ${s.domain}${dateNote}\nURL: ${s.url}\n\n${s.excerpt}`;
    })
    .join("\n\n---\n\n");

  // Multi-domain enrichment - auto-detect topic (crypto/tech/academic/general)
  // and pull live primary-source data in parallel. Crypto routes to DefiLlama
  // + CoinGecko; tech to HackerNews + GitHub; academic to arXiv; general to
  // Wikipedia. The combined block prepends to source blocks and is tagged
  // AUTHORITATIVE LIVE DATA so the LLM treats those numbers as ground truth.
  const enrichment = isFinal ? await enrichQuery(query) : { context: "", hasData: false, domains: [] as string[] };

  // Profile + memory auto-injection - only on final synthesis.
  // Profile: persistent identity/business/state from vault.
  // Memory: top relevant memories for this query (personalizes report framing).
  // Both run in parallel; either can fail without blocking synthesis.
  let profileContext = "";
  let memoryContext = "";
  if (isFinal) {
    const [profileData, memHits] = await Promise.allSettled([
      callConvex("/vault/profile-context?maxChars=1200", "GET", undefined, "profile_context"),
      searchSupermemory(query, 4),
    ]);
    if (profileData.status === "fulfilled") {
      profileContext = ((profileData.value as any)?.context ?? "").trim();
    }
    if (memHits.status === "fulfilled" && memHits.value.length > 0) {
      memoryContext = memHits.value
        .map((r) => {
          const title = r.metadata?.title ? `[${r.metadata.title}] ` : "";
          return `- ${title}${r.content.slice(0, 200).replace(/\n/g, " ")}`;
        })
        .join("\n");
    }
  }

  const liveSearchNote = liveSearch
    ? `\n\nIMPORTANT - Real-time augmentation:
You have Live Search enabled. In addition to the numbered sources above, you have access to **real-time results from ${liveSearch.sources.join(", ")}**. Use them to:
1. Verify recent claims (last ${liveSearch.fromDate ? "from " + liveSearch.fromDate : "few weeks"})
2. Add fresh data points the static sources may have missed
3. Surface X (Twitter) posts when the topic is moving quickly
4. Pull current numbers when the static sources are dated

CITATION RULE for Live Search content:
- Numbered sources [N] = static scraped sources at top of prompt
- Real-time content from Live Search: cite inline as **(X post)** or **(news, [outlet])** WITHOUT [N] numbering - they'll be appended to the Sources section automatically
- If a Live Search result contradicts a static source, FLAG it as "(real-time conflicts with [N])"`
    : "";

  const finalSections = isFinal
    ? `## TL;DR
2-3 sentences answering the question directly. No hedging unless evidence demands it.

## At a Glance
A Markdown table summarizing 4-8 key metrics, dimensions, or status indicators from the sources. Format:
| Dimension | Value / Status | Source |
|---|---|---|
| (example) Production adoption | 57% have agents in production | [3] |

Use tables whenever you have:
- Comparison data (X vs Y vs Z)
- Status snapshots (multiple metrics at one point in time)
- Rankings or scorecards
- Dollar amounts, percentages, dates side-by-side

This section is REQUIRED whenever the sources contain quantitative data. Skip ONLY if the topic is purely qualitative.

## Key Findings
- 6-10 substantive bullets, each citing source numbers like [1] or [2,4]
- Lead with specific named entities, dollar amounts, percentages, dates - not generalities
- Mix angles - definition, current state, comparisons, criticisms
- Tag each bullet with a confidence level at the end: \`(high)\` / \`(medium)\` / \`(low)\`
- "high" means primary sources or strong consensus; "low" means single source or contested

## Analysis
3-5 paragraphs synthesizing the sources. Connect findings, note tensions and gaps, distinguish correlation from causation. Use inline citations throughout - every numerical claim or named entity must carry a [N].

## Counterevidence & Limitations
- 2-4 bullets listing what could change the conclusion: weak sources, missing data, conflicting findings, age of evidence
- This section is required - never skip it

## Follow-up Questions
- 3-5 questions a curious reader would ask after reading this report
- Make them concrete and answerable, not philosophical`
    : `## Draft Summary
Single paragraph synthesis covering the main findings from sources, with inline citations.`;

  const profileBlock = profileContext
    ? `\n\n<user_profile>\n${profileContext}\n</user_profile>\n`
    : "";

  const memoryBlock = memoryContext
    ? `\n\n<user_memory>\nStored knowledge about this user — use to frame the report toward their known interests, not to fabricate facts:\n${memoryContext}\n</user_memory>\n`
    : "";

  const sys = `You are a senior analyst writing a structured research report from numbered web sources.

${todayContext()}${profileBlock}${memoryBlock}

OUTPUT FORMAT (strict - exact Markdown sections, in this order):

# {short concrete title - max 10 words}

${finalSections}

SOURCE CLASS TAGGING (mandatory in Key Findings):
Each source in the list above is labeled [primary] / [expert] / [secondary] / [market].
- [primary]: official docs, .gov/.edu, protocol data (DefiLlama, CoinGecko, etherscan), peer-reviewed
- [expert]: named researchers, audit reports, tier-1 financial press (Reuters, FT, Bloomberg)
- [secondary]: crypto media, newsletters, Wikipedia, GitHub
- [market]: X/Twitter, Reddit, Substack, prediction markets - sentiment, not fact

TAG RULES:
- Every Key Findings bullet must end with the source class of its strongest citation, e.g. "[primary]" or "[market]"
- Example: "Aerodrome TVL reached $2.1B in June 2026 [3] [primary]"
- If a bullet's evidence mixes classes, use the LOWEST class: one Reddit citation drags the whole bullet to "[market]"

CONTRADICTION RULES (mandatory):
- When two sources disagree on a fact, do NOT average them. Surface the conflict explicitly:
  "Source [N] says X; source [M] says not-X - reconciliation: ..."
- Put irreconcilable contradictions in Counterevidence & Limitations, not Key Findings
- A single uncontested source is flagged: "(single source [N])"

CITATION DENSITY RULES:
- Every numerical claim (percentage, dollar amount, count, date) MUST carry [N]
- Every named entity (company, product, framework, person) MUST carry [N] on first mention
- Target: at least 1 citation per 50 words in Key Findings and Analysis
- Note source dates when relevant - older sources may be stale

STYLE RULES:
- Be specific: numbers, names, dates over vague claims
- Lead with concrete entities, not abstract concepts
- Tables > bullets when comparing dimensions
- No filler ("it is important to note", "in conclusion", "in today's world", "navigate the landscape")
- No hedging when evidence is strong; no false confidence when it's weak
- Don't write a Sources section - that gets appended automatically`;

  const freshBlock = freshMode && isFinal
    ? `

⏱ FRESH MODE active - today is ${todayISO()}:
- Prioritize claims dated within the last 30 days. If a source is older, only cite it if it's primary evidence (data, official statement).
- In the At a Glance table, include a "Date" column showing the publish date for each metric.
- In Key Findings, prefix each bullet with the source's publish date in brackets: [2026-MM-DD] Finding text [N].
- In Counterevidence, flag any claim whose evidence is older than 60 days as "(potentially stale).".`
    : "";

  const continuationBlock = priorContext && isFinal
    ? `

PRIOR REPORT (you are CONTINUING this research, not starting fresh):

\`\`\`
${priorContext.content.slice(0, 3500)}
\`\`\`

CONTINUATION RULES:
- Start the TL;DR with: "Update to prior report \`${priorContext.key}\` -" followed by the new takeaway.
- The "At a Glance" table must include a column "Δ since prior" showing what changed.
- Key Findings must mark each bullet with: \`(NEW)\` for genuinely new info, \`(UPDATED)\` for changed numbers/positions, or \`(CONFIRMED)\` for points the new sources reinforce.
- Counterevidence section must explicitly say which prior claims are now weaker.
- Follow-up Questions must build on the prior report's open questions if they're still relevant.

Do not re-explain background already in the prior report. Assume the reader read it.`
    : "";

  const enrichmentBlock = enrichment.hasData
    ? `\n\n${enrichment.context}\n\n`
    : "";

  // Specialist angles - when present, tell the synthesizer to mirror this
  // structure in the report (Key Findings organized by angle, At a Glance
  // table dimensions match the angles). Without this, the model blends
  // every angle into a homogeneous narrative.
  const anglesBlock = isFinal && angles && angles.length > 0
    ? `\n\nSPECIALIST ANGLES INVESTIGATED:
${angles.map((a, i) => `${i + 1}. **${a.label}** - ${a.rationale}`).join("\n")}

Mirror this structure: Key Findings should group bullets by angle (use the angle label as a sub-header), and the At a Glance table dimensions should match the angles.`
    : "";

  // Critic notes (deep mode only) - explicit weaknesses surfaced during
  // the audit pass. The synthesizer must address each one rather than
  // simply ignoring it. This is the strongest single quality lever.
  const criticBlock = isFinal && criticNotes && criticNotes.length > 50
    ? `\n\nCRITIC AUDIT - concrete weaknesses found in the draft. You MUST address each one in the final report (either by revising the claim, surfacing the uncertainty, or providing additional support):

${criticNotes}

If a critic concern can't be resolved with the sources you have, surface it in Counterevidence & Limitations rather than burying it.`
    : "";

  const user = `RESEARCH QUESTION: ${query}
${enrichmentBlock}
SOURCES:
${sourceBlocks}${liveSearchNote}${continuationBlock}${freshBlock}${anglesBlock}${criticBlock}

Write the ${isFinal ? "final" : "draft"} report now. Markdown only - no preamble, no postamble.${
    enrichment.hasData
      ? `\n\nIMPORTANT: The AUTHORITATIVE LIVE DATA block at the top contains current numbers from primary APIs (DefiLlama, CoinGecko). Lead with these numbers when they exist - they override any conflicting figures in the scraped sources below. Cite them as [DefiLlama] or [CoinGecko].`
      : ""
  }`;

  // Research synthesis uses NOELCLAW_RESEARCH_MODEL when set. Default is
  // `grok-4.3` - when Bankr is the active gateway this routes to Grok 4.3
  // through Bankr (Grok handles fresh data better; Claude is the safer
  // pick for reasoning, JSON, code). Override via env or pass the same
  // model string to NOELCLAW_MODEL to bypass.
  const researchModel = process.env.NOELCLAW_RESEARCH_MODEL ?? "grok-4.3";
  const raw = await callLLM(sys, user, isFinal ? 4000 : 2000, [], 90_000, { liveSearch, model: researchModel });
  const { content: report, liveCitations } = extractLiveCitations(raw);

  // Citation density check - only for final reports. If the report has many
  // numerical claims but very few [N] citations, retry once with a stricter
  // instruction. Cheap insurance against lazy synthesis.
  if (!isFinal) return { report, liveCitations };

  const density = measureCitationDensity(report);
  if (density.numericalClaims >= 5 && density.citations < Math.max(3, density.numericalClaims / 2)) {
    const retryUser = `${user}

⚠️ Your previous draft had ${density.numericalClaims} numerical claims but only ${density.citations} [N] citations. That ratio is too low. Rewrite with stricter citation density: every percentage, dollar amount, count, date, and named entity must carry [N]. Use the At a Glance table to anchor the key metrics.`;
    try {
      const rawRetry = await callLLM(sys, retryUser, 4000, [], 90_000, { liveSearch, model: researchModel });
      const { content: retryReport, liveCitations: retryCitations } = extractLiveCitations(rawRetry);
      return { report: retryReport, liveCitations: retryCitations.length > 0 ? retryCitations : liveCitations };
    } catch {
      return { report, liveCitations };
    }
  }

  return { report, liveCitations };
}

// Strip the GROK_LIVE_CITATIONS sentinel block (added by callGrok when Live
// Search ran) and return the citation URLs separately.
function extractLiveCitations(raw: string): { content: string; liveCitations: string[] } {
  const match = raw.match(/<!--GROK_LIVE_CITATIONS\n([\s\S]*?)\nGROK_LIVE_CITATIONS-->/);
  if (!match) return { content: raw, liveCitations: [] };
  const urls = match[1].split("\n").map((u) => u.trim()).filter(Boolean);
  return { content: raw.replace(match[0], "").trimEnd(), liveCitations: urls };
}

function measureCitationDensity(report: string): { numericalClaims: number; citations: number; namedEntities: number } {
  // Numerical claims: percentages, dollar amounts, large counts, years
  const percentages = report.match(/\d+(?:\.\d+)?\s*%/g) ?? [];
  const dollars = report.match(/\$\s*\d+(?:\.\d+)?\s*(?:[KkMmBbTt]|million|billion|trillion)?/g) ?? [];
  const counts = report.match(/\b\d{1,3}(?:,\d{3})+\b/g) ?? [];
  const years = report.match(/\b(?:19|20)\d{2}\b/g) ?? [];
  const numericalClaims = percentages.length + dollars.length + counts.length + years.length;

  // Inline citations
  const citationsMatches = report.match(/\[\d+(?:\s*,\s*\d+)*\]/g) ?? [];
  const citations = citationsMatches.length;

  // Capitalized multi-word entities (proper nouns) - proxy for named entities
  const namedEntities = (report.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+|\s+[A-Z][a-z]+)\b/g) ?? []).length;

  return { numericalClaims, citations, namedEntities };
}

// Output structure validation - returns the names of any failed checks.
// Used to decide whether the synthesis output is worth retrying.
function validateReportStructure(report: string): string[] {
  const issues: string[] = [];

  // 1. "At a Glance" section with a Markdown table
  const atGlance = report.match(/##\s*At a Glance[\s\S]*?(?=\n##|\n#|$)/i);
  if (!atGlance) {
    issues.push("missing-at-a-glance");
  } else {
    // Markdown table = at least 2 lines that start with `|`
    const tableLines = (atGlance[0].match(/^\|.+\|.+$/gm) ?? []).length;
    if (tableLines < 2) issues.push("at-a-glance-no-table");
  }

  // 2. Counterevidence section must exist and be non-trivial
  const counter = report.match(/##\s*Counterevidence[\s\S]*?(?=\n##|\n#|$)/i);
  if (!counter) {
    issues.push("missing-counterevidence");
  } else {
    const counterText = counter[0].replace(/##.*$/m, "").trim();
    if (counterText.length < 80) issues.push("counterevidence-too-short");
  }

  // 3. Citation density - every 200 words should have at least 1 [N] citation
  // in the Key Findings + Analysis sections
  const findingsAndAnalysis = report
    .replace(/^#.+$/m, "") // strip title
    .replace(/##\s*(TL;DR|At a Glance|Sources|Follow-up Questions)[\s\S]*?(?=\n##|\n#|$)/gi, "")
    .replace(/##\s*Counterevidence[\s\S]*?(?=\n##|\n#|$)/gi, "");
  const wordCount = findingsAndAnalysis.split(/\s+/).filter(Boolean).length;
  const citationCount = (findingsAndAnalysis.match(/\[\d+(?:\s*,\s*\d+)*\]/g) ?? []).length;
  if (wordCount >= 200 && citationCount < Math.floor(wordCount / 200)) {
    issues.push("low-citation-density");
  }

  // 4. Follow-up Questions section present
  if (!report.match(/##\s*Follow-up Questions/i)) {
    issues.push("missing-followups");
  }

  return issues;
}

// Build a search query for finding related vault entries. Prefer high-signal
// terms from the user query, dropping common research filler words.
function buildSearchTermsForLinking(query: string): string {
  const terms = extractQueryTerms(query);
  return terms.length > 0 ? terms.join(" ") : query;
}

// Extract a vault key from a search hit. The /vault/search endpoint returns
// semantic memory documents whose metadata may or may not contain a vault key.
function extractVaultKeyFromHit(hit: { id?: string; metadata?: any; content?: string }): string | null {
  // Heuristic 1: metadata.vaultKey or metadata.key
  if (hit.metadata?.vaultKey && typeof hit.metadata.vaultKey === "string") return hit.metadata.vaultKey;
  if (hit.metadata?.key && typeof hit.metadata.key === "string") return hit.metadata.key;
  // Heuristic 2: content first line matches the vault key path pattern
  const firstLine = (hit.content ?? "").split("\n", 1)[0];
  const m = firstLine.match(/^(research|memory|workflow|prompt|execution|file|credential)\/[a-z0-9\-/]+/i);
  if (m) return m[0];
  return null;
}

// Group Live Search citations by source type (X, news, web) for readability.
function formatLiveCitations(urls: string[]): string {
  const groups: Record<string, string[]> = { "X (Twitter)": [], "News": [], "Web": [] };
  for (const url of urls) {
    if (/x\.com|twitter\.com/i.test(url)) groups["X (Twitter)"].push(url);
    else if (/(reuters|apnews|bbc|cnbc|bloomberg|theverge|techcrunch|wsj|ft|nytimes|coindesk|axios|economist)\.com/i.test(url)) groups["News"].push(url);
    else groups["Web"].push(url);
  }
  const lines: string[] = [];
  for (const [label, list] of Object.entries(groups)) {
    if (list.length === 0) continue;
    lines.push(`**${label}** (${list.length}):`);
    for (const url of list.slice(0, 8)) {
      lines.push(`- ${url}`);
    }
    if (list.length > 8) lines.push(`- _…and ${list.length - 8} more_`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// ─── Source ranking ───────────────────────────────────────────────────────────

function rankAndDedupe(
  candidates: Array<{ url: string; title: string; desc: string; queryRank: number }>,
  freshMode?: boolean,
): Array<{ url: string; title: string; desc: string }> {
  // Score: search-rank inverse + domain tier bonus. Lower queryRank = higher.
  // In fresh mode, give news domains an extra +2 boost so recent reporting
  // ranks above evergreen content.
  const scored = candidates.map((c) => ({
    ...c,
    score: -c.queryRank + tierBonus(c.url) + (freshMode && NEWS_DOMAIN_BOOST_RE.test(c.url) ? 2 : 0),
    domain: domainOf(c.url),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Domain diversity - cap MAX_PER_DOMAIN sources from same domain
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

export type ProgressCallback = (message: string, totalSteps?: number) => void | Promise<void>;

export async function handleDeepResearch(
  name: string,
  args: unknown,
  onProgress?: ProgressCallback,
): Promise<ToolResult | null> {
  if (name !== "deep_research") return null;

  const parsed = InputSchema.safeParse(args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
  }

  const { query, focus, continueFrom } = parsed.data;
  const depth = parsed.data.depth ?? "standard";
  const saveToVault = parsed.data.saveToVault ?? true;

  // Fresh mode: auto-detect from query unless explicitly set.
  const freshModeAuto = FRESH_TRIGGER_RE.test(query);
  const freshMode = parsed.data.freshMode ?? freshModeAuto;
  const freshDays = parsed.data.freshDays ?? 14;
  const freshConfig = freshMode ? { days: freshDays } : undefined;

  // Live Search resolution - opt-in only when Grok is the active provider.
  // Default: enable when Grok is active (smart default - they paid for the
  // feature, use it), disable otherwise (other providers ignore it anyway).
  const grokActive = isGrokActive();
  const liveSearchEnabled = (parsed.data.liveSearch ?? grokActive) && grokActive;
  const liveSearch: LiveSearchOptions | undefined = liveSearchEnabled
    ? {
        mode: "on",
        sources: (parsed.data.liveSearchSources as LiveSearchSource[] | undefined) ?? ["web", "x", "news"],
        maxResults: depth === "fast" ? 8 : depth === "deep" ? 18 : 12,
        fromDate: parsed.data.liveSearchDays
          ? new Date(Date.now() - parsed.data.liveSearchDays * 86_400_000).toISOString().slice(0, 10)
          : undefined,
      }
    : undefined;

  // No early FIRECRAWL_API_KEY gate - fcSearch/fcScrape transparently fall
  // through to the Noelclaw backend proxy when the user is signed in but
  // has no local key. If both paths fail, the search loop returns an empty
  // source list and the synthesis stage produces the "insufficient signal"
  // skip report instead of a fake summary.

  // Depth knobs
  // Multi-agent mode (standard/deep): N angles × 2-3 queries each = effective
  // sub-query count. Fast mode keeps the original flat-planner behavior.
  const angleN      = depth === "deep" ? 5 : 3;
  const subN        = depth === "fast" ? 3 : depth === "deep" ? 7 : 5;
  const searchLimit = depth === "fast" ? 4 : depth === "deep" ? 6 : 5;
  const maxScrape   = depth === "fast" ? 10 : depth === "deep" ? 22 : 16;
  const maxSources  = depth === "fast" ? 10 : depth === "deep" ? 20 : 14;
  const useReflection = depth !== "fast";
  const useCritic     = depth === "deep";
  const useAngles     = depth !== "fast";

  const queryTerms = extractQueryTerms(query);
  const progress: string[] = [];
  // log() retains backwards-compat (collects messages for the final report
  // footer), and also emits MCP progress notifications when the client
  // opted in via _meta.progressToken (handled at the server.ts layer).
  // Estimated total steps for fast/standard/deep - used as `total` in the
  // notification so progress UIs can render a percentage.
  const totalSteps = depth === "deep" ? 9 : depth === "standard" ? 8 : 6;
  const log = (line: string) => {
    progress.push(line);
    if (onProgress) {
      // Fire-and-forget - never let progress emission slow the pipeline.
      Promise.resolve(onProgress(line.replace(/^[^\w]+/, "").trim(), totalSteps)).catch(() => {});
    }
  };

  if (liveSearch) {
    log(`🛰  Live Search: ON · sources=[${liveSearch.sources.join(", ")}] · max=${liveSearch.maxResults}${liveSearch.fromDate ? ` · since=${liveSearch.fromDate}` : ""}`);
  }

  if (freshMode) {
    log(`⏱ Fresh mode: ON · last ${freshDays} days · news-domain boost active${freshModeAuto && !parsed.data.freshMode ? " (auto-detected from query)" : ""}`);
  }

  // ── Stage 0: load prior report (continueFrom) ──
  let priorContext: { key: string; content: string } | undefined;
  if (continueFrom) {
    log(`📚 Loading prior report \`${continueFrom}\` to continue research thread...`);
    try {
      const prior = await callConvex(
        `/vault/entry?key=${encodeURIComponent(continueFrom)}`,
        "GET",
        undefined,
        "vault_read",
      ) as { content?: string; key?: string } | null;
      if (prior?.content && prior.content.length > 100) {
        priorContext = { key: prior.key ?? continueFrom, content: prior.content };
        log(`✅ Loaded prior report (${prior.content.length} chars) - planner & synth will build on it.`);
      } else {
        log(`⚠️ Prior report \`${continueFrom}\` not found or empty - proceeding as fresh research.`);
      }
    } catch (err: any) {
      log(`⚠️ Could not load prior report (${err.message ?? "error"}) - proceeding as fresh research.`);
    }
  }

  // ── Stage 1: plan ──
  // Multi-agent mode (standard/deep) decomposes into labeled angles. Each
  // angle has 2-3 sub-queries - flatten them for the search stage but keep
  // the angle structure for synthesis & critic prompts.
  let angles: ResearchAngle[] = [];
  let subQs: string[];
  if (useAngles) {
    log(`🧭 Planning ${angleN} specialist angles${priorContext ? " (continuation mode)" : ""}${freshMode ? " (fresh mode)" : ""}...`);
    angles = await planAngles(query, angleN, focus, priorContext?.content, freshConfig);
    if (angles.length === 0) {
      // Planner returned nothing usable - fall back to flat sub-query mode
      log(`⚠️ Angle planner failed, falling back to flat sub-query planning.`);
      subQs = await planQueries(query, subN, focus, priorContext?.content, freshConfig);
    } else {
      const seen = new Set<string>();
      const flat: string[] = [];
      for (const a of angles) {
        for (const q of a.queries) {
          if (!seen.has(q.toLowerCase())) { seen.add(q.toLowerCase()); flat.push(q); }
        }
      }
      subQs = flat;
      log(`📐 Angles: ${angles.map((a) => `"${a.label}"`).join(" · ")} → ${subQs.length} unique queries.`);
    }
  } else {
    log(`🧭 Planning ${subN} sub-questions${priorContext ? " (continuation mode)" : ""}${freshMode ? " (fresh mode)" : ""}...`);
    subQs = await planQueries(query, subN, focus, priorContext?.content, freshConfig);
  }

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

  const ranked = rankAndDedupe(allCandidates, freshMode).slice(0, maxScrape);
  log(`📊 Ranked ${allCandidates.length} candidates → ${ranked.length} after domain dedup (max ${MAX_PER_DOMAIN}/domain)${freshMode ? " + news-domain boost" : ""}.`);

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
    .map((s, i) => ({ n: i + 1, ...s, class: classifySource(s.score) }));

  if (sources.length === 0) {
    return { content: [{ type: "text", text: `Could not scrape any usable sources for: "${query}". Sites may be blocking or paywalled.` }], isError: true };
  }

  // ── Stage 4: draft synthesis (only if reflection enabled) ──
  let draft = "";
  if (useReflection) {
    log(`✍️  Drafting initial report (will reflect & refine)...`);
    try {
      const draftResult = await synthesize(query, sources, false, liveSearch);
      draft = draftResult.report;
    } catch {
      // If draft fails, fall through to final synth with what we have
      draft = "";
    }
  }

  // ── Stage 5: reflection - find gaps, search again ──
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
      const gapRanked = rankAndDedupe(gapCandidates, freshMode).slice(0, gapQs.length * 2);
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
      const appended = newSources.map((s, i) => ({ n: startN + i + 1, ...s, class: classifySource(s.score) }));
      sources = [...sources, ...appended].slice(0, maxSources + 4);
      log(`✅ Added ${appended.length} gap-fill source(s).`);
    } else {
      log(`✅ No gaps found - draft is complete.`);
    }
  }

  // ── Stage 5b: critic (deep mode only) ──
  // Adversarial pass over the draft. Critic notes get prepended to the
  // final synthesizer's prompt so the model addresses concrete weaknesses.
  let criticNotes = "";
  if (useCritic && draft) {
    log(`⚖️ Critic audit - challenging draft for single-source claims & contradictions...`);
    criticNotes = await runCritic(query, draft, angles, sources.length);
    if (criticNotes) {
      // Tolerant verdict extraction - the critic LLM doesn't always honor
      // the "Net recommendation: X" sentinel exactly. Look for any of the
      // three verdict tokens near the end of the notes.
      const tail = criticNotes.slice(-400).toLowerCase();
      let verdict = "delivered";
      if (/\brevise|\brewrite|\bweak|\bfix/i.test(tail)) verdict = "revise";
      if (/\breject|\binsufficient|\bcannot/i.test(tail)) verdict = "reject";
      if (/\baccept|\bsolid|\bsound|\bgood|\bcorrect/i.test(tail)) verdict = "accept";
      log(`✅ Critic ${verdict} (${criticNotes.length} chars of notes).`);
    } else {
      log(`⚠️ Critic returned no notes (LLM error or empty response).`);
    }
  }

  // ── Stage 6: final synthesis ──
  log(`📝 Writing final report from ${sources.length} sources${angles.length > 0 ? ` across ${angles.length} angle(s)` : ""}${criticNotes ? " (critic-audited)" : ""}${liveSearch ? " + Live Search" : ""}${priorContext ? ` (continuing \`${priorContext.key}\`)` : ""}${freshMode ? " (fresh)" : ""}...`);
  let report: string;
  let liveCitations: string[] = [];
  try {
    const finalResult = await synthesize(query, sources, true, liveSearch, priorContext, freshMode, angles, criticNotes);
    report = finalResult.report;
    liveCitations = finalResult.liveCitations;
  } catch (err: any) {
    return { content: [{ type: "text", text: `Synthesis failed: ${err.message ?? err}` }], isError: true };
  }

  // ── Stage 6b: structural output validation ──
  // Verify the report contains the required sections + adequate citation
  // density. If 2+ checks fail, retry synthesis once with stricter prompt.
  const issues = validateReportStructure(report);
  if (issues.length >= 2) {
    log(`🔧 Output validation found ${issues.length} issues (${issues.join(", ")}). Retrying synthesis with stricter prompt...`);
    try {
      const retryResult = await synthesize(query, sources, true, liveSearch, priorContext, freshMode, angles, criticNotes);
      const retryIssues = validateReportStructure(retryResult.report);
      if (retryIssues.length < issues.length) {
        report = retryResult.report;
        if (retryResult.liveCitations.length > 0) liveCitations = retryResult.liveCitations;
        log(`✅ Retry improved - ${retryIssues.length} issues remaining.`);
      } else {
        log(`⚠️ Retry didn't improve - keeping original.`);
      }
    } catch {
      log(`⚠️ Retry failed - keeping original output.`);
    }
  } else if (issues.length > 0) {
    log(`⚠️ Output has minor issues: ${issues.join(", ")}.`);
  } else {
    log(`✅ Output structure validated.`);
  }

  // Append sources list with snippets
  const sourcesSection = sources
    .map((s) => {
      const date = s.publishedAt ? ` (${s.publishedAt.slice(0, 10)})` : "";
      const cls = s.class !== "unclassified" ? ` · ${s.class}` : "";
      return `[${s.n}] **${s.title}** - ${s.domain}${date}${cls}\n   ${s.url}`;
    })
    .join("\n\n");

  // Group live citations by source type for readability
  const liveSection = liveCitations.length > 0
    ? `\n\n### 🛰 Real-time sources (Live Search)\n\n${formatLiveCitations(liveCitations)}`
    : "";

  const fullReport = `${report.trim()}\n\n## Sources\n\n${sourcesSection}${liveSection}`;

  // ── Stage 6.5: signal gate ──
  // If the synthesis is thin (LLM admitted "search returned directory pages"
  // or content has no concrete data), return an honest "insufficient signal"
  // result instead of saving and citing a fake summary. The user can rerun
  // with a sharper query.
  const signal = checkSignal(report);
  if (!signal.ok) {
    const skipMsg = [
      `## ⚠️ Insufficient signal`,
      ``,
      `**Query:** ${query}`,
      `**Reason:** ${signal.reason}`,
      `**Signal score:** ${signal.score.toFixed(2)} / 1.00`,
      ``,
      `The search results were too thin to produce a substantive report. Try a narrower or more recent query, or scope to a specific domain.`,
      ``,
      `<details><summary>Raw synthesis (saved for audit, not vault)</summary>`,
      ``,
      "```",
      report.slice(0, 1500),
      "```",
      ``,
      `</details>`,
    ].join("\n");
    return { content: [{ type: "text", text: skipMsg }] };
  }

  // ── Stage 7: vault save ──
  let vaultKey: string | null = null;
  if (saveToVault) {
    try {
      const r = (await callConvex("/vault/save", "POST", {
        type: "research",
        title: priorContext
          ? `Deep Research (cont.): ${query.slice(0, 80)}`
          : `Deep Research: ${query.slice(0, 80)}`,
        content: fullReport,
        tags: [
          "deep-research",
          depth,
          ...(focus ? [focus] : []),
          ...(priorContext ? ["continuation"] : []),
        ],
        agentId: "research",
        commitMsg: priorContext ? `deep_research continues ${priorContext.key}` : "deep_research run",
      }, "vault_save")) as { key?: string } | null;
      vaultKey = r?.key ?? null;
    } catch { /* keep going - return report inline */ }
  }

  // ── Stage 7b: link as continuation when continueFrom was used ──
  if (vaultKey && priorContext) {
    try {
      await callConvex("/vault/link", "POST", {
        fromKey: vaultKey,
        toKey: priorContext.key,
        relation: "continues",
      }, "vault_link");
      log(`🧬 Linked new report as \`continues\` → \`${priorContext.key}\`.`);
    } catch {
      log(`⚠️ Could not create continuation link.`);
    }
  }

  // ── Stage 8: vault auto-linking - connect this report to related research ──
  // This is what makes Noelclaw deep_research compound over time. Every new
  // report finds related past reports in your vault and creates typed links,
  // so your knowledge base grows into a connected graph (vault_related to
  // explore it). Best-effort - failure here never blocks the report.
  const linkedKeys: string[] = [];
  if (vaultKey && saveToVault) {
    try {
      const searchTerms = buildSearchTermsForLinking(query);
      log(`🔗 Searching vault for related research (terms: ${searchTerms.slice(0, 60)}...)`);
      const searchResult = (await callConvex("/vault/search", "POST", {
        q: searchTerms,
        n: 8,
      }, "vault_search")) as { results?: Array<{ id?: string; metadata?: { title?: string }; content?: string }> } | null;

      const hits = (searchResult?.results ?? [])
        .map((r) => ({
          // The /vault/search endpoint returns documents from the semantic
          // memory layer, not vault keys directly. We need to extract vault
          // keys from the metadata when present.
          key: extractVaultKeyFromHit(r),
          title: r.metadata?.title ?? "(untitled)",
        }))
        .filter((h): h is { key: string; title: string } => !!h.key && h.key !== vaultKey)
        .slice(0, 3);

      if (hits.length > 0) {
        for (const hit of hits) {
          try {
            await callConvex("/vault/link", "POST", {
              fromKey: vaultKey,
              toKey: hit.key,
              relation: "related",
            }, "vault_link");
            linkedKeys.push(hit.key);
          } catch { /* skip individual link failures */ }
        }
        log(`✅ Linked to ${linkedKeys.length} related vault entr${linkedKeys.length === 1 ? "y" : "ies"}.`);
      } else {
        log(`✅ No related vault entries found - this is a fresh research thread.`);
      }
    } catch {
      // Vault auto-linking is purely additive - silent failure is fine
      log(`⚠️ Vault auto-link skipped (search unavailable).`);
    }
  }

  const linkedSection = linkedKeys.length > 0
    ? `🔗 Auto-linked to ${linkedKeys.length} related research entr${linkedKeys.length === 1 ? "y" : "ies"} in your vault:\n${linkedKeys.map((k) => `   • \`${k}\``).join("\n")}`
    : "";

  const continuationSection = priorContext
    ? `🧬 **Continuation** of \`${priorContext.key}\` - linked as relation:continues`
    : "";

  const header = [
    `🔬 **Deep Research v3** - depth: ${depth} · ${subQs.length} planned + ${useReflection ? "reflection" : "no reflection"} · ${sources.length} scraped sources${liveCitations.length > 0 ? ` · ${liveCitations.length} live` : ""}${liveSearch ? ` · 🛰 Live Search [${liveSearch.sources.join(",")}]` : ""}${freshMode ? ` · ⏱ fresh:${freshDays}d` : ""}`,
    vaultKey ? `📁 Saved to vault: \`${vaultKey}\`` : (saveToVault ? `⚠️ Vault save skipped (not authenticated - sign in with \`noelclaw login\`)` : ""),
    continuationSection,
    linkedSection,
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
