import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";

export const RESEARCH_TOOLS: Tool[] = [
  {
    name: "research",
    description: "Research any crypto topic on demand — like Perplexity but for crypto. Ask about a token, protocol, market event, or trend. Noel searches the web and returns a structured analysis.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Topic to research" } },
      required: ["query"],
    },
  },
];

const ResearchSchema = z.object({ query: z.string().min(1) });

export async function handleResearchTool(name: string, args: unknown): Promise<ToolResult | null> {
  if (name !== "research") return null;
  const parsed = ResearchSchema.safeParse(args);
  if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: query ${parsed.error.issues[0].message}` }], isError: true };
  const data = await callConvex("/mcp/research", "POST", { query: parsed.data.query }, "research");
  if (!data.success) return { content: [{ type: "text", text: `Research failed: ${data.error ?? "unknown error"}` }] };
  return { content: [{ type: "text", text: data.text ?? "No results returned." }] };
}
