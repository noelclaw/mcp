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
  ...MARKET_TOOLS,       // 2 — get_market_data, get_token_data
  ...INSIGHT_TOOLS,      // 1 — ask_noel
  ...DEFI_TOOLS,         // 5 — get_portfolio, estimate_swap, swap_tokens, send_token, scan_wallet
  ...AUTOMATION_TOOLS,   // 5 — create, list, pause, delete, get_runs
  ...SWARM_TOOLS,        // 6 — start, stop, status, read/write memory, scores
  ...FRAMEWORK_TOOLS,    // 6 — task packets, playbooks, sentinel, ledger
  ...VAULT_TOOLS,        // 7 — save, read, list, search, history, diff, export
  ...WALLET_TOOLS,       // 2 — get_wallet_address, set_telegram
  ...MIROSHARK_TOOLS,    // 3 — simulate, status, stop
  ...HUMANIZER_TOOLS,    // 1 — humanize_text
  ...AGENT_TOOLS,        // 2 — list_agents, hire_agent
  ...SCANNER_TOOLS,      // 3 — score_token, check_token, scan_dips
  ...CODER_TOOLS,        // 6 — scaffold_project, generate_component, generate_contract, audit_contract, explain_code, review_code
  ...BASE_TOOLS,         // 4 — query_vaults, list_markets, prepare_deposit, chain_stats
  // total: 53
];

export const server = new Server(
  { name: "noelclaw", version: "2.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ALL_TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (containsSensitiveRequest(args)) return PRIVATE_KEY_RESPONSE;

  try {
    const result =
      await handleMarketTool(name, args) ??
      await handleDefiTool(name, args) ??
      await handleAutomationTool(name, args) ??
      await handleSwarmTool(name, args) ??
      await handleFrameworkTool(name, args) ??
      await handleVaultTool(name, args) ??
      await handleWalletTool(name, args) ??
      await handleInsightTool(name, args) ??
      await handleMirosharkTool(name, args) ??
      await handleHumanizerTool(name, args) ??
      await handleAgentTool(name, args) ??
      await handleScannerTool(name, args) ??
      await handleCoderTool(name, args) ??
      await handleBaseTool(name, args);

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
          "Set `NOELCLAW_SESSION_TOKEN` with your Noelclaw session token from noelclaw.xyz",
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
