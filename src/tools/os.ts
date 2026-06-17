import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";
import { getTier } from "../token-gate.js";
import { getOrCreateWallet } from "../wallet.js";

export const OS_TOOLS: Tool[] = [
  {
    name: "noel_status",
    description:
      "Full runtime dashboard - memory size, persistent agents, active automations, recent vault research, " +
      "execution scores, and your tier. Like `htop` for your AI runtime. " +
      "Run this to see what's running and what state your runtime is currently holding.",
    inputSchema: { type: "object", properties: {}, required: [] },
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

    default:
      return null;
  }
}
