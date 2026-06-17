import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";
import { callLLM } from "../llm.js";
import { callConvex } from "../convex.js";

const CONVEX_SITE = process.env.NOELCLAW_CONVEX_URL ?? "https://api.noelclaw.com";

export const MIROSHARK_TOOLS: Tool[] = [
  {
    name: "miroshark_simulate",
    description:
      "Simulate any scenario using MiroShark multi-agent AI. Use this when the user asks to simulate, model, or explore 'what happens if' - market crashes, regulations, social events, macro changes. " +
      "AI agents act as traders, analysts, journalists, and social actors. Returns a simulation_id to track progress.",
    inputSchema: {
      type: "object",
      properties: {
        scenario: {
          type: "string",
          description: "Plain-English description of the scenario to simulate. E.g. 'What happens if ETH drops 20% and whale wallets start selling?'",
        },
      },
      required: ["scenario"],
    },
  },
  {
    name: "miroshark_status",
    description:
      "Poll the status of a MiroShark simulation. Returns preparation progress, running progress, or final results. Automatically starts the simulation when agent preparation completes.",
    inputSchema: {
      type: "object",
      properties: {
        simulation_id: {
          type: "string",
          description: "Simulation ID returned by miroshark_simulate",
        },
      },
      required: ["simulation_id"],
    },
  },
  {
    name: "miroshark_stop",
    description: "Stop a running MiroShark simulation.",
    inputSchema: {
      type: "object",
      properties: {
        simulation_id: {
          type: "string",
          description: "Simulation ID to stop",
        },
      },
      required: ["simulation_id"],
    },
  },
];

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const key = process.env.NOELCLAW_API_KEY ?? process.env.NOELCLAW_SESSION_TOKEN;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function miroJson(path: string, method: string, body?: unknown, timeoutMs = 90_000): Promise<any> {
  const res = await fetch(`${CONVEX_SITE}${path}`, {
    method,
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`MiroShark ${method} ${path} [${res.status}]: ${text.slice(0, 300)}`);
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`MiroShark non-JSON response: ${text.slice(0, 200)}`); }
  if (json.success === false) throw new Error(`MiroShark error: ${json.error ?? JSON.stringify(json).slice(0, 300)}`);
  return json.data ?? json;
}

async function miroForm(path: string, form: FormData, timeoutMs = 120_000): Promise<any> {
  // No Content-Type header - browser/fetch sets multipart boundary automatically
  const res = await fetch(`${CONVEX_SITE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`MiroShark POST ${path} [${res.status}]: ${text.slice(0, 300)}`);
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`MiroShark non-JSON response: ${text.slice(0, 200)}`); }
  if (json.success === false) throw new Error(`MiroShark error: ${json.error ?? JSON.stringify(json).slice(0, 300)}`);
  return json.data ?? json;
}

async function pollUntilDone(
  taskPath: string,
  pollIntervalMs = 8_000,
  maxWaitMs = 180_000,
): Promise<any> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    const task = await miroJson(taskPath, "GET");
    const s = (task.status ?? "").toLowerCase();
    if (s === "completed" || s === "success") return task;
    if (s === "failed" || s === "error") {
      throw new Error(`Task failed: ${task.error ?? task.message ?? s}`);
    }
  }
  throw new Error("Task timed out after 3 minutes");
}

// ── Tool handler ──────────────────────────────────────────────────────────────

export async function handleMirosharkTool(name: string, args: unknown): Promise<ToolResult | null> {
  const a = (args ?? {}) as Record<string, any>;

  // ── miroshark_simulate ────────────────────────────────────────────────────
  if (name === "miroshark_simulate") {
    if (!a.scenario?.trim()) {
      return { content: [{ type: "text", text: "scenario is required" }], isError: true };
    }

    try {
      // Step 1: convert plain-English question into a structured seed document
      let asked: any;
      try {
        asked = await miroJson("/miroshark/api/simulation/ask", "POST", { question: a.scenario });
      } catch (err: any) {
        const msg = err.message ?? "";
        if (msg.includes("[404]") || msg.includes("[503]") || msg.includes("Upstream unreachable") || msg.includes("[502]")) {
          return {
            content: [{
              type: "text",
              text: "MiroShark simulation service is currently unavailable. The backend may be redeploying — try again in a few minutes. If this persists, the MIROSHARK_URL Cloudflare secret may need to be updated (`wrangler secret put MIROSHARK_URL`).",
            }],
            isError: true,
          };
        }
        throw err;
      }
      const { title, seed_document, simulation_requirement } = asked;

      // Step 2: generate knowledge-graph ontology from the seed document
      const form = new FormData();
      form.append("simulation_requirement", simulation_requirement ?? a.scenario);
      form.append("project_name", (title ?? a.scenario).slice(0, 100));
      form.append("url_docs", JSON.stringify([{
        title: title ?? "Simulation Context",
        url: "",
        text: seed_document ?? a.scenario,
      }]));
      const ontology = await miroForm("/miroshark/api/graph/ontology/generate", form);
      const projectId: string = ontology.project_id;
      if (!projectId) throw new Error("No project_id in ontology response");

      // Step 3: kick off the async graph build
      const built = await miroJson("/miroshark/api/graph/build", "POST", { project_id: projectId });
      const graphTaskId: string = built.task_id;
      if (!graphTaskId) throw new Error("No task_id in graph build response");

      // Step 4: wait for graph to finish (up to 3 min)
      await pollUntilDone(`/miroshark/api/graph/task/${graphTaskId}`);

      // Step 5: create simulation from the built graph
      const created = await miroJson("/miroshark/api/simulation/create", "POST", { project_id: projectId });
      const simId: string = created.simulation_id ?? created.id;
      if (!simId) throw new Error("No simulation_id in create response");

      // Step 6: kick off agent preparation (async - don't block)
      const prepared = await miroJson("/miroshark/api/simulation/prepare", "POST", { simulation_id: simId, parallel_profile_count: 10 });
      const prepTaskId: string | undefined = prepared.task_id;

      return {
        content: [{
          type: "text",
          text: [
            `**MiroShark simulation queued** ✓`,
            ``,
            `Scenario: ${a.scenario}`,
            `Project: \`${projectId}\``,
            `Simulation ID: \`${simId}\``,
            `Status: preparing agents${prepTaskId ? ` (task: ${prepTaskId})` : ""}`,
            ``,
            `Agent preparation runs in the background. Poll progress with:`,
            `\`miroshark_status simulation_id="${simId}"\``,
          ].join("\n"),
        }],
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: `MiroShark error: ${err.message}` }], isError: true };
    }
  }

  // ── miroshark_status ──────────────────────────────────────────────────────
  if (name === "miroshark_status") {
    if (!a.simulation_id?.trim()) {
      return { content: [{ type: "text", text: "simulation_id is required" }], isError: true };
    }

    const simId: string = a.simulation_id.trim();
    if (!/^[a-zA-Z0-9_-]{5,100}$/.test(simId)) {
      return { content: [{ type: "text", text: "Invalid simulation_id format." }], isError: true };
    }

    try {
      // Check run status first
      const runStatus = await miroJson(
        `/miroshark/api/simulation/${simId}/run-status`,
        "GET",
      ).catch(() => ({ runner_status: "idle" }));

      const runnerStatus = (runStatus?.runner_status ?? "idle").toLowerCase();

      // If not yet running, check whether agents are prepared by probing /config
      // (config only exists after /prepare completes)
      if (runnerStatus === "idle") {
        const config = await miroJson(
          `/miroshark/api/simulation/${simId}/config`,
          "GET",
        ).catch(() => null);

        if (!config) {
          // Preparation still in progress - check profiles for real-time progress
          const profiles = await miroJson(
            `/miroshark/api/simulation/${simId}/profiles/realtime`,
            "GET",
          ).catch(() => null);

          const total = profiles?.total_expected ?? "?";
          const ready = profiles?.profiles_ready ?? 0;

          return {
            content: [{
              type: "text",
              text: [
                `**MiroShark \`${simId}\`** - preparing agents`,
                total !== "?" ? `Profiles: ${ready} / ${total} ready` : `Profiles generating...`,
                ``,
                `Poll again in ~10 seconds.`,
              ].join("\n"),
            }],
          };
        }

        // Config exists → agents prepared → auto-start
        await miroJson("/miroshark/api/simulation/start", "POST", {
          simulation_id: simId,
          platform: "parallel",
        });
        return {
          content: [{
            type: "text",
            text: [
              `**MiroShark \`${simId}\`** - simulation started`,
              ``,
              `Agents are now active. Poll again in ~15 seconds for progress.`,
              `\`miroshark_status simulation_id="${simId}"\``,
            ].join("\n"),
          }],
        };
      }

      if (runnerStatus === "running") {
        const round = runStatus.current_round ?? 0;
        const total = runStatus.total_rounds ?? "?";
        const pct = runStatus.progress_percent?.toFixed(1) ?? "0";
        const twitterActs = runStatus.twitter_actions_count ?? 0;
        const redditActs = runStatus.reddit_actions_count ?? 0;
        return {
          content: [{
            type: "text",
            text: [
              `**MiroShark \`${simId}\`** - running`,
              `Round: ${round} / ${total} (${pct}%)`,
              `Actions: ${twitterActs} Twitter · ${redditActs} Reddit`,
              ``,
              `Simulation in progress - poll again in ~15 seconds.`,
            ].join("\n"),
          }],
        };
      }

      if (runnerStatus === "completed" || runnerStatus === "stopped") {
        const actionsData = await miroJson(
          `/miroshark/api/simulation/${simId}/actions?limit=50`,
          "GET",
        ).catch(() => ({ actions: [] }));

        const actions: any[] = actionsData?.actions ?? [];
        const totalActions = runStatus.total_actions_count ?? actions.length;
        const rounds = runStatus.current_round ?? "?";

        const ACTION_EMOJI: Record<string, string> = {
          tweet: "🐦", post: "📝", sell: "📉", buy: "📈",
          article: "📰", comment: "💬", alert: "🚨", analyze: "🔍",
        };

        // Format agent feed
        const feed = actions.slice(0, 20).map((act: any) => {
          const who = act.agent_name ?? act.agent_id ?? "agent";
          const what = (act.action_type ?? act.type ?? "action").toLowerCase();
          const emoji = ACTION_EMOJI[what] ?? "•";
          const content = act.content ?? act.text ?? "";
          return `${emoji} **${who}** [${what}]${content ? `: ${String(content).slice(0, 120)}` : ""}`;
        });

        // Generate AI brief from agent activity
        let brief = "";
        if (actions.length > 0 && (process.env.BANKR_API_KEY || process.env.ANTHROPIC_API_KEY)) {
          const activitySummary = actions.slice(0, 30).map((act: any) => {
            const who = act.agent_name ?? act.agent_id ?? "agent";
            const what = act.action_type ?? act.type ?? "action";
            const content = act.content ?? act.text ?? "";
            return `${who} [${what}]: ${String(content).slice(0, 150)}`;
          }).join("\n");

          try {
            brief = await callLLM(
              "You are a market intelligence analyst. Given a MiroShark multi-agent simulation log, extract: 1) Key market sentiment, 2) Dominant narrative, 3) Top 3 agent behaviors, 4) Outlook. Be concise and direct - max 150 words.",
              `Simulation activity log:\n${activitySummary}`,
              400,
            );
          } catch {
            // brief stays empty - non-critical
          }
        }

        // Auto-save to vault if brief was generated
        let savedToVault = false;
        if (brief) {
          try {
            await callConvex("/vault/save", "POST", {
              type: "research",
              title: `MiroShark: ${a.scenario?.slice(0, 80) ?? simId}`,
              content: brief,
              key: `miroshark-${simId.slice(0, 8)}`,
              agentId: "miroshark",
              tags: ["miroshark", "simulation", "research"],
              commitMsg: "miroshark auto-save",
            }, "vault_save");
            savedToVault = true;
          } catch {
            // non-critical
          }
        }

        const lines = [
          `**MiroShark \`${simId}\`** - ${runnerStatus}`,
          `Rounds: ${rounds} · Actions: ${totalActions} agents`,
          "",
        ];

        if (brief) {
          lines.push("**🧠 AI Brief:**", brief, "");
        }

        if (feed.length > 0) {
          lines.push(`**Agent Feed** (${Math.min(actions.length, 20)} of ${totalActions}):`);
          lines.push(...feed);
        }

        if (savedToVault) {
          lines.push("", `_Findings auto-saved to vault as \`miroshark-${simId.slice(0, 8)}\`_`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // Fallback: unknown state
      return {
        content: [{
          type: "text",
          text: [
            `**MiroShark \`${simId}\`** - status: ${runnerStatus || "unknown"}`,
            ``,
            `If agents are still preparing, poll again shortly.`,
          ].filter(Boolean).join("\n"),
        }],
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: `MiroShark error: ${err.message}` }], isError: true };
    }
  }

  // ── miroshark_stop ────────────────────────────────────────────────────────
  if (name === "miroshark_stop") {
    if (!a.simulation_id?.trim()) {
      return { content: [{ type: "text", text: "simulation_id is required" }], isError: true };
    }
    const simId: string = a.simulation_id.trim();
    if (!/^[a-zA-Z0-9_-]{5,100}$/.test(simId)) {
      return { content: [{ type: "text", text: "Invalid simulation_id format." }], isError: true };
    }
    try {
      await miroJson(`/miroshark/api/simulation/${simId}/stop`, "POST", {});
      return { content: [{ type: "text", text: `⏹️ Simulation \`${simId}\` stopped.` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `MiroShark error: ${err.message}` }], isError: true };
    }
  }

  return null;
}
