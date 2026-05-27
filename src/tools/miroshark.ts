import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";

export const MIROSHARK_TOOLS: Tool[] = [
  {
    name: "miroshark_simulate",
    description:
      "Run a MiroShark multi-agent simulation. Describe a scenario in plain English and get back strategic insights from a network of AI agents (market actors, risk managers, analysts). " +
      "Returns a simulation ID you can poll with miroshark_status.",
    inputSchema: {
      type: "object",
      properties: {
        scenario: {
          type: "string",
          description: "Plain-English description of the scenario to simulate. E.g. 'What happens if ETH drops 20% and whale wallets start selling?'",
        },
        agents: {
          type: "number",
          description: "Number of agents in the simulation (default: 10, max: 50)",
        },
        steps: {
          type: "number",
          description: "Number of simulation steps to run (default: 5)",
        },
      },
      required: ["scenario"],
    },
  },
  {
    name: "miroshark_status",
    description:
      "Poll the status and results of a MiroShark simulation by ID. Returns agent outputs, consensus findings, and final strategic insights when complete.",
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
];

function getConfig() {
  const url = process.env.MIROSHARK_URL?.replace(/\/$/, "");
  const token = process.env.MIROSHARK_ADMIN_TOKEN;
  return { url, token };
}

async function mirofetch(path: string, method: string, body?: unknown): Promise<any> {
  const { url, token } = getConfig();
  if (!url) throw new Error("MIROSHARK_URL not set");
  if (!token) throw new Error("MIROSHARK_ADMIN_TOKEN not set");

  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MiroShark ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

export async function handleMirosharkTool(name: string, args: unknown): Promise<ToolResult | null> {
  const a = (args ?? {}) as Record<string, any>;

  if (name === "miroshark_simulate") {
    if (!a.scenario?.trim()) {
      return { content: [{ type: "text", text: "scenario is required" }], isError: true };
    }

    const { url, token } = getConfig();
    if (!url || !token) {
      return {
        content: [{ type: "text", text: "MiroShark not configured — set MIROSHARK_URL and MIROSHARK_ADMIN_TOKEN" }],
        isError: true,
      };
    }

    try {
      // Step 1: ask (parse scenario into simulation params)
      const asked = await mirofetch("/api/simulation/ask", "POST", { question: a.scenario });

      // Step 2: create simulation
      const created = await mirofetch("/api/simulation/create", "POST", {
        ...asked,
        num_agents: Math.min(a.agents ?? 10, 50),
        num_steps: a.steps ?? 5,
      });

      const simId = created.simulation_id ?? created.id;
      if (!simId) throw new Error("No simulation ID in create response");

      // Step 3: prepare
      await mirofetch(`/api/simulation/${simId}/prepare`, "POST", {});

      // Step 4: start
      await mirofetch(`/api/simulation/${simId}/start`, "POST", {});

      return {
        content: [{
          type: "text",
          text: [
            `🦈 **MiroShark simulation started**`,
            `Scenario: ${a.scenario}`,
            `Simulation ID: \`${simId}\``,
            `Agents: ${a.agents ?? 10} · Steps: ${a.steps ?? 5}`,
            ``,
            `Poll results with: \`miroshark_status simulation_id="${simId}"\``,
          ].join("\n"),
        }],
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: `MiroShark error: ${err.message}` }], isError: true };
    }
  }

  if (name === "miroshark_status") {
    if (!a.simulation_id?.trim()) {
      return { content: [{ type: "text", text: "simulation_id is required" }], isError: true };
    }

    try {
      const data = await mirofetch(`/api/simulation/${a.simulation_id}/status`, "GET");

      const status = data.status ?? "unknown";
      const lines = [
        `🦈 **MiroShark Simulation \`${a.simulation_id}\`**`,
        `Status: **${status}**`,
      ];

      if (data.progress != null) lines.push(`Progress: ${data.progress}%`);

      if (status === "completed" && data.results) {
        lines.push("", "**Results**");
        if (data.results.summary) lines.push(data.results.summary);
        if (Array.isArray(data.results.insights)) {
          for (const insight of data.results.insights.slice(0, 5)) {
            lines.push(`• ${typeof insight === "string" ? insight : JSON.stringify(insight)}`);
          }
        }
        if (data.results.consensus) lines.push("", `**Consensus:** ${data.results.consensus}`);
      } else if (status === "failed") {
        lines.push("", `Error: ${data.error ?? "unknown"}`);
      } else {
        lines.push("", "Simulation still running — poll again in a few seconds.");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `MiroShark error: ${err.message}` }], isError: true };
    }
  }

  return null;
}
