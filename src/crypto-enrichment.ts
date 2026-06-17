// Crypto-aware enrichment for deep_research.
//
// Problem: Firecrawl search frequently surfaces low-TVL or secondary sources
// for major protocols. A Morpho USDC query returned $85K vaults instead of
// $50M+ flagship vaults visible on DefiLlama. The synthesis can't outperform
// the data it's given.
//
// Fix: detect crypto topics in the query, hit primary sources directly
// (DefiLlama for TVL/yields, CoinGecko for prices), and pre-inject those
// numbers into the synthesis context as authoritative ground truth.
//
// Free public APIs - no keys needed.

export type EnrichmentBlock = {
  /** Markdown block to inject into the synthesis prompt before the LLM writes */
  context: string;
  /** Domain tags used in source citations so the LLM knows what's authoritative */
  authoritative: string[];
  /** True when any enrichment data was actually fetched */
  hasData: boolean;
};

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

const CRYPTO_INDICATORS = [
  "tvl", "apy", "yield", "vault", "lp", "amm", "perp", "stablecoin",
  "token", "defi", "swap", "lend", "borrow", "stake",
];

const TOP_TOKENS = [
  "btc", "bitcoin", "eth", "ethereum", "usdc", "usdt", "dai", "weth",
  "sol", "solana", "matic", "avax", "link", "uni", "aave", "ldo",
];

function detectsCryptoTopic(query: string): boolean {
  const q = query.toLowerCase();
  return (
    DEFI_PROTOCOLS.some((p) => q.includes(p)) ||
    CHAIN_KEYWORDS.some((c) => q.includes(c)) ||
    CRYPTO_INDICATORS.some((i) => q.includes(i)) ||
    TOP_TOKENS.some((t) => new RegExp(`\\b${t}\\b`, "i").test(q))
  );
}

function extractMatches(query: string, list: readonly string[]): string[] {
  const q = query.toLowerCase();
  return list.filter((item) => q.includes(item));
}

/** Fetch DefiLlama protocol data - returns top-N protocols by TVL with slug match. */
async function fetchDefiLlamaProtocol(name: string): Promise<any | null> {
  try {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const res = await fetch(`https://api.llama.fi/protocol/${slug}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (!data?.name) return null;
    return {
      name: data.name,
      url: data.url,
      tvl: typeof data.tvl === "number" ? data.tvl : null,
      tvlByChain: data.currentChainTvls ?? null,
      change_1d: data.change_1d,
      change_7d: data.change_7d,
      mcap: data.mcap,
      twitter: data.twitter,
      symbol: data.symbol,
      category: data.category,
    };
  } catch {
    return null;
  }
}

/** Fetch DefiLlama yields - top vaults filtered by chain + token. */
async function fetchDefiLlamaYields(token?: string, chain?: string): Promise<any[] | null> {
  try {
    const res = await fetch("https://yields.llama.fi/pools", {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (!Array.isArray(data?.data)) return null;
    let pools: any[] = data.data;
    if (chain) {
      const ch = chain.toLowerCase();
      pools = pools.filter((p) => (p.chain ?? "").toLowerCase() === ch);
    }
    if (token) {
      const tk = token.toLowerCase();
      pools = pools.filter((p) => (p.symbol ?? "").toLowerCase().includes(tk));
    }
    // Filter spam - only show meaningful TVL ($1M+) and non-extreme APY
    pools = pools.filter((p) => (p.tvlUsd ?? 0) > 1_000_000 && (p.apy ?? 0) < 100);
    return pools.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0)).slice(0, 10);
  } catch {
    return null;
  }
}

/** CoinGecko price + 24h change for one or more tokens (free public API). */
async function fetchCoingecko(symbols: string[]): Promise<Record<string, any> | null> {
  if (symbols.length === 0) return null;
  const ids = symbols
    .map((s) => {
      const m: Record<string, string> = {
        btc: "bitcoin", eth: "ethereum", sol: "solana", matic: "matic-network",
        usdc: "usd-coin", usdt: "tether", dai: "dai", weth: "weth",
        avax: "avalanche-2", link: "chainlink", uni: "uniswap", aave: "aave",
        ldo: "lido-dao",
      };
      return m[s.toLowerCase()] ?? s.toLowerCase();
    })
    .join(",");
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    return (await res.json()) as any;
  } catch {
    return null;
  }
}

function formatUsd(n: number | null | undefined): string {
  if (typeof n !== "number" || !isFinite(n)) return "n/a";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

/**
 * Main entry - call before the synthesis stage. Returns an enrichment block
 * to splice into the prompt. Pure best-effort: if APIs are down or query
 * isn't crypto, returns hasData=false and the synthesis runs as normal.
 */
export async function enrichCryptoQuery(query: string): Promise<EnrichmentBlock> {
  if (!detectsCryptoTopic(query)) {
    return { context: "", authoritative: [], hasData: false };
  }

  const protocols = extractMatches(query, DEFI_PROTOCOLS);
  const chains    = extractMatches(query, CHAIN_KEYWORDS);
  const tokens    = extractMatches(query, TOP_TOKENS);

  const blocks: string[] = [];
  const authoritative = ["defillama.com", "coingecko.com"];

  // ── Protocol TVL data ──
  if (protocols.length > 0) {
    const proto = await fetchDefiLlamaProtocol(protocols[0]);
    if (proto) {
      const chainBreakdown = proto.tvlByChain
        ? Object.entries(proto.tvlByChain as Record<string, number>)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .slice(0, 5)
            .map(([c, v]) => `${c}: ${formatUsd(v as number)}`)
            .join(" · ")
        : "";
      blocks.push([
        `### 📊 DefiLlama (live) - ${proto.name}`,
        ``,
        `- **Total TVL**: ${formatUsd(proto.tvl)}`,
        proto.change_1d != null ? `- **24h Δ**: ${proto.change_1d.toFixed(2)}%` : "",
        proto.change_7d != null ? `- **7d Δ**: ${proto.change_7d.toFixed(2)}%` : "",
        proto.mcap ? `- **Market cap**: ${formatUsd(proto.mcap)}` : "",
        chainBreakdown ? `- **Top chains**: ${chainBreakdown}` : "",
        proto.url ? `- **Site**: ${proto.url}` : "",
        ``,
        `_Source: https://api.llama.fi/protocol/${protocols[0].toLowerCase().replace(/\s+/g, "-")}_`,
      ].filter(Boolean).join("\n"));
    }
  }

  // ── Yield/vault data - when query mentions yield/vault/apy on a chain ──
  const yieldKeywords = ["yield", "vault", "apy", "lp"];
  const wantsYields = yieldKeywords.some((k) => query.toLowerCase().includes(k));
  if (wantsYields) {
    const ch = chains[0];
    const tk = tokens[0];
    const yields = await fetchDefiLlamaYields(tk, ch);
    if (yields && yields.length > 0) {
      const rows = yields.map((p) =>
        `- **${p.project}** ${p.symbol} on ${p.chain}: **${(p.apy ?? 0).toFixed(2)}% APY** · TVL ${formatUsd(p.tvlUsd)}`,
      ).join("\n");
      blocks.push([
        `### 💰 DefiLlama Yields (live, TVL > $1M, top ${yields.length})`,
        tk ? `**Token filter**: ${tk.toUpperCase()}` : "",
        ch ? `**Chain filter**: ${ch}` : "",
        ``,
        rows,
        ``,
        `_Source: https://yields.llama.fi/pools_`,
      ].filter(Boolean).join("\n"));
    }
  }

  // ── Token prices ──
  if (tokens.length > 0) {
    const prices = await fetchCoingecko(tokens);
    if (prices) {
      const rows = Object.entries(prices).map(([id, p]: [string, any]) => {
        const change = typeof p.usd_24h_change === "number" ? ` (${p.usd_24h_change >= 0 ? "+" : ""}${p.usd_24h_change.toFixed(2)}% 24h)` : "";
        const mcap = p.usd_market_cap ? ` · mcap ${formatUsd(p.usd_market_cap)}` : "";
        return `- **${id}**: $${(p.usd ?? 0).toLocaleString()}${change}${mcap}`;
      }).join("\n");
      blocks.push([
        `### 💵 CoinGecko (live)`,
        ``,
        rows,
      ].join("\n"));
    }
  }

  if (blocks.length === 0) {
    return { context: "", authoritative: [], hasData: false };
  }

  const context = [
    `---`,
    `## 🔒 AUTHORITATIVE LIVE DATA`,
    ``,
    `The following numbers are pulled directly from primary APIs at query time. Treat these as ground truth - prefer these figures over any conflicting numbers from scraped web pages. Cite them as \`[DefiLlama]\` or \`[CoinGecko]\` in your report.`,
    ``,
    ...blocks,
    `---`,
  ].join("\n");

  return { context, authoritative, hasData: true };
}
