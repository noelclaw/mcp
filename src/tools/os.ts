import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";
import { getTier } from "../token-gate.js";
import { getOrCreateWallet } from "../wallet.js";

const CONVEX_SITE = process.env.NOELCLAW_CONVEX_URL ?? "https://api.noelclaw.com";

export const OS_TOOLS: Tool[] = [
  {
    name: "noel_status",
    description:
      "Full runtime dashboard - memory size, persistent agents, active automations, recent vault research, " +
      "execution scores, and your tier. Like `htop` for your AI runtime. " +
      "Run this to see what's running and what state your runtime is currently holding.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "noel_shell_chat",
    description:
      "Chat with Noel Shell — AI terminal with tool calling. Can spawn agents, save to vault, search memory, create automations, estimate swaps, list agents, and get wallet balance — all from a single prompt.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Your message or instruction to Noel Shell." },
        agent_id: { type: "string", description: "Optional: specific agent ID to chat with (default: noel-default)." },
      },
      required: ["message"],
    },
  },
];

export async function handleOsTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "noel_status": {
      const [tierResult, walletResult, memRes, autoRes, vaultRes, agentsRes] = await Promise.allSettled([
        getTier(),
        getOrCreateWallet(),
        callConvex("/memory/profile", "GET"),
        callConvex("/automations/list", "GET", undefined, "list_automations"),
        callConvex("/vault/list?type=research&limit=5", "GET", undefined, "noel_status"),
        callConvex("/vault/list?type=memory&limit=20", "GET", undefined, "noel_status"),
      ]);

      const tier   = tierResult.status   === "fulfilled" ? tierResult.value   : "basic";
      const wallet = walletResult.status === "fulfilled" ? walletResult.value : null;
      const mem    = memRes.status    === "fulfilled" ? memRes.value    : null;
      const autos  = autoRes.status   === "fulfilled" ? autoRes.value   : null;
      const vault  = vaultRes.status  === "fulfilled" ? vaultRes.value  : null;
      const agents = agentsRes.status === "fulfilled" ? agentsRes.value : null;

      const automations: any[] = autos?.automations ?? [];
      const activeAutos = automations.filter((a: any) => a.status === "active");
      const vaultEntries: any[] = vault?.entries ?? [];
      // Persistent agents live in vault as type=memory with key prefix "agent/"
      const persistentAgents: any[] = (agents?.entries ?? []).filter((e: any) => typeof e.key === "string" && e.key.startsWith("agent/"));
      const memTotal = mem?.total ?? 0;
      const memStatus = mem?.status ?? "unknown";

      const tierLabel = tier === "holder"
        ? "\u{1F7E2} **Holder**  - premium tools unlocked"
        : "⚪ **Basic**   - hold NOELCLAW on Base to unlock premium tools";
      const walletShort = wallet
        ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
        : "not configured";

      const lines = [
        `**Noelclaw Runtime - System Status**`,
        `────────────────────────────────`,
        ``,
        `🔑 **Tier**         ${tierLabel}`,
        `👛 **Wallet**       ${walletShort}`,
        ``,
        `🧠 **Memory**       ${memStatus === "ok" ? "✅" : "⚠️"} ${memTotal} entries · Space: ${mem?.space ?? "-"}`,
        `🤖 **Agents**       ${persistentAgents.length} persistent agent${persistentAgents.length === 1 ? "" : "s"} in vault`,
        `⚡ **Automations**  ${activeAutos.length} active of ${automations.length} total`,
        `📚 **Vault**        ${vaultEntries.length} recent research entries`,
        ``,
      ];

      if (activeAutos.length > 0) {
        lines.push(`**Active Automations:**`);
        for (const a of activeAutos.slice(0, 5)) {
          const next = a.nextRunAt ? ` · next ${new Date(a.nextRunAt).toUTCString()}` : "";
          lines.push(`  • ${a.name} - ${a.triggerType}${next}`);
        }
        lines.push("");
      }

      if (persistentAgents.length > 0) {
        lines.push(`**Persistent Agents:**`);
        for (const a of persistentAgents.slice(0, 5)) {
          const name = a.key.replace(/^agent\//, "");
          lines.push(`  • ${name} - v${a.version ?? 1}`);
        }
        lines.push("");
      }

      if (vaultEntries.length > 0) {
        lines.push(`**Recent Research:**`);
        for (const e of vaultEntries) {
          lines.push(`  • [${e.agentId ?? "vault"}] ${e.title}`);
        }
        lines.push("");
      }

      lines.push(`💡 Run \`deep_research query: "..."\` to launch multi-agent research · \`agent_spawn\` to start a persistent agent`);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "noel_shell_chat": {
      const { message, agent_id } = args as { message: string; agent_id?: string };
      if (!message) return { content: [{ type: "text", text: "Error: message is required" }] };
      // Route to Convex noelShellChat action
      try {
        const res = await fetch(`${CONVEX_SITE}/api/noelShell`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.NOELCLAW_SESSION_TOKEN ?? ""}`,
          },
          body: JSON.stringify({ message, agentId: agent_id ?? "noel-default" }),
        });
        if (!res.ok) {
          return { content: [{ type: "text", text: `Shell chat error: ${res.status} ${res.statusText}` }] };
        }
        const data = await res.json() as { response?: string; actions?: unknown[] };
        let text = data.response ?? "No response from Noel Shell.";
        if (data.actions && Array.isArray(data.actions) && data.actions.length > 0) {
          text += "\n\n**Actions taken:**\n" + (data.actions as Array<{ tool?: string; result?: string }>)
            .map(a => `• \`${a.tool ?? "unknown"}\` → ${a.result ?? "done"}`)
            .join("\n");
        }
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Shell chat failed: ${(err as Error).message}` }] };
      }
    }

    default:
      return null;
  }
}
