// Generalized enrichment router for deep_research synthesis.
//
// Old behavior: Firecrawl scraped 5–10 pages and the LLM synthesized. When
// pages were thin or outdated, the LLM filled gaps with plausible fiction.
//
// New behavior: detect the topic domain and hit primary-source APIs in
// parallel before synthesis. Inject results as "AUTHORITATIVE LIVE DATA"
// the LLM is instructed to lead with.
//
// All APIs used here are free, public, no auth required:
//   - DefiLlama, CoinGecko (crypto)
//   - HackerNews Algolia (tech news, ~real-time)
//   - GitHub search (repos, no auth needed for public read)
//   - arXiv (academic papers)
//   - Wikipedia REST (foundational facts)
//
// All calls are best-effort with short timeouts - if any fail, the
// synthesis runs without that block.

export type EnrichmentBlock = {
  context: string;
  authoritative: string[];
  hasData: boolean;
  domains: Array<"crypto" | "tech" | "academic" | "general">;
};

// ─── Topic detection ──────────────────────────────────────────────────────────

const CRYPTO_RE = /\b(tvl|apy|yield|vault|defi|stablecoin|usdc|usdt|eth|btc|sol|bitcoin|ethereum|solana|aerodrome|uniswap|morpho|moonwell|aave|lido|ethena|pendle|curve|gauntlet|steakhouse|base chain|arbitrum|optimism|polygon|onchain|on-chain|wallet|swap|amm|perpetual|perp|liquid staking)\b/i;

const TECH_RE = /\b(ai|llm|gpt|claude|anthropic|openai|gemini|machine learning|deep learning|neural|transformer|frontier model|agent|mcp|api|framework|library|sdk|github|repo|repository|startup|y combinator|yc|saas|vc|funding round|seed|series [a-d]|launches|launched|release|shipped|build|launch)\b/i;

const ACADEMIC_RE = /\b(paper|research paper|arxiv|study|publication|preprint|peer.review|citation|abstract|methodology|hypothesis|empirical|experiment|finding[s]?|literature review|systematic review|meta.analysis|theorem|proof)\b/i;

const FACTUAL_RE = /\b(history of|founded|established|definition|what is|who is|when did|where is|biography|encyclopedia|background|origin|first invented)\b/i;

function detectDomains(query: string): Array<"crypto" | "tech" | "academic" | "general"> {
  const q = query.toLowerCase();
  const domains: Array<"crypto" | "tech" | "academic" | "general"> = [];
  if (CRYPTO_RE.test(q)) domains.push("crypto");
  if (TECH_RE.test(q)) domains.push("tech");
  if (ACADEMIC_RE.test(q)) domains.push("academic");
  if (FACTUAL_RE.test(q)) domains.push("general");
  return domains;
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function formatUsd(n: number | null | undefined): string {
  if (typeof n !== "number" || !isFinite(n)) return "n/a";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function clipText(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function ageInDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// ─── Crypto enrichment (DefiLlama + CoinGecko) ────────────────────────────────

const DEFI_PROTOCOLS = [
  "aerodrome", "uniswap", "morpho", "moonwell", "aave", "compound", "lido",
  "rocket pool", "rocketpool", "ethena", "pendle", "curve", "balancer",
  "convex", "frax", "spark", "fluid", "kamino", "marginfi", "jupiter",
  "raydium", "orca", "drift", "gmx", "synthetix", "dydx", "vertex",
  "hyperliquid", "yearn", "gauntlet", "steakhouse",
];

const CHAIN_KEYWORDS = [
  "ethereum", "base", "arbitrum", "optimism", "polygon", "solana", "avalanche",
  "blast", "sonic", "linea", "scroll", "zksync", "berachain", "monad",
];

const TOP_TOKENS = [
  "btc", "bitcoin", "eth", "ethereum", "usdc", "usdt", "dai", "weth",
  "sol", "solana", "matic", "avax", "link", "uni", "aave", "ldo",
];

async function cryptoEnrich(query: string): Promise<string | null> {
  const q = query.toLowerCase();
  const protocols = DEFI_PROTOCOLS.filter((p) => q.includes(p));
  const chains    = CHAIN_KEYWORDS.filter((c) => q.includes(c));
  const tokens    = TOP_TOKENS.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(q));

  const blocks: string[] = [];

  // Protocol TVL
  if (protocols.length > 0) {
    try {
      const slug = protocols[0].toLowerCase().replace(/\s+/g, "-");
      const res = await fetch(`https://api.llama.fi/protocol/${slug}`, { signal: AbortSignal.timeout(8_000) });
      if (res.ok) {
        const d = (await res.json()) as any;
        if (d?.name) {
          const chainBreakdown = d.currentChainTvls
            ? Object.entries(d.currentChainTvls as Record<string, number>)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .slice(0, 5)
                .map(([c, v]) => `${c}: ${formatUsd(v as number)}`)
                .join(" · ")
            : "";
          blocks.push([
            `### 📊 DefiLlama - ${d.name}`,
            `- TVL: **${formatUsd(d.tvl)}** | 24h: ${d.change_1d?.toFixed(2) ?? "n/a"}% | 7d: ${d.change_7d?.toFixed(2) ?? "n/a"}%`,
            d.mcap ? `- Market cap: ${formatUsd(d.mcap)}` : "",
            chainBreakdown ? `- Top chains: ${chainBreakdown}` : "",
            `- Source: https://defillama.com/protocol/${slug}`,
          ].filter(Boolean).join("\n"));
        }
      }
    } catch { /* ignore */ }
  }

  // Yields
  if (q.match(/\b(yield|vault|apy|lp)\b/)) {
    try {
      const res = await fetch("https://yields.llama.fi/pools", { signal: AbortSignal.timeout(8_000) });
      if (res.ok) {
        const d = (await res.json()) as any;
        let pools = (d?.data ?? []) as any[];
        if (chains[0]) pools = pools.filter((p) => (p.chain ?? "").toLowerCase() === chains[0]);
        if (tokens[0]) pools = pools.filter((p) => (p.symbol ?? "").toLowerCase().includes(tokens[0]));
        pools = pools.filter((p) => (p.tvlUsd ?? 0) > 1_000_000 && (p.apy ?? 0) < 100);
        pools = pools.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0)).slice(0, 8);
        if (pools.length > 0) {
          const rows = pools.map((p) =>
            `- **${p.project}** ${p.symbol} on ${p.chain}: ${(p.apy ?? 0).toFixed(2)}% APY · TVL ${formatUsd(p.tvlUsd)}`,
          ).join("\n");
          blocks.push(`### 💰 DefiLlama Yields (TVL > $1M)\n${rows}\n- Source: https://yields.llama.fi/`);
        }
      }
    } catch { /* ignore */ }
  }

  // Prices
  if (tokens.length > 0) {
    try {
      const idMap: Record<string, string> = {
        btc: "bitcoin", eth: "ethereum", sol: "solana", matic: "matic-network",
        usdc: "usd-coin", usdt: "tether", dai: "dai", weth: "weth",
        avax: "avalanche-2", link: "chainlink", uni: "uniswap", aave: "aave",
        ldo: "lido-dao",
      };
      const ids = tokens.map((t) => idMap[t.toLowerCase()] ?? t.toLowerCase()).join(",");
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (res.ok) {
        const d = (await res.json()) as any;
        const rows = Object.entries(d).map(([id, p]: [string, any]) => {
          const change = typeof p.usd_24h_change === "number"
            ? ` (${p.usd_24h_change >= 0 ? "+" : ""}${p.usd_24h_change.toFixed(2)}% 24h)`
            : "";
          const mcap = p.usd_market_cap ? ` · mcap ${formatUsd(p.usd_market_cap)}` : "";
          return `- **${id}**: $${(p.usd ?? 0).toLocaleString()}${change}${mcap}`;
        }).join("\n");
        if (rows) blocks.push(`### 💵 CoinGecko\n${rows}\n- Source: https://www.coingecko.com/`);
      }
    } catch { /* ignore */ }
  }

  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

// ─── Tech enrichment (HackerNews Algolia + GitHub search) ────────────────────

async function techEnrich(query: string): Promise<string | null> {
  const blocks: string[] = [];

  // HackerNews - last 30 days, sorted by relevance + popularity
  try {
    const since = Math.floor((Date.now() - 30 * 86_400_000) / 1000);
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&numericFilters=created_at_i>${since}&hitsPerPage=8`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      const d = (await res.json()) as any;
      const hits = (d?.hits ?? []) as any[];
      if (hits.length > 0) {
        const rows = hits.slice(0, 6).map((h) => {
          const title = h.title ?? h.story_title ?? "(no title)";
          const points = h.points != null ? `${h.points} pts` : "";
          const comments = h.num_comments != null ? `${h.num_comments} comments` : "";
          const age = h.created_at ? `${ageInDays(h.created_at)}d ago` : "";
          const meta = [points, comments, age].filter(Boolean).join(" · ");
          const link = h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`;
          return `- **${clipText(title, 140)}** · ${meta}\n  ${link}`;
        }).join("\n");
        blocks.push(`### 📰 HackerNews (last 30d, top hits)\n${rows}\n- Source: https://hn.algolia.com/`);
      }
    }
  } catch { /* ignore */ }

  // GitHub search - public repos matching query
  try {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=6`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/vnd.github+json", "User-Agent": "noelclaw-mcp" },
    });
    if (res.ok) {
      const d = (await res.json()) as any;
      const repos = (d?.items ?? []) as any[];
      if (repos.length > 0) {
        const rows = repos.slice(0, 5).map((r) => {
          const stars = r.stargazers_count?.toLocaleString() ?? "?";
          const desc = clipText(r.description ?? "", 100);
          return `- **${r.full_name}** (★${stars}) - ${desc}\n  ${r.html_url}`;
        }).join("\n");
        blocks.push(`### 🐙 GitHub (top repos by stars)\n${rows}\n- Source: https://github.com/search?q=${encodeURIComponent(query)}`);
      }
    }
  } catch { /* ignore */ }

  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

// ─── Academic enrichment (arXiv) ─────────────────────────────────────────────

async function academicEnrich(query: string): Promise<string | null> {
  try {
    const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=5&sortBy=submittedDate&sortOrder=descending`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const xml = await res.text();
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
    if (entries.length === 0) return null;

    const rows = entries.slice(0, 5).map((e) => {
      const title = (e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").replace(/\s+/g, " ").trim();
      const summary = (e.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "").replace(/\s+/g, " ").trim();
      const published = e.match(/<published>([\s\S]*?)<\/published>/)?.[1] ?? "";
      const link = e.match(/<id>([\s\S]*?)<\/id>/)?.[1] ?? "";
      const date = published ? `${published.slice(0, 10)} (${ageInDays(published)}d ago)` : "";
      return `- **${clipText(title, 140)}** · ${date}\n  ${clipText(summary, 200)}\n  ${link}`;
    }).join("\n\n");

    return `### 📚 arXiv (recent papers)\n${rows}\n- Source: https://arxiv.org/`;
  } catch {
    return null;
  }
}

// ─── General enrichment (Wikipedia REST) ─────────────────────────────────────

async function generalEnrich(query: string): Promise<string | null> {
  try {
    // Wikipedia search - find best matching article
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&search=${encodeURIComponent(query)}&limit=3`,
      { signal: AbortSignal.timeout(6_000) },
    );
    if (!searchRes.ok) return null;
    const [, titles, descs, urls] = (await searchRes.json()) as [string, string[], string[], string[]];
    if (!titles || titles.length === 0) return null;

    // Fetch summary for top hit
    const top = titles[0];
    const sumRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(top)}`,
      { signal: AbortSignal.timeout(6_000) },
    );
    if (!sumRes.ok) return null;
    const summary = (await sumRes.json()) as any;

    const lines = [
      `### 🌐 Wikipedia - ${summary.title ?? top}`,
      summary.extract ? clipText(summary.extract, 600) : descs[0] ?? "",
      `- Source: ${urls[0] ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(top)}`}`,
    ];
    return lines.filter(Boolean).join("\n");
  } catch {
    return null;
  }
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Run enrichment in parallel for all detected domains. Pure best-effort: if
 * no domain matches or all APIs fail, returns hasData=false and synthesis
 * runs normally.
 */
export async function enrichQuery(query: string): Promise<EnrichmentBlock> {
  const domains = detectDomains(query);
  if (domains.length === 0) {
    return { context: "", authoritative: [], hasData: false, domains: [] };
  }

  const promises: Array<Promise<string | null>> = [];
  if (domains.includes("crypto"))   promises.push(cryptoEnrich(query));
  if (domains.includes("tech"))     promises.push(techEnrich(query));
  if (domains.includes("academic")) promises.push(academicEnrich(query));
  if (domains.includes("general"))  promises.push(generalEnrich(query));

  const results = await Promise.all(promises);
  const blocks = results.filter((b): b is string => !!b);
  if (blocks.length === 0) {
    return { context: "", authoritative: [], hasData: false, domains };
  }

  const authoritative: string[] = [];
  if (domains.includes("crypto"))   authoritative.push("defillama.com", "coingecko.com");
  if (domains.includes("tech"))     authoritative.push("news.ycombinator.com", "github.com");
  if (domains.includes("academic")) authoritative.push("arxiv.org");
  if (domains.includes("general"))  authoritative.push("wikipedia.org");

  const todayISO = new Date().toISOString().slice(0, 10);

  const context = [
    `---`,
    `## 🔒 AUTHORITATIVE LIVE DATA - fetched ${todayISO}`,
    ``,
    `The blocks below come from primary-source APIs called at query time. Treat as ground truth. When figures here conflict with the scraped sources below, prefer these and cite them by source name (e.g. \`[DefiLlama]\`, \`[HackerNews]\`, \`[arXiv]\`, \`[GitHub]\`, \`[Wikipedia]\`).`,
    ``,
    blocks.join("\n\n"),
    `---`,
  ].join("\n");

  return { context, authoritative, hasData: true, domains };
}

/**
 * Returns the current date in ISO format. Used by the synthesis prompt to
 * anchor the LLM in time - prevents "Q2 2026 catalysts in July" style
 * calendar hallucinations.
 */
export function todayContext(): string {
  const now = new Date();
  const iso = now.toISOString().slice(0, 10);
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const quarter = `Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
  return `Today is ${weekday}, ${iso}. This is ${quarter} ${now.getUTCFullYear()}. Treat any date after today as a future/projected event, not a confirmed one.`;
}
