import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PaymentRequiredError, buildPaymentHeader } from "./convex.js";
import { MARKET_TOOLS, handleMarketTool } from "./tools/market.js";
import { DEFI_TOOLS, handleDefiTool } from "./tools/defi.js";
import { AUTOMATION_TOOLS, handleAutomationTool } from "./tools/automation.js";
import { SWARM_TOOLS, handleSwarmTool } from "./tools/swarm.js";
import { INSIGHT_TOOLS, handleInsightTool } from "./tools/insight.js";
import { FRAMEWORK_TOOLS, handleFrameworkTool } from "./tools/framework.js";
import { WALLET_TOOLS, handleWalletTool } from "./tools/wallet.js";
import { VAULT_TOOLS, handleVaultTool } from "./tools/vault.js";
import { MIROSHARK_TOOLS, handleMirosharkTool } from "./tools/miroshark.js";
import { HUMANIZER_TOOLS, handleHumanizerTool } from "./tools/humanizer.js";
import { AGENT_TOOLS, handleAgentTool } from "./tools/agents.js";
import { SCANNER_TOOLS, handleScannerTool } from "./tools/scanner.js";
import { CODER_TOOLS, handleCoderTool } from "./tools/coder.js";
import { BASE_TOOLS, handleBaseTool } from "./tools/base.js";
import { MEMORY_TOOLS, handleMemoryTool } from "./tools/memory.js";
import { OS_TOOLS, handleOsTool } from "./tools/os.js";
import { RESEARCH_TOOLS, handleResearchTool } from "./tools/research.js";
import { MONITOR_TOOLS, handleMonitorTool } from "./tools/monitor.js";

const PRIVATE_KEY_RESPONSE = {
  content: [{
    type: "text" as const,
    text: "I don't have access to your private key. Your wallet is secured by Noelclaw's encrypted vault. Only you can manage it at noelclaw.com",
  }],
};

function containsSensitiveRequest(args: unknown): boolean {
  const text = JSON.stringify(args ?? "").toLowerCase();
  return (
    text.includes("private key") ||
    text.includes("seed phrase") ||
    text.includes("mnemonic") ||
    text.includes("privatekey")
  );
}

export const ALL_TOOLS = [
  ...MARKET_TOOLS,       // 5 — get_market_data, get_token_data, compare_tokens, market_overview, token_history
  ...INSIGHT_TOOLS,      // 3 — ask_noel, market_thesis, trade_plan
  ...DEFI_TOOLS,         // 6 — get_portfolio, estimate_swap, swap_tokens, send_token, analyze_wallet, get_defi_yields
  ...AUTOMATION_TOOLS,   // 6 — create, list, pause, delete, get_runs, run
  ...SWARM_TOOLS,        // 6 — start, stop, status, research, trigger_agent, brief
  ...FRAMEWORK_TOOLS,    // 3 — list_playbooks, run_playbook, get_noel_ledger
  ...VAULT_TOOLS,        // 12 — save, read, list, search, history, diff, export, store_credential, get_credential, pin, delete, tag
  ...WALLET_TOOLS,       // 2 — get_wallet_address, set_telegram
  ...MIROSHARK_TOOLS,    // 3 — simulate, status, stop
  ...HUMANIZER_TOOLS,    // 3 — humanize_text, write_thread, write_post
  ...AGENT_TOOLS,        // 2 — list_agents, hire_agent
  ...SCANNER_TOOLS,      // 4 — score_token, check_token, scan_dips, scan_momentum
  ...CODER_TOOLS,        // 5 — generate_contract, audit_contract, explain_code, review_code, generate_mcp_skill
  ...BASE_TOOLS,         // 4 — query_vaults, list_markets, prepare_deposit, chain_stats
  ...MEMORY_TOOLS,       // 9 — memory_add, memory_search, memory_context, memory_profile, memory_list, memory_delete, memory_insight, memory_extract, memory_consolidate
  ...OS_TOOLS,           // 3 — noel_status, noel_boot, noel_shutdown
  ...RESEARCH_TOOLS,     // 2 — web_scrape, web_search
  ...MONITOR_TOOLS,      // 3 — create_monitor, list_monitors, cancel_monitor
  // total: 81
];

// Build O(1) dispatch map at startup — avoids sequential chained awaits per call
export type Handler = (name: string, args: unknown) => Promise<import("./types.js").ToolResult | null>;
export const HANDLER_MAP = new Map<string, Handler>([
  ...MARKET_TOOLS.map(t      => [t.name, handleMarketTool]      as [string, Handler]),
  ...DEFI_TOOLS.map(t        => [t.name, handleDefiTool]        as [string, Handler]),
  ...AUTOMATION_TOOLS.map(t  => [t.name, handleAutomationTool]  as [string, Handler]),
  ...SWARM_TOOLS.map(t       => [t.name, handleSwarmTool]       as [string, Handler]),
  ...FRAMEWORK_TOOLS.map(t   => [t.name, handleFrameworkTool]   as [string, Handler]),
  ...VAULT_TOOLS.map(t       => [t.name, handleVaultTool]       as [string, Handler]),
  ...WALLET_TOOLS.map(t      => [t.name, handleWalletTool]      as [string, Handler]),
  ...INSIGHT_TOOLS.map(t     => [t.name, handleInsightTool]     as [string, Handler]),
  ...MIROSHARK_TOOLS.map(t   => [t.name, handleMirosharkTool]   as [string, Handler]),
  ...HUMANIZER_TOOLS.map(t   => [t.name, handleHumanizerTool]   as [string, Handler]),
  ...AGENT_TOOLS.map(t       => [t.name, handleAgentTool]       as [string, Handler]),
  ...SCANNER_TOOLS.map(t     => [t.name, handleScannerTool]     as [string, Handler]),
  ...CODER_TOOLS.map(t       => [t.name, handleCoderTool]       as [string, Handler]),
  ...BASE_TOOLS.map(t        => [t.name, handleBaseTool]        as [string, Handler]),
  ...MEMORY_TOOLS.map(t      => [t.name, handleMemoryTool]      as [string, Handler]),
  ...OS_TOOLS.map(t          => [t.name, handleOsTool]           as [string, Handler]),
  ...RESEARCH_TOOLS.map(t    => [t.name, handleResearchTool]     as [string, Handler]),
  ...MONITOR_TOOLS.map(t     => [t.name, handleMonitorTool]      as [string, Handler]),
]);

export const server = new Server(
  { name: "noelclaw", version: "3.2.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ALL_TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (containsSensitiveRequest(args)) return PRIVATE_KEY_RESPONSE;

  const handler = HANDLER_MAP.get(name);
  if (!handler) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }

  try {
    const result = await handler(name, args);
    if (result) return result;
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  } catch (err: any) {
    if (err instanceof PaymentRequiredError) {
      const d = (err.details as any)?.paymentDetails;
      const lines = [
        "⚠️ **Payment Required**", "",
        "This tool requires a USDC micropayment on Base mainnet.",
        ...(d ? [
          ``, `Amount: **${d.amount} USDC**`, `To: \`${d.address}\``, `Request ID: \`${d.requestId}\``, ``,
          "**To pay:**",
          `1. Send ${d.amount} USDC to \`${d.address}\` on Base mainnet`,
          `2. Copy the transaction hash`,
          `3. Set env var: \`NOELCLAW_PAYMENT_HEADER=${buildPaymentHeader("<txHash>", d.requestId)}\``,
          `   (replace \`<txHash>\` with the actual transaction hash)`,
          `4. Retry the tool call`, ``,
          "**Or bypass with a session token:**",
          "Set `NOELCLAW_SESSION_TOKEN` with your Noelclaw session token from noelclaw.com",
        ] : []),
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
    }
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

export async function startServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
