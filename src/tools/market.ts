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
];

const GetMarketDataSchema = z.object({ token: z.string().optional() });
const GetTokenDataSchema = z.object({ question: z.string().min(1) });

export async function handleMarketTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "get_market_data": {
      const parsed = GetMarketDataSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

      const { token } = parsed.data;

      if (token) {
        const sym = token.toUpperCase();
        const id = SYMBOL_TO_ID[sym];
        if (!id) return { content: [{ type: "text", text: `Unknown token: ${sym}. Try get_token_data for specific lookup.` }], isError: true };
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

      const q = parsed.data.question.toUpperCase();
      const sym = Object.keys(SYMBOL_TO_ID).find((s) => new RegExp(`\\b${s}\\b`).test(q)) ?? "BTC";
      const id = SYMBOL_TO_ID[sym];

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

    default:
      return null;
  }
}
