import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";

export const NEWS_TOOLS: Tool[] = [
  {
    name: "get_news",
    description:
      "Get the latest crypto news digest — top stories, market-moving events, " +
      "regulatory updates, and AI-generated sentiment summary. Updated every 12 hours.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of news items to return (default: 10, max: 30)",
        },
      },
      required: [],
    },
  },
  {
    name: "generate_signal",
    description:
      "Manually trigger a fresh BTC and/or ETH trading signal right now — " +
      "instead of waiting for the 08:00 UTC daily cron. " +
      "Uses live market data, RSI, volume, and sentiment.",
    inputSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Token to generate signal for: 'BTC', 'ETH', or omit for both.",
        },
      },
      required: [],
    },
  },
];

const GetNewsSchema = z.object({ limit: z.number().min(1).max(30).optional() });
const GenerateSignalSchema = z.object({ token: z.string().optional() });

export async function handleNewsTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "get_news": {
      const parsed = GetNewsSchema.safeParse(args ?? {});
      if (!parsed.success) {
        return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      }
      const limit = parsed.data.limit ?? 10;
      const data = await callConvex(`/news/latest?limit=${limit}`, "GET", undefined, "get_news");

      const articles: any[] = data.articles ?? data.news ?? data.items ?? [];
      if (!articles.length) {
        return { content: [{ type: "text", text: "No recent news available. Try again shortly." }] };
      }

      const lines: string[] = [
        `**Crypto News Digest** — ${data.fetchedAt ?? data.date ?? new Date().toISOString().slice(0, 10)}`,
        ``,
      ];

      if (data.summary) {
        lines.push(`📊 **Summary:** ${data.summary}`, ``);
      }

      for (const a of articles.slice(0, limit)) {
        const sentiment = a.sentiment === "bullish" ? "🟢" : a.sentiment === "bearish" ? "🔴" : "⚪";
        lines.push(`${sentiment} **${a.title ?? a.headline ?? "Untitled"}**`);
        if (a.source) lines.push(`   _${a.source}${a.publishedAt ? ` · ${a.publishedAt}` : ""}_`);
        if (a.summary ?? a.description) lines.push(`   ${(a.summary ?? a.description ?? "").slice(0, 140)}…`);
        if (a.affectedTokens?.length) lines.push(`   Tokens: ${a.affectedTokens.join(", ")}`);
        lines.push(``);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "generate_signal": {
      const parsed = GenerateSignalSchema.safeParse(args ?? {});
      if (!parsed.success) {
        return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      }
      const token = parsed.data.token?.toUpperCase();
      const data = await callConvex("/signals/generate", "POST", { token }, "generate_signal");

      if (data.error) {
        return { content: [{ type: "text", text: `Signal generation failed: ${data.error}` }], isError: true };
      }

      const signals: any[] = data.signals ?? (data.signal ? [data.signal] : []);
      if (!signals.length) {
        return { content: [{ type: "text", text: "Signal generated. Use get_latest_signal to retrieve it." }] };
      }

      const lines: string[] = [`**Fresh Signals Generated**`, ``];
      for (const sig of signals) {
        const emoji = sig.signalType === "BUY" ? "🟢" : sig.signalType === "SELL" ? "🔴" : "🟡";
        lines.push(
          `${emoji} **${sig.token}/USD — ${sig.signalType}**`,
          `Entry: $${sig.entryPrice?.toLocaleString()} | TP1: $${sig.target1?.toLocaleString()}${sig.target2 ? ` | TP2: $${sig.target2?.toLocaleString()}` : ""} | SL: $${sig.stopLoss?.toLocaleString()}`,
          `Confidence: ${sig.confidence}% | Timeframe: 1H`,
          `📝 ${sig.reasoning}`,
          ``,
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    default:
      return null;
  }
}
