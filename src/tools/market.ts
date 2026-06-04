import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";

const COINGECKO = "https://api.coingecko.com/api/v3";

const SYMBOL_TO_ID: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
  USDT: "tether", USDC: "usd-coin", XRP: "ripple", DOGE: "dogecoin",
  ADA: "cardano", AVAX: "avalanche-2", DOT: "polkadot", LINK: "chainlink",
  UNI: "uniswap", OP: "optimism", ARB: "arbitrum", PEPE: "pepe",
  SUI: "sui", APT: "aptos", NEAR: "near", INJ: "injective-protocol",
  TIA: "celestia", MATIC: "matic-network", TON: "the-open-network",
  SHIB: "shiba-inu", WIF: "dogwifcoin", BONK: "bonk", HYPE: "hyperliquid",
};

async function cgFetch(path: string): Promise<any> {
  const res = await fetch(`${COINGECKO}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  return res.json();
}

async function resolveTokenId(query: string): Promise<{ id: string; symbol: string } | null> {
  const upper = query.trim().toUpperCase();
  if (SYMBOL_TO_ID[upper]) return { id: SYMBOL_TO_ID[upper], symbol: upper };
  // Fallback: search CoinGecko — handles any token not in the static map
  try {
    const res = await cgFetch(`/search?query=${encodeURIComponent(query)}`);
    const coin = res.coins?.[0];
    if (coin?.id) return { id: coin.id, symbol: coin.symbol?.toUpperCase() ?? upper };
  } catch {}
  return null;
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1) return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${n.toPrecision(4)}`;
}

function fmtB(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${fmt(n)}`;
}

export const MARKET_TOOLS: Tool[] = [
  {
    name: "get_market_data",
    description: "Get live crypto market data: top 20 coins by market cap, trending coins, and key prices for BTC/ETH/SOL.",
    inputSchema: {
      type: "object",
      properties: { token: { type: "string", description: "Optional: focus on a specific token, e.g. 'BTC', 'ETH'" } },
      required: [],
    },
  },
  {
    name: "get_token_data",
    description: "Get live market data for a specific token. Returns price, 24h change, market cap, and volume.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "Token to look up, e.g. 'ETH', 'show me SOL', 'PEPE price'" } },
      required: ["question"],
    },
  },
  {
    name: "compare_tokens",
    description:
      "Compare 2–5 tokens side by side — price, 24h/7d change, market cap, volume, and ATH drawdown. " +
      "Ideal for deciding between assets or tracking a portfolio watchlist.",
    inputSchema: {
      type: "object",
      properties: {
        tokens: {
          type: "array",
          items: { type: "string" },
          description: "2–5 token symbols to compare, e.g. ['BTC', 'ETH', 'SOL']",
          minItems: 2,
          maxItems: 5,
        },
      },
      required: ["tokens"],
    },
  },
  {
    name: "market_overview",
    description:
      "Global crypto market snapshot: Fear & Greed Index, BTC dominance, total market cap, DeFi TVL, " +
      "ETH gas, trending tokens, and top sector leaders. Use for a full market briefing.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "token_history",
    description:
      "Get historical price data for a token. Returns OHLC candles for the requested timeframe. " +
      "Use to understand price trends, identify support/resistance levels, or calculate % changes over time.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Token symbol, e.g. 'BTC', 'ETH', 'SOL'" },
        days: {
          type: "number",
          description: "Number of days of history (1=24h, 7=7d, 30=30d, 90=90d, 365=1y). Default: 7",
        },
      },
      required: ["token"],
    },
  },
];

const GetMarketDataSchema = z.object({ token: z.string().optional() });
const GetTokenDataSchema = z.object({ question: z.string().min(1) });
const CompareTokensSchema = z.object({ tokens: z.array(z.string()).min(2).max(5) });
const TokenHistorySchema = z.object({ token: z.string().min(1), days: z.number().positive().optional() });

export interface MarketSnapshot {
  btc: number; eth: number; sol: number;
  btcChange: number; ethChange: number; solChange: number;
}

export async function fetchMarketSnapshot(): Promise<MarketSnapshot | null> {
  try {
    const data = await cgFetch("/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana&sparkline=false&price_change_percentage=24h");
    const find = (id: string, field: string) => data.find((c: any) => c.id === id)?.[field] ?? 0;
    return {
      btc: find("bitcoin", "current_price"),
      eth: find("ethereum", "current_price"),
      sol: find("solana", "current_price"),
      btcChange: find("bitcoin", "price_change_percentage_24h"),
      ethChange: find("ethereum", "price_change_percentage_24h"),
      solChange: find("solana", "price_change_percentage_24h"),
    };
  } catch {
    return null;
  }
}

export async function handleMarketTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "get_market_data": {
      const parsed = GetMarketDataSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

      const { token } = parsed.data;

      if (token) {
        const resolved = await resolveTokenId(token);
        if (!resolved) return { content: [{ type: "text", text: `Token not found: "${token}". Try a full name like "pepe" or a known symbol.` }], isError: true };
        const { id, symbol: sym } = resolved;
        const [data, trending] = await Promise.all([
          cgFetch(`/coins/markets?vs_currency=usd&ids=${id}&sparkline=false&price_change_percentage=24h`),
          cgFetch("/search/trending"),
        ]);
        const c = data[0];
        if (!c) return { content: [{ type: "text", text: `No data for ${sym}` }], isError: true };
        const sign = (c.price_change_percentage_24h ?? 0) >= 0 ? "+" : "";
        const lines = [
          `**${c.symbol?.toUpperCase()} — ${c.name}**`,
          `Price: ${fmtPrice(c.current_price)} (${sign}${fmt(c.price_change_percentage_24h)}% 24h)`,
          `Market Cap: ${fmtB(c.market_cap)} (rank #${c.market_cap_rank ?? "—"})`,
          `Volume 24h: ${fmtB(c.total_volume)}`,
          `High/Low 24h: ${fmtPrice(c.high_24h)} / ${fmtPrice(c.low_24h)}`,
          "",
          `_Source: CoinGecko · ${new Date().toUTCString()}_`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      const [top20, trending] = await Promise.all([
        cgFetch("/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h"),
        cgFetch("/search/trending"),
      ]);

      const lines: string[] = [`**Crypto Market Overview** — ${new Date().toUTCString()}`, ""];

      lines.push("**Key Prices**");
      for (const sym of ["BTC", "ETH", "SOL"]) {
        const c = top20.find((x: any) => x.symbol?.toUpperCase() === sym);
        if (!c) continue;
        const sign = (c.price_change_percentage_24h ?? 0) >= 0 ? "+" : "";
        lines.push(`• **${sym}**: ${fmtPrice(c.current_price)} (${sign}${fmt(c.price_change_percentage_24h)}% 24h) — mcap ${fmtB(c.market_cap)}`);
      }

      lines.push("", "**Top 20 by Market Cap**");
      for (const c of top20) {
        const sym = c.symbol?.toUpperCase();
        const sign = (c.price_change_percentage_24h ?? 0) >= 0 ? "+" : "";
        lines.push(`${c.market_cap_rank}. **${sym}** ${fmtPrice(c.current_price)} (${sign}${fmt(c.price_change_percentage_24h)}%) — ${fmtB(c.market_cap)}`);
      }

      const trendingCoins: any[] = trending?.coins?.slice(0, 7) ?? [];
      if (trendingCoins.length > 0) {
        lines.push("", "**Trending**");
        for (const t of trendingCoins) {
          const item = t.item;
          lines.push(`• **${item.symbol}** (#${item.market_cap_rank ?? "—"}) — ${item.name}`);
        }
      }

      lines.push("", `_Source: CoinGecko_`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "get_token_data": {
      const parsed = GetTokenDataSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

      const q = parsed.data.question;
      // Try to extract a known symbol first, then fall back to search
      const upperQ = q.toUpperCase();
      const knownSym = Object.keys(SYMBOL_TO_ID).find((s) => new RegExp(`\\b${s}\\b`).test(upperQ));
      const resolved = await resolveTokenId(knownSym ?? q);
      if (!resolved) return { content: [{ type: "text", text: `Token not found: "${q}". Try a symbol like "ETH" or a full name.` }], isError: true };
      const { id, symbol: sym } = resolved;

      const data = await cgFetch(`/coins/markets?vs_currency=usd&ids=${id}&sparkline=false&price_change_percentage=24h`);
      const c = data[0];
      if (!c) return { content: [{ type: "text", text: `No data found for ${sym}` }], isError: true };

      const sign = (c.price_change_percentage_24h ?? 0) >= 0 ? "+" : "";
      const lines = [
        `**${c.symbol?.toUpperCase()} — ${c.name}**`,
        `Price: ${fmtPrice(c.current_price)} (${sign}${fmt(c.price_change_percentage_24h)}% 24h)`,
        `Market Cap: ${fmtB(c.market_cap)} (rank #${c.market_cap_rank ?? "—"})`,
        `Volume 24h: ${fmtB(c.total_volume)}`,
        `High/Low 24h: ${fmtPrice(c.high_24h)} / ${fmtPrice(c.low_24h)}`,
        `All-Time High: ${fmtPrice(c.ath)} (${c.ath_change_percentage != null ? fmt(c.ath_change_percentage) + "% from ATH" : "—"})`,
        "",
        `_Source: CoinGecko · ${new Date().toUTCString()}_`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "compare_tokens": {
      const parsed = CompareTokensSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

      const syms = parsed.data.tokens.map(t => t.toUpperCase());
      const ids = syms.map(s => SYMBOL_TO_ID[s]).filter(Boolean);
      const unknown = syms.filter(s => !SYMBOL_TO_ID[s]);
      if (!ids.length) return { content: [{ type: "text", text: `Unknown tokens: ${unknown.join(", ")}` }], isError: true };

      const data = await cgFetch(
        `/coins/markets?vs_currency=usd&ids=${ids.join(",")}&sparkline=false&price_change_percentage=24h,7d`
      );

      const header = [
        `**Token Comparison** — ${new Date().toUTCString()}`,
        unknown.length ? `\n⚠️ Unknown: ${unknown.join(", ")}` : "",
        ``,
        `| Token | Price | 24h | 7d | Mcap | Vol 24h | ATH% |`,
        `|-------|-------|-----|----|------|---------|------|`,
      ].filter(Boolean);

      const rows = data.map((c: any) => {
        const sym = c.symbol?.toUpperCase();
        const ch24 = c.price_change_percentage_24h ?? 0;
        const ch7d = c.price_change_percentage_7d_in_currency ?? 0;
        const athPct = c.ath_change_percentage ?? 0;
        const s = (n: number) => `${n >= 0 ? "+" : ""}${fmt(n)}%`;
        return `| **${sym}** | ${fmtPrice(c.current_price)} | ${s(ch24)} | ${s(ch7d)} | ${fmtB(c.market_cap)} | ${fmtB(c.total_volume)} | ${fmt(athPct)}% |`;
      });

      return { content: [{ type: "text", text: [...header, ...rows].join("\n") }] };
    }

    case "market_overview": {
      const [globalData, fearGreed, trending] = await Promise.allSettled([
        cgFetch("/global"),
        fetch("https://api.alternative.me/fng/", { signal: AbortSignal.timeout(8000) }).then(r => r.json() as Promise<any>),
        cgFetch("/search/trending"),
      ]);

      const global = globalData.status === "fulfilled" ? globalData.value.data : null;
      const fg = fearGreed.status === "fulfilled" ? fearGreed.value?.data?.[0] : null;
      const trendCoins = trending.status === "fulfilled" ? (trending.value?.coins ?? []) : [];

      const totalMcap = global?.total_market_cap?.usd;
      const defiTvl = global?.total_value_locked?.usd;
      const btcDom = global?.market_cap_percentage?.btc;
      const ethDom = global?.market_cap_percentage?.eth;
      const mcap24hChange = global?.market_cap_change_percentage_24h_usd;

      const fgLabel = fg ? `${fg.value}/100 — ${fg.value_classification}` : "unavailable";
      const fgEmoji = fg ? (Number(fg.value) >= 75 ? "🟢 Extreme Greed" : Number(fg.value) >= 55 ? "🟢 Greed" : Number(fg.value) >= 45 ? "🟡 Neutral" : Number(fg.value) >= 25 ? "🔴 Fear" : "🔴 Extreme Fear") : "";

      const lines = [
        `## 🌍 Global Crypto Market`,
        `_${new Date().toUTCString()}_`,
        ``,
        `**Fear & Greed:** ${fgEmoji} ${fg?.value ?? "—"}/100 (${fg?.value_classification ?? "—"})`,
        totalMcap ? `**Total Market Cap:** ${fmtB(totalMcap)} (${mcap24hChange != null ? `${mcap24hChange >= 0 ? "+" : ""}${fmt(mcap24hChange)}% 24h` : ""})` : "",
        btcDom != null ? `**BTC Dominance:** ${fmt(btcDom)}%  |  **ETH:** ${fmt(ethDom ?? 0)}%` : "",
        defiTvl ? `**DeFi TVL:** ${fmtB(defiTvl)}` : "",
        global?.active_cryptocurrencies ? `**Active Coins:** ${global.active_cryptocurrencies.toLocaleString()}` : "",
        ``,
      ].filter(l => l !== "");

      if (trendCoins.length > 0) {
        lines.push(`**🔥 Trending Now**`);
        for (const t of trendCoins.slice(0, 7)) {
          const item = t.item;
          const rank = item.market_cap_rank ? `#${item.market_cap_rank}` : "unranked";
          lines.push(`• **${item.symbol}** (${rank}) — ${item.name}`);
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "token_history": {
      const parsed = TokenHistorySchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

      const days = parsed.data.days ?? 7;
      const resolved = await resolveTokenId(parsed.data.token);
      if (!resolved) return { content: [{ type: "text", text: `Token not found: "${parsed.data.token}". Try a symbol like "ETH" or a full name.` }], isError: true };
      const { id, symbol: sym } = resolved;

      const [ohlc, current] = await Promise.all([
        cgFetch(`/coins/${id}/ohlc?vs_currency=usd&days=${days}`),
        cgFetch(`/coins/markets?vs_currency=usd&ids=${id}&sparkline=false&price_change_percentage=24h`),
      ]);

      const c = current[0];
      const candles: [number, number, number, number, number][] = ohlc ?? [];

      if (!candles.length) return { content: [{ type: "text", text: `No history data for ${sym}` }], isError: true };

      const first = candles[0];
      const last = candles[candles.length - 1];
      const openPrice = first[1];
      const closePrice = last[4];
      const periodChange = ((closePrice - openPrice) / openPrice) * 100;
      const highs = candles.map(c => c[2]);
      const lows = candles.map(c => c[3]);
      const periodHigh = Math.max(...highs);
      const periodLow = Math.min(...lows);

      const lines = [
        `## ${sym} — ${days}d History`,
        ``,
        `**Current:** ${fmtPrice(c?.current_price)} (${(c?.price_change_percentage_24h ?? 0) >= 0 ? "+" : ""}${fmt(c?.price_change_percentage_24h)}% 24h)`,
        `**Period open:** ${fmtPrice(openPrice)}`,
        `**Period close:** ${fmtPrice(closePrice)} (${periodChange >= 0 ? "+" : ""}${fmt(periodChange)}% over ${days}d)`,
        `**${days}d High:** ${fmtPrice(periodHigh)}`,
        `**${days}d Low:** ${fmtPrice(periodLow)}`,
        `**Range:** ${fmt((periodHigh - periodLow) / periodLow * 100)}% spread`,
        ``,
        `**Last 10 candles (OHLC):**`,
        `| Date | Open | High | Low | Close |`,
        `|------|------|------|-----|-------|`,
        ...candles.slice(-10).map(([ts, o, h, l, cl]) => {
          const d = new Date(ts).toISOString().slice(0, 10);
          return `| ${d} | ${fmtPrice(o)} | ${fmtPrice(h)} | ${fmtPrice(l)} | ${fmtPrice(cl)} |`;
        }),
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    default:
      return null;
  }
}
