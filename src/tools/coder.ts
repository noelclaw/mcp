import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callLLM } from "../llm.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const CODER_SYSTEM = `You are Noel Coder — an expert software engineer embedded in the Noelclaw AI OS on Base chain.
You specialize in:
- Solidity smart contracts (ERC-20, ERC-721, DeFi hooks, Uniswap v3/v4 integrations)
- TypeScript / React / Next.js frontend development
- Convex backend (functions, schema, mutations, queries)
- MCP (Model Context Protocol) server tools in TypeScript
- Base chain ecosystem: 0x Protocol, Uniswap v3, ethers v6, wagmi v2

Rules:
- Output clean, production-ready code. No placeholders.
- Add brief inline comments only where logic is non-obvious.
- For smart contracts: always include NatSpec, SPDX license, pragma.
- For React: use TypeScript, functional components, Tailwind CSS.
- For MCP tools: follow the Noelclaw pattern (Zod schema, handler returns ToolResult | null).
- Never include secrets or private keys in output.`;

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const CODER_TOOLS: Tool[] = [
  {
    name: "scaffold_project",
    description:
      "Generate a complete project scaffold for a described idea — file tree + key file contents. " +
      "Supports: Solidity contract projects, MCP skill packages, React/Next.js dApps, Convex backends, CLI tools.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "What to build — be specific: tech stack, purpose, target chain, key features",
        },
        stack: {
          type: "string",
          enum: ["solidity", "mcp-skill", "react-dapp", "convex-backend", "node-cli", "auto"],
          description: "Tech stack. Use 'auto' to let Noel decide based on description.",
        },
        extras: {
          type: "string",
          description: "Optional: extra requirements, constraints, or preferred libraries",
        },
      },
      required: ["description"],
    },
  },

  {
    name: "generate_component",
    description:
      "Generate a production-ready React/TypeScript component. Returns the full .tsx file content. " +
      "Includes props typing, Tailwind styling, and any hooks needed.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "What the component does, what it shows, and how it should behave",
        },
        name: {
          type: "string",
          description: "Component name in PascalCase, e.g. 'TokenPriceCard'",
        },
        context: {
          type: "string",
          description: "Optional: existing imports, store usage, or API calls the component should use",
        },
      },
      required: ["description", "name"],
    },
  },

  {
    name: "generate_contract",
    description:
      "Generate a Solidity smart contract from a description. Returns the full .sol file. " +
      "Follows OpenZeppelin patterns, includes NatSpec, and is Base/EVM compatible.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "What the contract does — token type, mechanics, access control, any special logic",
        },
        name: {
          type: "string",
          description: "Contract name in PascalCase, e.g. 'NoelRewards'",
        },
        features: {
          type: "array",
          items: { type: "string" },
          description: "Optional: specific features to include, e.g. ['ERC-20', 'burnable', 'pausable', 'ownable']",
        },
      },
      required: ["description", "name"],
    },
  },

  {
    name: "audit_contract",
    description:
      "Audit a Solidity smart contract for security vulnerabilities, gas inefficiencies, and logic bugs. " +
      "Returns a structured report with severity ratings and fix recommendations.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The full Solidity contract source code to audit",
        },
        focus: {
          type: "array",
          items: { type: "string" },
          description: "Optional: specific areas to focus on, e.g. ['reentrancy', 'access control', 'overflow']",
        },
      },
      required: ["code"],
    },
  },

  {
    name: "explain_code",
    description:
      "Explain what a piece of code does in plain language. Works with Solidity, TypeScript, JavaScript, Python, and more. " +
      "Breaks down logic, highlights key patterns, and explains the 'why' behind decisions.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The code to explain",
        },
        depth: {
          type: "string",
          enum: ["overview", "detailed", "line-by-line"],
          description: "How detailed the explanation should be. Default: 'detailed'",
        },
      },
      required: ["code"],
    },
  },

  {
    name: "generate_mcp_skill",
    description:
      "Generate a complete Claude Code skill (.md file) from a description. " +
      "Skills are slash-command workflows that run inside Claude Code — they can call tools, " +
      "loop, delegate to subagents, and have persistent behavior. " +
      "Returns a ready-to-use .md file you can drop into your .claude/skills/ directory. " +
      "Use this to automate repetitive Claude Code workflows without writing TypeScript.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "What the skill should do — be specific about inputs, outputs, and any tools it should use",
        },
        name: {
          type: "string",
          description: "Skill name in kebab-case, e.g. 'daily-standup', 'code-review', 'deploy-check'",
        },
        tools: {
          type: "array",
          items: { type: "string" },
          description: "Optional: list of Claude Code tools or MCP tools the skill should use, e.g. ['Bash', 'Read', 'memory_search']",
        },
      },
      required: ["description", "name"],
    },
  },

  {
    name: "review_code",
    description:
      "Review and improve a piece of code. Returns the improved version with a summary of changes. " +
      "Fixes bugs, improves readability, adds types, optimizes gas (for Solidity), and removes anti-patterns.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The code to review and improve",
        },
        language: {
          type: "string",
          description: "Language/framework, e.g. 'solidity', 'typescript', 'react', 'python'. Auto-detected if omitted.",
        },
        goals: {
          type: "string",
          description: "Optional: specific improvement goals, e.g. 'reduce gas costs', 'improve readability', 'add error handling'",
        },
      },
      required: ["code"],
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

const ScaffoldSchema = z.object({
  description: z.string().min(10),
  stack: z.enum(["solidity", "mcp-skill", "react-dapp", "convex-backend", "node-cli", "auto"]).optional(),
  extras: z.string().optional(),
});

const ComponentSchema = z.object({
  description: z.string().min(5),
  name: z.string().min(1),
  context: z.string().optional(),
});

const ContractSchema = z.object({
  description: z.string().min(5),
  name: z.string().min(1),
  features: z.array(z.string()).optional(),
});

const AuditSchema = z.object({
  code: z.string().min(10),
  focus: z.array(z.string()).optional(),
});

const ExplainSchema = z.object({
  code: z.string().min(1),
  depth: z.enum(["overview", "detailed", "line-by-line"]).optional(),
});

const ReviewSchema = z.object({
  code: z.string().min(1),
  language: z.string().optional(),
  goals: z.string().optional(),
});

const McpSkillSchema = z.object({
  description: z.string().min(10),
  name: z.string().min(1).regex(/^[a-z0-9-]+$/, "must be kebab-case"),
  tools: z.array(z.string()).optional(),
});

export async function handleCoderTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {

    case "scaffold_project": {
      const p = ScaffoldSchema.safeParse(args);
      if (!p.success) return err(`Invalid input: ${p.error.message}`);
      const { description, stack = "auto", extras } = p.data;

      const prompt =
        `Generate a complete project scaffold for the following:\n\n` +
        `Description: ${description}\n` +
        `Stack: ${stack}\n` +
        (extras ? `Extra requirements: ${extras}\n` : "") +
        `\nOutput format:\n` +
        `1. Brief overview (2-3 sentences)\n` +
        `2. Full file tree with all files listed\n` +
        `3. Full content of each key file (package.json, main entry, config, one core module)\n` +
        `4. Setup instructions (3-5 steps)\n\n` +
        `Use real, runnable code. No TODO placeholders.`;

      try {
        const response = await callLLM(CODER_SYSTEM, prompt, 4096);
        return ok(response);
      } catch (e: any) {
        return err(`scaffold_project failed: ${e.message}`);
      }
    }

    case "generate_component": {
      const p = ComponentSchema.safeParse(args);
      if (!p.success) return err(`Invalid input: ${p.error.message}`);
      const { description, name: componentName, context } = p.data;

      const prompt =
        `Generate a production-ready React TypeScript component.\n\n` +
        `Component name: ${componentName}\n` +
        `Description: ${description}\n` +
        (context ? `Context / existing code to integrate with:\n${context}\n` : "") +
        `\nRequirements:\n` +
        `- Full .tsx file, no omissions\n` +
        `- TypeScript props interface\n` +
        `- Tailwind CSS for styling\n` +
        `- Use lucide-react for icons if needed\n` +
        `- Framer Motion for animations if the component is interactive\n` +
        `- Named export (not default)\n` +
        `Output only the .tsx file content, no prose before or after.`;

      try {
        const response = await callLLM(CODER_SYSTEM, prompt, 3000);
        return ok(response);
      } catch (e: any) {
        return err(`generate_component failed: ${e.message}`);
      }
    }

    case "generate_contract": {
      const p = ContractSchema.safeParse(args);
      if (!p.success) return err(`Invalid input: ${p.error.message}`);
      const { description, name: contractName, features = [] } = p.data;

      const prompt =
        `Generate a production-ready Solidity smart contract.\n\n` +
        `Contract name: ${contractName}\n` +
        `Description: ${description}\n` +
        (features.length ? `Required features: ${features.join(", ")}\n` : "") +
        `\nRequirements:\n` +
        `- Solidity ^0.8.20\n` +
        `- SPDX-License-Identifier: MIT\n` +
        `- Use OpenZeppelin contracts where appropriate (import paths: @openzeppelin/contracts/...)\n` +
        `- Full NatSpec comments on all public functions\n` +
        `- Optimized for Base chain (EVM compatible)\n` +
        `- Include events for all state changes\n` +
        `- Include a basic test outline as a comment at the bottom\n` +
        `Output only the .sol file content.`;

      try {
        const response = await callLLM(CODER_SYSTEM, prompt, 3500);
        return ok(response);
      } catch (e: any) {
        return err(`generate_contract failed: ${e.message}`);
      }
    }

    case "audit_contract": {
      const p = AuditSchema.safeParse(args);
      if (!p.success) return err(`Invalid input: ${p.error.message}`);
      const { code, focus = [] } = p.data;

      const prompt =
        `Audit the following Solidity smart contract for security vulnerabilities, gas issues, and logic bugs.\n` +
        (focus.length ? `Focus areas: ${focus.join(", ")}\n` : "") +
        `\nContract:\n\`\`\`solidity\n${code}\n\`\`\`\n\n` +
        `Output a structured audit report with these sections:\n` +
        `## Summary\n` +
        `(overall risk rating: Critical/High/Medium/Low/Informational, brief overview)\n\n` +
        `## Findings\n` +
        `For each issue:\n` +
        `- **[SEVERITY]** Title\n` +
        `  - Location: (function/line)\n` +
        `  - Description: (what's wrong and why)\n` +
        `  - Recommendation: (exact fix or mitigation)\n\n` +
        `## Gas Optimizations\n` +
        `(list 2-5 concrete gas savings with estimated impact)\n\n` +
        `## Positive Patterns\n` +
        `(what the contract does well)`;

      try {
        const response = await callLLM(CODER_SYSTEM, prompt, 3000);
        return ok(response);
      } catch (e: any) {
        return err(`audit_contract failed: ${e.message}`);
      }
    }

    case "explain_code": {
      const p = ExplainSchema.safeParse(args);
      if (!p.success) return err(`Invalid input: ${p.error.message}`);
      const { code, depth = "detailed" } = p.data;

      const depthInstructions: Record<string, string> = {
        overview:      "Give a high-level explanation in 3-5 sentences. What does it do, what problem does it solve, what are the main moving parts.",
        detailed:      "Explain the purpose, break down each major section, explain key patterns and design decisions, and note any non-obvious logic.",
        "line-by-line": "Go through the code line by line (or block by block for repetitive parts), explaining exactly what each part does and why.",
      };

      const prompt =
        `Explain the following code.\n\nDepth: ${depth}\n${depthInstructions[depth]}\n\n` +
        `Code:\n\`\`\`\n${code}\n\`\`\`\n\n` +
        `Write in plain language. Assume the reader understands programming but may not know this specific codebase or language.`;

      try {
        const response = await callLLM(CODER_SYSTEM, prompt, 2000);
        return ok(response);
      } catch (e: any) {
        return err(`explain_code failed: ${e.message}`);
      }
    }

    case "review_code": {
      const p = ReviewSchema.safeParse(args);
      if (!p.success) return err(`Invalid input: ${p.error.message}`);
      const { code, language, goals } = p.data;

      const prompt =
        `Review and improve the following code.\n` +
        (language ? `Language/framework: ${language}\n` : "") +
        (goals ? `Improvement goals: ${goals}\n` : "") +
        `\nOriginal code:\n\`\`\`\n${code}\n\`\`\`\n\n` +
        `Output:\n` +
        `## What I changed\n` +
        `(bullet list: each change and why)\n\n` +
        `## Improved code\n` +
        `\`\`\`\n(full improved code — no omissions, no "rest of code unchanged")\n\`\`\`\n\n` +
        `## Further recommendations\n` +
        `(optional: things to consider beyond this snippet)`;

      try {
        const response = await callLLM(CODER_SYSTEM, prompt, 3500);
        return ok(response);
      } catch (e: any) {
        return err(`review_code failed: ${e.message}`);
      }
    }

    case "generate_mcp_skill": {
      const p = McpSkillSchema.safeParse(args);
      if (!p.success) return err(`Invalid input: ${p.error.message}`);
      const { description, name: skillName, tools = [] } = p.data;

      const prompt =
        `Generate a complete Claude Code skill (.md file) for the following workflow:\n\n` +
        `Skill name: /${skillName}\n` +
        `Description: ${description}\n` +
        (tools.length ? `Tools to use: ${tools.join(", ")}\n` : "") +
        `\n` +
        `Claude Code skill format rules:\n` +
        `- The file is a markdown document that serves as a system prompt for a Claude Code slash command\n` +
        `- It should start with a brief description of what the skill does\n` +
        `- Include an "## Input" section explaining what arguments the skill accepts (if any)\n` +
        `- Include a "## Steps" section with numbered, concrete steps\n` +
        `- Include a "## Output" section describing what the skill produces\n` +
        `- Steps can reference tool calls like "Use the Bash tool to run X" or "Use memory_search to find Y"\n` +
        `- Steps can reference conditional logic and loops\n` +
        `- Keep it under 200 lines — skills should be focused, not monolithic\n` +
        `- Write in imperative second person ("Run...", "Check...", "If X, then...")\n` +
        `- Do NOT include markdown fences around the output — output the raw .md content directly\n\n` +
        `Output only the .md file content, ready to save as .claude/skills/${skillName}.md`;

      try {
        const response = await callLLM(CODER_SYSTEM, prompt, 2000);
        return ok(`# /${skillName} skill — save to .claude/skills/${skillName}.md\n\n---\n\n${response}`);
      } catch (e: any) {
        return err(`generate_mcp_skill failed: ${e.message}`);
      }
    }

    default:
      return null;
  }
}
