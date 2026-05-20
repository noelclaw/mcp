import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";

export const MARKET_TOOLS: Tool[] = [
  {
    name: "get_market_data",
    description: "Get live crypto market data: top 20 coins by market cap, trending coins, and key prices for BTC/ETH/SOL. Results are also sent to your Telegram if configured.",
    inputSchema: {
      type: "object",
      properties: { token: { type: "string", description: "Optional: specific token to focus on, e.g. 'BTC', 'ETH'" } },
      required: [],
    },
  },
  {
    name: "get_token_data",
    description: "Get market data for specific tokens. Returns price, 24h change, market cap, and volume. Results are sent to your Telegram if configured.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "Describe which tokens to look up" } },
      required: ["question"],
    },
  },
  {
    name: "get_latest_signal",
    description: "Get the latest BTC and/or ETH 1H trading signals from Noel. Includes entry price, take profit targets, stop loss, confidence score, and reasoning. Generated daily at 08:00 UTC.",
    inputSchema: {
      type: "object",
      properties: { token: { type: "string", description: "Token to get signal for: 'BTC', 'ETH', or omit for both" } },
      required: [],
    },
  },
  {
    name: "get_signal_history",
    description: "Get signal history with win/loss record and winrate statistics.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "BTC or ETH" },
        days: { type: "number", description: "Number of days to look back (default: 7)" },
      },
      required: [],
    },
  },
  {
    name: "get_smart_money_alerts",
    description: "Get smart money and insider wallet movements for micro-cap tokens.",
    inputSchema: {
      type: "object",
      properties: { hours: { type: "number", description: "How many hours back to look (default: 24)" } },
      required: [],
    },
  },
  {
    name: "get_daily_recap",
    description: "Get today's trading performance recap with winrate, PnL stats, and AI review.",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string", description: "Date in YYYY-MM-DD format (default: today UTC)" } },
      required: [],
    },
  },
];

const GetMarketDataSchema = z.object({ token: z.string().optional() });
const GetTokenDataSchema = z.object({ question: z.string().min(1) });
const GetLatestSignalSchema = z.object({ token: z.string().optional() });
const GetSignalHistorySchema = z.object({ token: z.string().optional(), days: z.number().optional() });
const GetSmartMoneyAlertsSchema = z.object({ hours: z.number().optional() });
const GetDailyRecapSchema = z.object({ date: z.string().optional() });

export async function handleMarketTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "get_market_data": {
      const parsed = GetMarketDataSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: token ${parsed.error.issues[0].message}` }], isError: true };
      const { token } = parsed.data;
      const tokenQ = token ? `?token=${encodeURIComponent(token)}` : "";
      const data = await callConvex(`/mcp/market${tokenQ}`, "GET", undefined, "get_market_data");
      const lines: string[] = [`**Market Data** — ${data.fetchedAt ?? new Date().toISOString()}`, ""];
      if (data.keyPrices) {
        lines.push("**Key Prices**");
        for (const [coin, info] of Object.entries(data.keyPrices as Record<string, any>)) {
          const price = (info as any).usd?.toLocaleString("en-US", { style: "currency", currency: "USD" });
          const change = (info as any).usd_24h_change?.toFixed(2);
          const sign = ((info as any).usd_24h_change ?? 0) >= 0 ? "+" : "";
          lines.push(`• ${coin.toUpperCase()}: ${price} (${sign}${change}%)`);
        }
        lines.push("");
      }
      if (data.trending?.length) {
        lines.push("**Trending** (top 10)");
        for (const c of data.trending) {
          const ch = c.change24h?.toFixed(2);
          const sign = (c.change24h ?? 0) >= 0 ? "+" : "";
          lines.push(`• ${c.name} (${c.symbol?.toUpperCase()}) — rank #${c.rank ?? "?"} ${ch != null ? `${sign}${ch}%` : ""}`);
        }
        lines.push("");
      }
      if (data.top20?.length) {
        lines.push("**Top 20 by Market Cap**");
        lines.push("| # | Name | Price | 24h% |");
        lines.push("|---|------|-------|------|");
        for (const c of data.top20) {
          const price = c.price?.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
          const ch = c.change24h?.toFixed(2);
          const sign = (c.change24h ?? 0) >= 0 ? "+" : "";
          lines.push(`| ${c.rank} | ${c.name} (${c.symbol?.toUpperCase()}) | ${price} | ${sign}${ch}% |`);
        }
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "get_token_data": {
      const parsed = GetTokenDataSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: question ${parsed.error.issues[0].message}` }], isError: true };
      const data = await callConvex("/mcp/chat", "POST", {
        question: parsed.data.question,
        agentId: "coingecko-default",
        messages: [],
      }, "get_token_data");
      return { content: [{ type: "text", text: data.answer ?? JSON.stringify(data) }] };
    }

    case "get_latest_signal": {
      const parsed = GetLatestSignalSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: token ${parsed.error.issues[0].message}` }], isError: true };
      const tokenParam = parsed.data.token?.toUpperCase() ?? "both";
      const data = await callConvex(
        `/signals/latest${tokenParam !== "BOTH" && tokenParam !== "both" ? `?token=${encodeURIComponent(tokenParam)}` : ""}`,
        "GET", undefined, "get_latest_signal"
      );
      const lines: string[] = ["**Latest Noel Signals**", ""];
      for (const [tok, sig] of Object.entries(data as Record<string, any>)) {
        if (!sig) { lines.push(`**${tok}:** No signal available`, ""); continue; }
        const emoji = (sig as any).signalType === "BUY" ? "🟢" : (sig as any).signalType === "SELL" ? "🔴" : "🟡";
        lines.push(
          `${emoji} **${tok}/USD — ${(sig as any).signalType}**`,
          `Entry: $${(sig as any).entryPrice?.toLocaleString()} | TP1: $${(sig as any).target1?.toLocaleString()}${(sig as any).target2 ? ` | TP2: $${(sig as any).target2?.toLocaleString()}` : ""} | SL: $${(sig as any).stopLoss?.toLocaleString()}`,
          `Confidence: ${(sig as any).confidence}% | Status: ${(sig as any).status}`,
          `📝 ${(sig as any).reasoning}`,
          "",
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "get_signal_history": {
      const parsed = GetSignalHistorySchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${String(parsed.error.issues[0].path[0])} ${parsed.error.issues[0].message}` }], isError: true };
      const token = parsed.data.token?.toUpperCase() ?? "BTC";
      const days = parsed.data.days ?? 7;
      const [hist, wr] = await Promise.all([
        callConvex(`/signals/history?token=${token}&days=${days}`, "GET", undefined, "get_signal_history"),
        callConvex(`/signals/winrate?token=${token}&days=${days}`, "GET", undefined, "get_signal_history"),
      ]);
      const lines: string[] = [
        `**${token} Signal History — Last ${days} days**`,
        `Total: ${wr.total} resolved | Wins: ${wr.wins} | Losses: ${wr.losses}`,
        `Winrate: ${wr.winrate}% | Avg PnL: ${Number(wr.avgPnl) >= 0 ? "+" : ""}${wr.avgPnl}%`,
        `Best: +${wr.bestPnl}% | Worst: ${wr.worstPnl}%`,
        "", "**Recent Signals:**",
      ];
      for (const sig of (hist.signals ?? []).slice(0, 5)) {
        const emoji = sig.signalType === "BUY" ? "🟢" : sig.signalType === "SELL" ? "🔴" : "🟡";
        const outcome = sig.isWin === true ? "✅" : sig.isWin === false ? "❌" : "⏳";
        const pnl = sig.pnlPercent != null ? ` (${sig.pnlPercent >= 0 ? "+" : ""}${sig.pnlPercent.toFixed(2)}%)` : "";
        lines.push(`${emoji} ${sig.token} ${sig.signalType} @ $${sig.entryPrice?.toLocaleString()} — ${outcome} ${sig.status}${pnl}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "get_smart_money_alerts": {
      const parsed = GetSmartMoneyAlertsSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: hours ${parsed.error.issues[0].message}` }], isError: true };
      const hours = parsed.data.hours ?? 24;
      const data = await callConvex(`/whales/latest?hours=${hours}`, "GET", undefined, "get_smart_money_alerts");
      if (!data.count) return { content: [{ type: "text", text: `No whale alerts in the last ${hours}h.` }] };
      const lines: string[] = [`**Whale Alerts — Last ${hours}h** (${data.count} total)`, ""];
      for (const alert of (data.alerts ?? []).slice(0, 5)) {
        const sig = alert.significance === "HIGH" ? "🔴" : "🟡";
        lines.push(`${sig} **${alert.token} | ${alert.direction}**`, `${alert.description}`, `💡 ${alert.implication}`, "");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "get_daily_recap": {
      const parsed = GetDailyRecapSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: date ${parsed.error.issues[0].message}` }], isError: true };
      const date = parsed.data.date ?? new Date().toISOString().slice(0, 10);
      let data: any;
      try {
        data = await callConvex("/recap/today", "GET", undefined, "get_daily_recap");
      } catch {
        return { content: [{ type: "text", text: `No recap available for ${date}` }] };
      }
      if (data.error) return { content: [{ type: "text", text: data.error }] };
      const lines: string[] = [
        `**Noel Daily Recap — ${data.date ?? date}**`, "",
        `₿ **BTC** — ${data.btcWins}W / ${data.btcLosses}L | Winrate: ${data.btcWinrate?.toFixed(1)}%`,
        `Best: +${data.btcBestPnl?.toFixed(2)}% | Worst: ${data.btcWorstPnl?.toFixed(2)}%`, "",
        `Ξ **ETH** — ${data.ethWins}W / ${data.ethLosses}L | Winrate: ${data.ethWinrate?.toFixed(1)}%`,
        `Best: +${data.ethBestPnl?.toFixed(2)}% | Worst: ${data.ethWorstPnl?.toFixed(2)}%`, "",
        `**Overall:** ${data.totalWinrate?.toFixed(1)}% winrate | Avg PnL: ${Number(data.avgPnl) >= 0 ? "+" : ""}${data.avgPnl?.toFixed(2)}% per signal`, "",
        `🤖 AI Review:`, data.aiReview ?? "No review",
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    default:
      return null;
  }
}
