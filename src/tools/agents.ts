import { z } from "zod";
import { ethers } from "ethers";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { callLLM } from "../llm.js";
import { ToolResult } from "../types.js";

// ─── Agent Learning Memory (v3.25) ──────────────────────────────────────────
// After every agent_update, an LLM reviews the new progress in context of the
// agent's goal + prior learnings to extract a single repeatable insight. The
// insight is appended to the agent's `learnings[]` array (capped to last 30
// to keep the state file from bloating). On agent_recall and at the start of
// any agent run, learnings are surfaced so subsequent work compounds.
//
// Failure mode: extraction is best-effort. If the LLM is unavailable, slow,
// or returns NONE, the update still succeeds - we just don't append. Learning
// is a quality bonus, not a hard requirement of the update path.

const MAX_LEARNINGS = 30;

const LEARNING_SYSTEM_PROMPT = [
  "You are an expert at extracting one reusable insight from an agent's progress update.",
  "",
  "You will see: the agent's goal, the agent's recent updates (chronological), and the latest update.",
  "",
  "TASK: Decide if the latest update reveals a NEW repeatable pattern, heuristic, or framework that would",
  "improve this agent's future runs. Be strict - most updates are routine and do NOT contain a new insight.",
  "",
  "Output rules:",
  "- If a genuine new insight emerged, output ONE sentence under 180 chars starting with an imperative verb.",
  "  Examples: \"Prefer Morpho vaults over Aave when USDC supply exceeds $10M.\"",
  "             \"Always check on-chain holder count before claiming a token has organic demand.\"",
  "             \"Skip schedule_research for time-sensitive queries - use deep_research with freshMode.\"",
  "- If the update is routine (status report, progress without insight, repeat of prior learning),",
  "  output exactly: NONE",
  "- Do not output explanations, prefixes, or quotation marks. Just the sentence or NONE.",
].join("\n");

async function extractLearning(
  goal: string,
  priorUpdates: Array<{ progress: string; findings?: string; status?: string }>,
  priorLearnings: string[],
  latest: { progress: string; findings?: string; status?: string },
): Promise<string | null> {
  // Fast skip when no LLM key is configured. Without a key, callLLM falls
  // through to the noelclaw-proxy path which may also be unconfigured for
  // this user - every agent_update would otherwise pay an 8s timeout for
  // nothing. Cheap, correct, and keeps update latency low.
  const hasLLM = !!(process.env.BANKR_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GROK_API_KEY);
  if (!hasLLM && !process.env.NOELCLAW_SESSION_TOKEN) {
    return null;
  }

  // Build the user prompt with all the context the model needs.
  const lines: string[] = [];
  lines.push(`Agent goal: ${goal}`);
  if (priorLearnings.length) {
    lines.push(``);
    lines.push(`Existing learnings (do not repeat any of these):`);
    priorLearnings.slice(-10).forEach((l, i) => lines.push(`  ${i + 1}. ${l}`));
  }
  if (priorUpdates.length) {
    lines.push(``);
    lines.push(`Recent updates (oldest first):`);
    priorUpdates.slice(-5).forEach((u, i) => {
      const finding = u.findings ? ` | findings: ${u.findings}` : "";
      lines.push(`  ${i + 1}. [${u.status ?? "active"}] ${u.progress}${finding}`);
    });
  }
  lines.push(``);
  lines.push(`Latest update:`);
  lines.push(`  [${latest.status ?? "active"}] ${latest.progress}${latest.findings ? ` | findings: ${latest.findings}` : ""}`);
  lines.push(``);
  lines.push(`What new repeatable insight (if any) emerged from this latest update?`);

  try {
    // Short max_tokens - the answer should be one sentence. 8s timeout keeps
    // agent_update responsive even when the LLM is slow; mutex still serializes
    // updates so we don't pile up.
    const out = await callLLM(LEARNING_SYSTEM_PROMPT, lines.join("\n"), 120, [], 8000);
    const trimmed = out.trim().replace(/^["']|["']$/g, "");
    if (!trimmed || trimmed.toUpperCase() === "NONE") return null;
    // Guard against the model accidentally repeating a recent learning.
    const lowered = trimmed.toLowerCase();
    if (priorLearnings.some((p) => p.toLowerCase() === lowered)) return null;
    // Hard cap on length to keep state file bounded.
    return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
  } catch {
    return null;
  }
}

// Per-agent mutex for the read-modify-write cycle in agent_update / agent_spawn.
// Without this, two parallel calls on the same agent would both read the same
// state, both append their own update, and the second save would silently lose
// the first update. The mutex chains all writes for a given agent name through
// a single Promise so they execute serially.
const agentLocks = new Map<string, Promise<unknown>>();

function withAgentLock<T>(agentName: string, fn: () => Promise<T>): Promise<T> {
  const prev = agentLocks.get(agentName) ?? Promise.resolve();
  const next = prev.then(() => fn(), () => fn());
  agentLocks.set(agentName, next);
  // Clean up the map entry once this op completes - otherwise long-lived
  // server processes accumulate dead entries.
  next.finally(() => {
    if (agentLocks.get(agentName) === next) agentLocks.delete(agentName);
  });
  return next;
}

export const AGENT_TOOLS: Tool[] = [
  {
    name: "list_agents",
    description: "List all available specialist agents you can hire - built-in experts (analyst, risk-manager, researcher, executor, scout) plus any community-published agents.",
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
          description: "The task or question for the agent. Be specific - better input = better output.",
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
      "Create a persistent NAMED agent with a goal - survives across sessions, state saved to vault under `agent/<name>` key. " +
      "Use this when a task is ONGOING and will span multiple sessions: research you'll return to, a project you're tracking, " +
      "a workflow you're iterating on. Track progress with agent_update, resume with agent_recall, audit with agent_ledger. " +
      "Do NOT spawn an agent for one-shot tasks (single research query, single trade) - just call the relevant tool directly. " +
      "Do NOT use this for ephemeral background data - use memory_add for that instead.",
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
      "Recall a persistent agent by name - loads its goal, current progress, findings, full history, and 🧠 accumulated learnings (patterns the agent extracted from past runs). " +
      "Use this to resume a long-running task, check what an agent last did, or hand context to a fresh LLM session. " +
      "Learnings compound over time - the more an agent runs, the smarter recall becomes.",
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
      "Update a persistent agent's progress and findings. Creates a new vault version automatically - full history preserved. " +
      "After each update an LLM extracts a single repeatable insight (if any) and appends it to the agent's accumulated learnings - the agent gets smarter every run. " +
      "Status options: active | blocked | complete.",
    inputSchema: {
      type: "object",
      properties: {
        name:     { type: "string", description: "Agent name" },
        progress: { type: "string", description: "What was accomplished in this update" },
        findings: { type: "string", description: "Key findings, data, or outputs from this step" },
        status:   { type: "string", enum: ["active", "blocked", "complete"], description: "Current agent status (default: active)" },
        nextStep: { type: "string", description: "What should happen next (optional - helps on recall)" },
      },
      required: ["name", "progress"],
    },
  },
  {
    name: "agent_identity",
    description:
      "Get or create a persistent on-chain identity (wallet address) for a named agent. " +
      "Every agent gets a unique Base address that acts as its digital identity - visible in the app, " +
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
      "View the full activity ledger for a persistent agent - every update, status change, and finding logged in order. " +
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
  {
    name: "agent_schedule",
    description:
      "Attach an autonomous schedule to an existing agent. The agent wakes up on cron cadence, executes a workflow, " +
      "saves the result to vault under `agent/<name>/runs/<date>`, and optionally pings you on Telegram. " +
      "Workflows: " +
      "deep_research (LLM brief on agent's goal) · " +
      "packet (run a named packet) · " +
      "llm (agentic loop with restricted tools) · " +
      "reflection (walk recent vault activity → update profile/state for persistent context). " +
      "Cron shorthand: hourly | daily | weekly | every-2-minutes | every-5-minutes (last two for testing).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Agent name (must already exist via agent_spawn)" },
        cron: { type: "string", description: "Schedule: hourly | daily | weekly | every-2-minutes | every-5-minutes" },
        workflow: { type: "string", enum: ["deep_research", "packet", "llm", "reflection"], description: "Workflow type" },
        topic: { type: "string", description: "[deep_research] Research topic (defaults to agent's goal)" },
        packetName: { type: "string", description: "[packet] Name of packet to run (must exist via packet_create)" },
        prompt: { type: "string", description: "[llm] Instructions for the autonomous agent loop" },
        allowedTools: { type: "array", items: { type: "string" }, description: "[llm] Tool whitelist - subset of: vault_save, vault_search, get_market_data, web_search" },
        windowDays: { type: "number", description: "[reflection] Days of vault activity to walk (default 7)" },
        maxRunsPerDay: { type: "number", description: "Cost ceiling - default 4 (daily), 24 (hourly), 1 (weekly)" },
      },
      required: ["name", "cron", "workflow"],
    },
  },
  {
    name: "agent_unschedule",
    description: "Remove the autonomous schedule from an agent. The agent itself remains in vault - only its scheduled execution is cleared.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Agent name" } },
      required: ["name"],
    },
  },
  {
    name: "agent_pause",
    description: "Pause an agent's autonomous schedule without deleting it. Use agent_resume to re-enable.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Agent name" } },
      required: ["name"],
    },
  },
  {
    name: "agent_resume",
    description: "Re-enable a paused agent's schedule. Resets the consecutive-failure counter.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Agent name" } },
      required: ["name"],
    },
  },
  {
    name: "agent_runs",
    description:
      "View recent autonomous run history for a scheduled agent - when it ran, success/failure status, " +
      "vault key where the output was saved, and duration. Use this to verify the autonomous loop is healthy.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Agent name" },
        limit: { type: "number", description: "Max runs to return (default 10, max 50)" },
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
        text: `## ${data.agent ?? agentId} - Response\n\n${data.result}${footer}`,
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

    // Learnings - the agent's accumulated expertise across all prior updates.
    // Surfaced prominently so the caller (or downstream LLM) can apply them.
    const learningEntries: string[] = Array.isArray(state.learnings)
      ? state.learnings.map((l: any) => (typeof l === "string" ? l : l?.learned)).filter(Boolean)
      : [];

    const lines = [
      `## Agent: ${parsed.data.name}`,
      `**Goal:** ${state.goal ?? "-"}`,
      `**Status:** ${state.status ?? "active"}`,
      `**Version:** ${data.version ?? 1} · Updated: ${data.updatedAt ? new Date(data.updatedAt).toUTCString() : "-"}`,
    ];
    if (state.context) lines.push(`**Context:** ${state.context}`);

    if (learningEntries.length) {
      lines.push(`\n**🧠 Learned patterns (${learningEntries.length}):**`);
      // Show the most recent 8 - these are the most refined and relevant.
      learningEntries.slice(-8).forEach((l, i) => lines.push(`  ${i + 1}. ${l}`));
    }

    if (updates.length) lines.push(`\n**Recent updates:**\n${updates.join("\n")}`);
    if (state.nextStep) lines.push(`\n**Next step:** ${state.nextStep}`);

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (name === "agent_update") {
    const parsed = UpdateAgentSchema.safeParse(args);
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
    const { name: agentName, progress, findings, status = "active", nextStep } = parsed.data;

    return withAgentLock(agentName, async () => {
      // Load current state - inside the lock so two parallel updates can't
      // both read v=N and both write v=N+1 (the second silently loses).
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

      // ─── Learning extraction (v3.25) ────────────────────────────────────
      // Ask an LLM whether this update revealed a new repeatable insight.
      // Best-effort: if it returns NONE or fails, we save without appending.
      // The call sits inside the mutex so concurrent updates don't race on
      // the learnings array - same protection that already covers updates[].
      const priorLearnings: string[] = Array.isArray(state.learnings)
        ? state.learnings.map((l: any) => (typeof l === "string" ? l : l?.learned)).filter(Boolean)
        : [];
      const newLearning = await extractLearning(
        state.goal ?? "",
        (state.updates ?? []).slice(0, -1) as Array<{ progress: string; findings?: string; status?: string }>,
        priorLearnings,
        update,
      );
      if (newLearning) {
        const entry = { learned: newLearning, ts: Date.now(), fromUpdate: state.updates.length - 1 };
        state.learnings = [...(state.learnings ?? []), entry].slice(-MAX_LEARNINGS);
      }

      const data = await callConvex("/vault/save", "POST", {
        type:    "memory",
        key:     `agent/${agentName}`,
        title:   `Agent: ${agentName}`,
        content: JSON.stringify(state, null, 2),
        contentType: "json",
        agentId: agentName,
        commitMsg: `[${status}] ${progress.slice(0, 60)}${newLearning ? " · +learning" : ""}`,
      }, "vault_save") as { key?: string; version?: number; error?: string };

      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      const statusEmoji = status === "complete" ? "✅" : status === "blocked" ? "🚫" : "🔄";
      const learningLine = newLearning
        ? `\n\n🧠 **Learned:** ${newLearning}`
        : "";
      return {
        content: [{ type: "text", text: `${statusEmoji} Agent **${agentName}** updated (v${data.version}).\n\n**Progress:** ${progress}${findings ? `\n**Findings:** ${findings}` : ""}${nextStep ? `\n**Next:** ${nextStep}` : ""}${learningLine}` }],
      };
    });
  }

  if (name === "agent_ledger") {
    const { name: agentName, limit = 20 } = args as { name: string; limit?: number };
    if (!agentName) return { content: [{ type: "text", text: "name is required" }], isError: true };

    const cap = Math.min(Math.max(1, limit), 50);
    const data = await callConvex(
      `/vault/history?key=agent/${encodeURIComponent(agentName)}&limit=${cap}`,
      "GET", undefined, "vault_history",
    ) as { history?: Array<{ version: number; commitMsg?: string; createdAt?: number }>; error?: string };

    if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

    const versions = data.history ?? [];
    if (!versions.length) {
      return { content: [{ type: "text", text: `No ledger entries found for agent \`${agentName}\`. Spawn it first with \`agent_spawn\`.` }] };
    }

    const rows = versions.map((v) => {
      const ts = v.createdAt ? new Date(v.createdAt).toUTCString() : "-";
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

  // ─── Autonomous schedule tools ──────────────────────────────────────────────

  if (name === "agent_schedule") {
    const a = args as {
      name: string; cron: string; workflow: "deep_research" | "packet" | "llm" | "reflection";
      topic?: string; packetName?: string; prompt?: string; allowedTools?: string[];
      windowDays?: number;
      maxRunsPerDay?: number;
    };
    if (!a.name || !a.cron || !a.workflow) {
      return { content: [{ type: "text", text: "name, cron, workflow required" }], isError: true };
    }
    const agentKey = `agent/${a.name}`;
    const workflowConfig: any = {};
    if (a.workflow === "deep_research" && a.topic) workflowConfig.topic = a.topic;
    if (a.workflow === "packet") workflowConfig.packetName = a.packetName;
    if (a.workflow === "llm") {
      workflowConfig.prompt = a.prompt;
      workflowConfig.allowedTools = a.allowedTools ?? ["vault_save", "vault_search"];
    }
    if (a.workflow === "reflection") {
      workflowConfig.windowDays = typeof a.windowDays === "number" ? a.windowDays : 7;
    }
    const result = await callConvex("/agents/schedule", "POST", {
      agentKey, cron: a.cron, workflow: a.workflow, workflowConfig,
      maxRunsPerDay: a.maxRunsPerDay,
    }, "agent_schedule");
    if (result.error) return { content: [{ type: "text", text: `Schedule failed: ${result.error}` }], isError: true };
    return {
      content: [{
        type: "text",
        text: [
          `🤖 **Schedule attached to \`${a.name}\`**`,
          ``,
          `Workflow: ${a.workflow}${a.topic ? `\nTopic: ${a.topic}` : ""}${a.packetName ? `\nPacket: ${a.packetName}` : ""}`,
          `Cron: ${a.cron}`,
          `Next run: ${result.nextRunIso}`,
          ``,
          `The agent will run autonomously. Check progress with \`agent_runs name=${a.name}\`.`,
        ].filter(Boolean).join("\n"),
      }],
    };
  }

  if (name === "agent_unschedule") {
    const a = args as { name: string };
    if (!a.name) return { content: [{ type: "text", text: "name required" }], isError: true };
    const result = await callConvex("/agents/unschedule", "POST", { agentKey: `agent/${a.name}` }, "agent_unschedule");
    if (result.error) return { content: [{ type: "text", text: `Unschedule failed: ${result.error}` }], isError: true };
    return {
      content: [{
        type: "text",
        text: result.deleted
          ? `🗑️ Schedule removed from \`${a.name}\`. Agent itself remains in vault.`
          : `\`${a.name}\` had no active schedule.`,
      }],
    };
  }

  if (name === "agent_pause" || name === "agent_resume") {
    const a = args as { name: string };
    if (!a.name) return { content: [{ type: "text", text: "name required" }], isError: true };
    const enabled = name === "agent_resume";
    const result = await callConvex("/agents/pause", "POST", { agentKey: `agent/${a.name}`, enabled }, name);
    if (result.error) return { content: [{ type: "text", text: `${name} failed: ${result.error}` }], isError: true };
    if (!result.changed) return { content: [{ type: "text", text: `\`${a.name}\` has no schedule to ${enabled ? "resume" : "pause"}.` }] };
    return {
      content: [{
        type: "text",
        text: enabled
          ? `▶️ Resumed schedule for \`${a.name}\`. Failure counter reset.`
          : `⏸️ Paused schedule for \`${a.name}\`. Use \`agent_resume name=${a.name}\` to re-enable.`,
      }],
    };
  }

  if (name === "agent_runs") {
    const a = args as { name: string; limit?: number };
    if (!a.name) return { content: [{ type: "text", text: "name required" }], isError: true };
    const limit = Math.min(Math.max(a.limit ?? 10, 1), 50);
    const result = await callConvex(
      `/agents/runs?agentKey=${encodeURIComponent(`agent/${a.name}`)}&limit=${limit}`,
      "GET", undefined, "agent_runs",
    );
    if (result.error) return { content: [{ type: "text", text: `agent_runs failed: ${result.error}` }], isError: true };
    const runs = (result.runs ?? []) as Array<{
      startedAt: number; endedAt?: number; status: string;
      vaultKeyResult?: string; resultSummary?: string; errorMsg?: string;
      durationMs?: number; toolCallCount?: number; workflow: string;
    }>;
    if (!runs.length) {
      return { content: [{ type: "text", text: `No autonomous runs yet for \`${a.name}\`. The agent runs on its cron schedule - be patient.` }] };
    }
    const lines = [`## Recent runs for \`${a.name}\` (${runs.length})`, ""];
    for (const r of runs) {
      const when = new Date(r.startedAt).toISOString().replace("T", " ").slice(0, 19);
      const dur = r.durationMs ? `${Math.round(r.durationMs / 1000)}s` : "-";
      const icon = r.status === "success" ? "✅" : r.status === "failed" ? "❌" : r.status === "timeout" ? "⏱️" : "⏳";
      lines.push(`${icon} **${when}** · ${r.workflow} · ${dur}${r.toolCallCount != null ? ` · ${r.toolCallCount} tool calls` : ""}`);
      if (r.vaultKeyResult) lines.push(`   → \`${r.vaultKeyResult}\``);
      if (r.resultSummary) lines.push(`   ${r.resultSummary.slice(0, 200)}`);
      if (r.errorMsg) lines.push(`   ⚠️ ${r.errorMsg.slice(0, 200)}`);
      lines.push("");
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  return null;
}
