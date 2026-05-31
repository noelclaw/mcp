import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";

export const AGENT_TOOLS: Tool[] = [
  {
    name: "list_agents",
    description: "List all available specialist agents you can hire — built-in experts (analyst, risk-manager, researcher, executor, scout) plus any community-published agents.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "hire_agent",
    description: "Hire a specialist agent to complete a task. The agent runs immediately with its own expertise and returns a focused analysis or execution plan. Use list_agents first to see what's available.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "Agent ID from list_agents. Built-in: analyst, risk-manager, researcher, executor, scout. Or a custom agent ID.",
        },
        task: {
          type: "string",
          description: "The task or question for the agent. Be specific — better input = better output.",
        },
        maxTokens: {
          type: "number",
          description: "Max response tokens (default 800, max 1200). Lower is faster and cheaper.",
        },
      },
      required: ["agentId", "task"],
    },
  },
];

const HireAgentSchema = z.object({
  agentId:   z.string().min(1),
  task:      z.string().min(1),
  maxTokens: z.number().int().min(100).max(1200).optional(),
});

export async function handleAgentTool(name: string, args: unknown): Promise<ToolResult | null> {
  if (name === "list_agents") {
    const data = await callConvex("/agents/list", "GET", undefined, "list_agents") as { agents?: Array<{
      id: string; name: string; description: string; category: string; pricingType: string; runs: number | null;
    }> };
    const agents = data.agents ?? [];

    const lines = agents.map((a) => {
      const badge = a.pricingType === "free" ? "free" : "token-based";
      const runs = a.runs != null ? ` · ${a.runs} runs` : "";
      return `**${a.name}** (\`${a.id}\`) [${badge}${runs}]\n  ${a.description}`;
    });

    return {
      content: [{
        type: "text",
        text: `## Available Agents (${agents.length})\n\n${lines.join("\n\n")}`,
      }],
    };
  }

  if (name === "hire_agent") {
    const parsed = HireAgentSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }],
        isError: true,
      };
    }

    const { agentId, task, maxTokens } = parsed.data;
    const data = await callConvex("/agents/hire", "POST", { agentId, task, maxTokens }, "hire_agent") as {
      agent?: string; task?: string; result?: string; tokensUsed?: number; error?: string;
    };

    if (data.error) {
      return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
    }

    const footer = data.tokensUsed ? `\n\n*Tokens used: ${data.tokensUsed}*` : "";
    return {
      content: [{
        type: "text",
        text: `## ${data.agent ?? agentId} — Response\n\n${data.result}${footer}`,
      }],
    };
  }

  return null;
}
