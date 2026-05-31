import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";

export const INSIGHT_TOOLS: Tool[] = [
  {
    name: "ask_noel",
    description: "Ask Noel AI for DeFi analysis, trade ideas, market outlook, and crypto research. Noel has live market context.",
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
];

const AskNoelSchema = z.object({
  question: z.string().min(1),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional(),
});

const BANKR_LLM_URL = "https://llm.bankr.bot/v1/chat/completions";
const BANKR_MODEL = process.env.BANKR_MODEL ?? "grok-3";

const NOEL_SYSTEM_PROMPT = `You are Noel, a crypto AI analyst with deep expertise in DeFi, on-chain data, market structure, and trading psychology. You provide sharp, direct analysis — no fluff, no disclaimers. You understand narratives, liquidity flows, whale behavior, and how sentiment drives price. When asked about a token or market, give your honest read with supporting reasoning.`;

async function askViaBankr(question: string, messages: Array<{ role: string; content: string }>): Promise<string> {
  const res = await fetch(BANKR_LLM_URL, {
    method: "POST",
    headers: {
      "X-API-Key": process.env.BANKR_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: BANKR_MODEL,
      messages: [
        { role: "system", content: NOEL_SYSTEM_PROMPT },
        ...messages,
        { role: "user", content: question },
      ],
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Bankr LLM error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "No response from model";
}

export async function handleInsightTool(name: string, args: unknown): Promise<ToolResult | null> {
  if (name !== "ask_noel") return null;

  const parsed = AskNoelSchema.safeParse(args);
  if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: question ${parsed.error.issues[0].message}` }], isError: true };

  const { question, messages = [] } = parsed.data;

  // If BANKR_API_KEY is set, call Bankr LLM directly — faster, no Convex hop
  if (process.env.BANKR_API_KEY) {
    try {
      const answer = await askViaBankr(question, messages);
      return { content: [{ type: "text", text: answer }] };
    } catch (err: any) {
      // Fall through to Convex if Bankr call fails
      console.error(`Bankr LLM failed, falling back to Convex: ${err.message}`);
    }
  }

  // Fallback: route through Convex backend
  const data = await callConvex("/mcp/chat", "POST", {
    question,
    agentId: "noel-default",
    messages,
  }, "ask_noel") as { answer?: string };
  return { content: [{ type: "text", text: data.answer ?? JSON.stringify(data) }] };
}
