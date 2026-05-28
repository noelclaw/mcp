import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";

export const RESEARCH_TOOLS: Tool[] = [];

export async function handleResearchTool(_name: string, _args: unknown): Promise<ToolResult | null> {
  return null;
}
