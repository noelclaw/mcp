import { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export type { Tool };
