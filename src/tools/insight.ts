import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";

export const INSIGHT_TOOLS: Tool[] = [
  {
    name: "get_insight",
    description: "Get Noel's daily crypto + macro insight. Covers Bitcoin/ETH price action, macro events, trending narratives on X/Twitter, and one actionable takeaway.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
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

export async function handleInsightTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "get_insight": {
      const data = await callConvex("/insights/now", "GET", undefined, "get_insight");
      const insight = data.insight ?? data.text ?? data.choices?.[0]?.message?.content ?? "Failed to get insight";
      return { content: [{ type: "text", text: insight }] };
    }

    case "ask_noel": {
      const parsed = AskNoelSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: question ${parsed.error.issues[0].message}` }], isError: true };
      const data = await callConvex("/mcp/chat", "POST", {
        question: parsed.data.question,
        agentId: "noel-default",
        messages: parsed.data.messages ?? [],
      }, "ask_noel");
      return { content: [{ type: "text", text: data.answer ?? JSON.stringify(data) }] };
    }

    default:
      return null;
  }
}
