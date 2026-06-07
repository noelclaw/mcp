import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { callLLM } from "../llm.js";
import { ToolResult } from "../types.js";
import { searchSupermemory } from "./memory.js";

export const INSIGHT_TOOLS: Tool[] = [
  {
    name: "ask_noel",
    description: "Ask Noel anything — analysis, opinions, explanations, strategy, or ideas. Noel loads your saved memory to personalize every answer. Use for: research questions, content ideas, code explanations, decision-making, DeFi analysis, trade ideas, or just thinking out loud. Pass previous messages to continue a conversation across tool calls.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Your question or request for Noel" },
        messages: {
          type: "array",
          description: "Previous conversation messages for context (optional)",
          items: {
            type: "object",
            properties: { role: { type: "string", enum: ["user", "assistant"] }, content: { type: "string" } },
            required: ["role", "content"],
          },
        },
      },
      required: ["question"],
    },
  },
  {
    name: "market_thesis",
    description:
      "Generate a structured bull vs bear thesis for any token or market topic. " +
      "Noel fetches live price/market data then writes a sharp, two-sided analysis: " +
      "bull case (catalysts, narratives, technicals), bear case (risks, headwinds, red flags), " +
      "and a net verdict with conviction score 0–10. " +
      "Use before opening a position or for research on a token you're watching.",
    inputSchema: {
      type: "object",
      properties: {
        token:   { type: "string", description: "Token symbol or CoinGecko ID, e.g. 'ETH', 'bitcoin', 'AERO'" },
        context: { type: "string", description: "Optional: extra context — your time horizon, thesis seed, or specific concerns" },
      },
      required: ["token"],
    },
  },
  {
    name: "trade_plan",
    description:
      "Build a structured trade plan for any token: entry zone, stop loss, take profit levels, " +
      "position size recommendation (as % of portfolio), and risk/reward ratio. " +
      "Based on live price data + Noel's market reading. Returns a ready-to-act plan, not vague advice.",
    inputSchema: {
      type: "object",
      properties: {
        token:          { type: "string", description: "Token symbol or CoinGecko ID" },
        side:           { type: "string", enum: ["long", "short"], description: "Trade direction (default: long)" },
        portfolioSize:  { type: "number", description: "Optional: your portfolio size in USD (for position sizing)" },
        riskTolerance:  { type: "string", enum: ["conservative", "moderate", "aggressive"], description: "Risk profile (default: moderate)" },
        timeframe:      { type: "string", description: "Optional: trade timeframe, e.g. 'intraday', 'swing', 'weeks'" },
      },
      required: ["token"],
    },
  },
];

const AskNoelSchema = z.object({
  question: z.string().min(1),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional(),
});

const MarketThesisSchema = z.object({
  token:   z.string().min(1),
  context: z.string().optional(),
});

const TradePlanSchema = z.object({
  token:         z.string().min(1),
  side:          z.enum(["long", "short"]).optional(),
  portfolioSize: z.number().positive().optional(),
  riskTolerance: z.enum(["conservative", "moderate", "aggressive"]).optional(),
  timeframe:     z.string().optional(),
});

const NOEL_BASE_PROMPT = `You are Noel, the core intelligence of the Noelclaw AI Operating System — an AI built to research, analyze, and execute across any domain. You are direct, sharp, and thorough. You draw on 82 tools covering persistent memory, multi-agent research, web search, workflow automation, code, and DeFi on Base. When asked anything, give your honest read backed by real reasoning. No filler, no disclaimers.`;

async function buildSystemPrompt(question: string): Promise<string> {
  const memories = await searchSupermemory(question, 5);
  if (!memories.length) return NOEL_BASE_PROMPT;

  const memBlock = memories
    .map(r => {
      const title = r.metadata?.title ? `[${r.metadata.title}] ` : "";
      return `- ${title}${r.content.slice(0, 250).replace(/\n/g, " ")}`;
    })
    .join("\n");

  return `${NOEL_BASE_PROMPT}\n\n<user_memory>\nThe following is stored knowledge about this user — use it to personalize your response:\n${memBlock}\n</user_memory>`;
}

async function fetchCgPrice(token: string): Promise<{ price: number; change24h: number; mcap: number; symbol: string } | null> {
  try {
    const id = token.toLowerCase().replace(/ /g, "-");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${id}&order=market_cap_desc&per_page=1&page=1`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as any[];
    const coin = data[0];
    if (!coin) return null;
    return {
      price:    coin.current_price ?? 0,
      change24h: coin.price_change_percentage_24h ?? 0,
      mcap:     coin.market_cap ?? 0,
      symbol:   coin.symbol?.toUpperCase() ?? token.toUpperCase(),
    };
  } catch {
    return null;
  }
}

export async function handleInsightTool(name: string, args: unknown): Promise<ToolResult | null> {
  if (name === "ask_noel") {
    const parsed = AskNoelSchema.safeParse(args);
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: question ${parsed.error.issues[0].message}` }], isError: true };

    const { question, messages = [] } = parsed.data;

    const systemPrompt = await buildSystemPrompt(question);

    if (process.env.BANKR_API_KEY || process.env.ANTHROPIC_API_KEY) {
      try {
        const history = messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
        const answer = await callLLM(systemPrompt, question, 1024, history);
        callConvex("/memory/add", "POST", {
          content: `Q: ${question.slice(0, 200)}\nA: ${answer.slice(0, 400)}`,
        }, "ask_noel_memory").catch(() => {});
        return { content: [{ type: "text", text: answer }] };
      } catch (err: any) {
        // fall through to Convex
      }
    }

    const data = await callConvex("/mcp/chat", "POST", {
      question,
      agentId: "noel-default",
      messages,
      systemPrompt,
    }, "ask_noel") as { answer?: string };
    const answer = data.answer ?? JSON.stringify(data);
    callConvex("/memory/add", "POST", {
      content: `Q: ${question.slice(0, 200)}\nA: ${answer.slice(0, 400)}`,
    }, "ask_noel_memory").catch(() => {});
    return { content: [{ type: "text", text: answer }] };
  }

  if (name === "market_thesis") {
    const parsed = MarketThesisSchema.safeParse(args);
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

    const { token, context } = parsed.data;
    const priceData = await fetchCgPrice(token);

    const dataCtx = priceData
      ? `Current price: $${priceData.price.toLocaleString()} | 24h: ${priceData.change24h.toFixed(1)}% | Mcap: $${(priceData.mcap / 1_000_000).toFixed(0)}M`
      : `(live price data unavailable — use general knowledge)`;

    const prompt = [
      `Write a structured bull vs bear thesis for ${token.toUpperCase()}.`,
      ``,
      `Live market data: ${dataCtx}`,
      context ? `User context: ${context}` : "",
      ``,
      `Output format (use exactly these headers):`,
      `## ${token.toUpperCase()} Thesis`,
      `**Current price:** [price] | **24h:** [change]`,
      ``,
      `### Bull Case`,
      `(3-5 specific catalysts, narratives, or technical factors that support upside. Be concrete — no vague "adoption" claims.)`,
      ``,
      `### Bear Case`,
      `(3-5 specific risks, headwinds, or red flags. Include on-chain, macro, and competitive risks if applicable.)`,
      ``,
      `### Net Verdict`,
      `**Conviction:** X/10`,
      `(2-3 sentences: the deciding factor, the key risk to watch, and your net lean.)`,
    ].filter(Boolean).join("\n");

    try {
      const systemPrompt = await buildSystemPrompt(`${token} ${context ?? ""}`);
      const answer = await callLLM(systemPrompt, prompt, 1200);
      const date = new Date().toISOString().slice(0, 10);
      callConvex("/vault/save", "POST", {
        type: "research",
        title: `${token.toUpperCase()} Thesis — ${date}`,
        content: answer,
        key: `thesis/${token.toLowerCase()}-${date}`,
        agentId: "noel",
        tags: ["thesis", token.toLowerCase()],
        commitMsg: "market_thesis auto-save",
      }, "vault_save").catch(() => {});
      const suggest = process.env.TRIGGER_SECRET_KEY
        ? `\n\n---\n💡 Want to stay on top of this? Use \`create_monitor\` to get automatic research briefings on ${token.toUpperCase()} delivered on a schedule — no prompting needed.`
        : "";
      return { content: [{ type: "text", text: answer + suggest }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `market_thesis error: ${err.message}` }], isError: true };
    }
  }

  if (name === "trade_plan") {
    const parsed = TradePlanSchema.safeParse(args);
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

    const { token, side = "long", portfolioSize, riskTolerance = "moderate", timeframe } = parsed.data;
    const priceData = await fetchCgPrice(token);

    const dataCtx = priceData
      ? `Current price: $${priceData.price.toLocaleString()} | 24h: ${priceData.change24h.toFixed(1)}% | Mcap: $${(priceData.mcap / 1_000_000).toFixed(0)}M`
      : `(live price data unavailable)`;

    const riskPcts: Record<string, string> = {
      conservative: "1-2% of portfolio",
      moderate:     "2-5% of portfolio",
      aggressive:   "5-10% of portfolio",
    };

    const prompt = [
      `Build a structured ${side.toUpperCase()} trade plan for ${token.toUpperCase()}.`,
      ``,
      `Live data: ${dataCtx}`,
      `Risk tolerance: ${riskTolerance} (max position size: ${riskPcts[riskTolerance]})`,
      portfolioSize ? `Portfolio size: $${portfolioSize.toLocaleString()}` : "",
      timeframe ? `Timeframe: ${timeframe}` : "",
      ``,
      `Output exactly this format:`,
      `## Trade Plan: ${token.toUpperCase()} ${side.toUpperCase()}`,
      ``,
      `**Direction:** ${side.toUpperCase()}`,
      `**Timeframe:** [fill]`,
      ``,
      `### Entry`,
      `- Ideal entry: $[price or range]`,
      `- Entry condition: [what must happen / trigger]`,
      ``,
      `### Risk Management`,
      `- Stop loss: $[price] ([%] below/above entry)`,
      `- Position size: [% of portfolio]${portfolioSize ? ` = $[USD amount]` : ""}`,
      `- Max loss: [% of portfolio]`,
      ``,
      `### Targets`,
      `- TP1: $[price] ([%] gain) — partial exit [%]`,
      `- TP2: $[price] ([%] gain) — partial exit [%]`,
      `- TP3: $[price] ([%] gain) — final exit`,
      ``,
      `### Risk/Reward`,
      `- RR ratio: [X:1]`,
      `- Expected value: [+/- %]`,
      ``,
      `### Thesis in One Sentence`,
      `[Why this trade makes sense right now]`,
      ``,
      `### Invalidation`,
      `[Exactly what would make you exit early / kill the thesis]`,
    ].filter(Boolean).join("\n");

    try {
      const systemPrompt = await buildSystemPrompt(`${token} trade ${riskTolerance} ${timeframe ?? ""}`);
      const answer = await callLLM(systemPrompt, prompt, 1200);
      const date = new Date().toISOString().slice(0, 10);
      callConvex("/vault/save", "POST", {
        type: "execution",
        title: `Trade Plan: ${token.toUpperCase()} ${side.toUpperCase()} — ${date}`,
        content: answer,
        key: `trade-plan/${token.toLowerCase()}-${side}-${date}`,
        agentId: "noel",
        tags: ["trade-plan", token.toLowerCase(), side],
        commitMsg: "trade_plan auto-save",
      }, "vault_save").catch(() => {});
      const suggest = process.env.TRIGGER_SECRET_KEY
        ? `\n\n---\n💡 Want to stay on top of this? Use \`create_monitor\` to get automatic research briefings on ${token.toUpperCase()} delivered on a schedule — no prompting needed.`
        : "";
      return { content: [{ type: "text", text: answer + suggest }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `trade_plan error: ${err.message}` }], isError: true };
    }
  }

  return null;
}
