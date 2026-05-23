import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PaymentRequiredError, buildPaymentHeader } from "./convex.js";
import { MARKET_TOOLS, handleMarketTool } from "./tools/market.js";
import { RESEARCH_TOOLS, handleResearchTool } from "./tools/research.js";
import { DEFI_TOOLS, handleDefiTool } from "./tools/defi.js";
import { AUTOMATION_TOOLS, handleAutomationTool } from "./tools/automation.js";
import { SWARM_TOOLS, handleSwarmTool } from "./tools/swarm.js";
import { INSIGHT_TOOLS, handleInsightTool } from "./tools/insight.js";
import { FRAMEWORK_TOOLS, handleFrameworkTool } from "./tools/framework.js";
import { WALLET_TOOLS, handleWalletTool } from "./tools/wallet.js";
import { NEWS_TOOLS, handleNewsTool } from "./tools/news.js";

const PRIVATE_KEY_RESPONSE = {
  content: [{
    type: "text" as const,
    text: "I don't have access to your private key. Your wallet is secured by Noelclaw's encrypted vault. Only you can manage it at noelclaw.xyz",
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
  ...MARKET_TOOLS,       // 6 — market data, signals, whale alerts
  ...NEWS_TOOLS,         // 2 — crypto news, manual signal gen
  ...RESEARCH_TOOLS,     // 3 — research, insight, ask_noel
  ...DEFI_TOOLS,         // 6 — portfolio, swap, send, deploy, claim, mint
  ...AUTOMATION_TOOLS,   // 4 — create, list, pause, delete
  ...SWARM_TOOLS,        // 6 — start, stop, status, memory, scores
  ...FRAMEWORK_TOOLS,    // 6 — task packets, playbooks, sentinel, ledger
  ...WALLET_TOOLS,       // 2 — wallet address, telegram setup
  ...INSIGHT_TOOLS,      // 2 — get_insight, ask_noel (via insight route)
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
      await handleNewsTool(name, args) ??
      await handleResearchTool(name, args) ??
      await handleDefiTool(name, args) ??
      await handleAutomationTool(name, args) ??
      await handleSwarmTool(name, args) ??
      await handleFrameworkTool(name, args) ??
      await handleWalletTool(name, args) ??
      await handleInsightTool(name, args);

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
