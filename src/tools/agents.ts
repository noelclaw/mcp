import { z } from "zod";
import { ethers } from "ethers";
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
  {
    name: "agent_spawn",
    description:
      "Create a persistent named agent with a goal. The agent's state is saved to vault and survives across sessions. " +
      "Use this when a task is ongoing — research you'll return to, a project you're tracking, a workflow you're iterating on. " +
      "The agent starts with a goal and optional context. Update its progress with agent_update. Resume it with agent_recall.",
    inputSchema: {
      type: "object",
      properties: {
        name:    { type: "string", description: "Unique agent name (e.g. 'market-researcher', 'onboarding-helper')" },
        goal:    { type: "string", description: "What this agent is trying to accomplish" },
        context: { type: "string", description: "Optional starting context, data, or notes for the agent" },
      },
      required: ["name", "goal"],
    },
  },
  {
    name: "agent_recall",
    description:
      "Recall a persistent agent by name — loads its goal, current progress, findings, and full history. " +
      "Use this to resume a long-running task, check what an agent last did, or pick up where you left off across sessions.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Agent name as used in agent_spawn" },
      },
      required: ["name"],
    },
  },
  {
    name: "agent_update",
    description:
      "Update a persistent agent's progress and findings. Creates a new vault version automatically — full history is preserved. " +
      "Use this after completing a step: save findings, update status, note what's next. " +
      "Status options: active | blocked | complete.",
    inputSchema: {
      type: "object",
      properties: {
        name:     { type: "string", description: "Agent name" },
        progress: { type: "string", description: "What was accomplished in this update" },
        findings: { type: "string", description: "Key findings, data, or outputs from this step" },
        status:   { type: "string", enum: ["active", "blocked", "complete"], description: "Current agent status (default: active)" },
        nextStep: { type: "string", description: "What should happen next (optional — helps on recall)" },
      },
      required: ["name", "progress"],
    },
  },
  {
    name: "agent_identity",
    description:
      "Get or create a persistent on-chain identity (wallet address) for a named agent. " +
      "Every agent gets a unique Base address that acts as its digital identity — visible in the app, " +
      "usable for receiving payments, and permanently tied to that agent name. " +
      "Call once per agent; calling again returns the same address.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "Agent ID or name (e.g. 'market-researcher', 'analyst')",
        },
        agentName: {
          type: "string",
          description: "Human-readable agent name for display (optional)",
        },
      },
      required: ["agentId"],
    },
  },
  {
    name: "agent_ledger",
    description:
      "View the full activity ledger for a persistent agent — every update, status change, and finding logged in order. " +
      "Each entry is a vault version created by agent_update. Use this to audit what an agent has done, " +
      "trace its reasoning, or review progress since spawn.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Agent name as used in agent_spawn",
        },
        limit: {
          type: "number",
          description: "Max entries to return (default 20, max 50)",
        },
      },
      required: ["name"],
    },
  },
];

const HireAgentSchema = z.object({
  agentId:   z.string().min(1),
  task:      z.string().min(1),
  maxTokens: z.number().int().min(100).max(1200).optional(),
});
const SpawnAgentSchema = z.object({
  name:    z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, "name must be lowercase alphanumeric with hyphens"),
  goal:    z.string().min(1),
  context: z.string().optional(),
});
const RecallAgentSchema = z.object({ name: z.string().min(1) });
const UpdateAgentSchema = z.object({
  name:     z.string().min(1),
  progress: z.string().min(1),
  findings: z.string().optional(),
  status:   z.enum(["active", "blocked", "complete"]).optional(),
  nextStep: z.string().optional(),
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

  if (name === "agent_spawn") {
    const parsed = SpawnAgentSchema.safeParse(args);
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
    const { name: agentName, goal, context } = parsed.data;

    const content = JSON.stringify({
      goal,
      status: "active",
      spawnedAt: new Date().toISOString(),
      context: context ?? null,
      updates: [],
    }, null, 2);

    const data = await callConvex("/vault/save", "POST", {
      type:    "memory",
      key:     `agent/${agentName}`,
      title:   `Agent: ${agentName}`,
      content,
      contentType: "json",
      agentId: agentName,
      tags:    ["persistent-agent"],
      commitMsg: "spawned",
    }, "vault_save") as { key?: string; version?: number; error?: string };

    if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
    return {
      content: [{ type: "text", text: `🤖 Agent **${agentName}** spawned.\n\n**Goal:** ${goal}\n\nRecall with \`agent_recall\` · Update progress with \`agent_update\`` }],
    };
  }

  if (name === "agent_recall") {
    const parsed = RecallAgentSchema.safeParse(args);
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

    const data = await callConvex(`/vault/entry?key=agent/${parsed.data.name}`, "GET", undefined, "vault_read") as {
      key?: string; content?: string; version?: number; updatedAt?: number; error?: string;
    };

    if (data.error || !data.content) {
      return { content: [{ type: "text", text: `Agent \`${parsed.data.name}\` not found. Spawn it first with \`agent_spawn\`.` }], isError: true };
    }

    let state: any = {};
    try { state = JSON.parse(data.content); } catch { /* non-JSON content */ }

    const updates: string[] = (state.updates ?? []).slice(-3).map((u: any, i: number) =>
      `  ${i + 1}. [${u.status ?? "active"}] ${u.progress}${u.nextStep ? ` → next: ${u.nextStep}` : ""}`
    );

    const lines = [
      `## Agent: ${parsed.data.name}`,
      `**Goal:** ${state.goal ?? "—"}`,
      `**Status:** ${state.status ?? "active"}`,
      `**Version:** ${data.version ?? 1} · Updated: ${data.updatedAt ? new Date(data.updatedAt).toUTCString() : "—"}`,
    ];
    if (state.context) lines.push(`**Context:** ${state.context}`);
    if (updates.length) lines.push(`\n**Recent updates:**\n${updates.join("\n")}`);
    if (state.nextStep) lines.push(`\n**Next step:** ${state.nextStep}`);

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (name === "agent_update") {
    const parsed = UpdateAgentSchema.safeParse(args);
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
    const { name: agentName, progress, findings, status = "active", nextStep } = parsed.data;

    // Load current state
    const current = await callConvex(`/vault/entry?key=agent/${agentName}`, "GET", undefined, "vault_read") as {
      content?: string; error?: string;
    };
    if (current.error || !current.content) {
      return { content: [{ type: "text", text: `Agent \`${agentName}\` not found. Spawn it first.` }], isError: true };
    }

    let state: any = {};
    try { state = JSON.parse(current.content); } catch { /* start fresh */ }

    const update: any = { progress, status, timestamp: new Date().toISOString() };
    if (findings) update.findings = findings;
    if (nextStep) update.nextStep = nextStep;

    state.status  = status;
    state.nextStep = nextStep ?? state.nextStep;
    state.updates  = [...(state.updates ?? []), update].slice(-20);

    const data = await callConvex("/vault/save", "POST", {
      type:    "memory",
      key:     `agent/${agentName}`,
      title:   `Agent: ${agentName}`,
      content: JSON.stringify(state, null, 2),
      contentType: "json",
      agentId: agentName,
      commitMsg: `[${status}] ${progress.slice(0, 60)}`,
    }, "vault_save") as { key?: string; version?: number; error?: string };

    if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

    const statusEmoji = status === "complete" ? "✅" : status === "blocked" ? "🚫" : "🔄";
    return {
      content: [{ type: "text", text: `${statusEmoji} Agent **${agentName}** updated (v${data.version}).\n\n**Progress:** ${progress}${findings ? `\n**Findings:** ${findings}` : ""}${nextStep ? `\n**Next:** ${nextStep}` : ""}` }],
    };
  }

  if (name === "agent_ledger") {
    const { name: agentName, limit = 20 } = args as { name: string; limit?: number };
    if (!agentName) return { content: [{ type: "text", text: "name is required" }], isError: true };

    const cap = Math.min(Math.max(1, limit), 50);
    const data = await callConvex(
      `/vault/history?key=agent/${encodeURIComponent(agentName)}&limit=${cap}`,
      "GET", undefined, "vault_history",
    ) as { versions?: Array<{ version: number; commitMsg?: string; updatedAt?: number }>; error?: string };

    if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

    const versions = data.versions ?? [];
    if (!versions.length) {
      return { content: [{ type: "text", text: `No ledger entries found for agent \`${agentName}\`. Spawn it first with \`agent_spawn\`.` }] };
    }

    const rows = versions.map((v) => {
      const ts = v.updatedAt ? new Date(v.updatedAt).toUTCString() : "—";
      const msg = v.commitMsg ?? "(no message)";
      return `  v${v.version}  ${ts}\n         ${msg}`;
    });

    return {
      content: [{
        type: "text",
        text: `## Agent Ledger: ${agentName} (${versions.length} entries)\n\n${rows.join("\n\n")}`,
      }],
    };
  }

  if (name === "agent_identity") {
    const { agentId, agentName } = args as { agentId: string; agentName?: string };

    // Check if identity already exists
    const existing = await callConvex(
      `/agents/identity?agentId=${encodeURIComponent(agentId)}`,
      "GET", undefined, "agent_identity",
    );

    if (existing?.identity) {
      const id = existing.identity;
      return {
        content: [{
          type: "text",
          text: [
            `🤖 **Agent Identity: \`${agentId}\`**`,
            ``,
            `**Address:** \`${id.walletAddress}\``,
            `**Network:** Base mainnet`,
            ``,
            `This address is permanent and tied to this agent.`,
            `Share it to receive funds · Track spending · Verify agent actions`,
          ].join("\n"),
        }],
      };
    }

    // Generate new wallet address for the agent
    const wallet = ethers.Wallet.createRandom();
    const data = await callConvex("/agents/identity", "POST", {
      agentId,
      walletAddress: wallet.address,
      agentName: agentName ?? agentId,
    }, "agent_identity");

    return {
      content: [{
        type: "text",
        text: [
          `🤖 **Agent Identity Created: \`${agentId}\`**`,
          ``,
          `**Address:** \`${wallet.address}\``,
          `**Network:** Base mainnet`,
          ``,
          `This identity is now permanently linked to \`${agentId}\`.`,
          `Visible in the Agents page of your Noelclaw app.`,
        ].join("\n"),
      }],
    };
  }

  return null;
}
