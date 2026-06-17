import * as fs from "fs";
import * as path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { PaymentRequiredError, buildPaymentHeader } from "./convex.js";
import { listVaultResources, readVaultResource } from "./resources.js";
import { listPrompts, getPrompt } from "./prompts.js";
import { filterTools } from "./tool-filter.js";

// Read version from package.json so the server announces the same version
// MCP clients see in the npm tarball. Falls back to "unknown" if the file
// can't be loaded - never blocks server startup.
const PKG_VERSION: string = (() => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
})();
import { MARKET_TOOLS, handleMarketTool } from "./tools/market.js";
import { DEFI_TOOLS, handleDefiTool } from "./tools/defi.js";
import { AUTOMATION_TOOLS, handleAutomationTool } from "./tools/automation.js";
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
import { BASE_MCP_TOOLS, handleBaseMcpTool } from "./tools/base-mcp.js";
import { MEMORY_TOOLS, handleMemoryTool } from "./tools/memory.js";
import { OS_TOOLS, handleOsTool } from "./tools/os.js";
import { RESEARCH_TOOLS, handleResearchTool } from "./tools/research.js";
import { DEEP_RESEARCH_TOOLS, handleDeepResearch } from "./tools/deep-research.js";
import { RESEARCH_COMPARE_TOOLS, handleResearchCompare } from "./tools/research-compare.js";
import { RESEARCH_CHAIN_TOOLS, handleResearchChain } from "./tools/research-chain.js";
import { MONITOR_TOOLS, handleMonitorTool } from "./tools/monitor.js";
import { GITHUB_TOOLS, handleGithubTool } from "./tools/github.js";
import { CHRONICLE_TOOLS, handleChronicle } from "./tools/chronicle.js";
import { PACKET_TOOLS, handlePacket } from "./tools/packets.js";
import { getTier, PREMIUM_TOOLS, tokenGateError } from "./token-gate.js";

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
  ...MARKET_TOOLS,       // 5 - get_market_data, get_token_data, compare_tokens, market_overview, token_history
  ...INSIGHT_TOOLS,      // 3 - ask_noel, market_thesis, trade_plan
  ...DEFI_TOOLS,         // 1 - get_defi_yields (swap/send/portfolio/estimate/analyze moved to base_mcp_* in v3.17.5)
  ...AUTOMATION_TOOLS,   // 6 - create, list, pause, delete, get_runs, run
  // SWARM_TOOLS removed v3.19 - multi-agent research is now built into
  // deep_research (depth=standard|deep). Handler fully removed v3.21.
  ...FRAMEWORK_TOOLS,    // 3 - list_playbooks, run_playbook, get_noel_ledger
  ...VAULT_TOOLS,        // 14 - save, read, list, search, history, diff, export, pin, tag, delete, link, related, store_credential, get_credential
  ...WALLET_TOOLS,       // 1 - get_wallet_address (set_telegram removed v3.18 - broken UX, link is web-app only)
  ...MIROSHARK_TOOLS,    // 3 - simulate, status, stop
  ...HUMANIZER_TOOLS,    // 2 - humanize_text, write_content (thread+post merged)
  ...AGENT_TOOLS,        // 12 - list_agents, hire_agent, agent_spawn, agent_recall, agent_update, agent_identity, agent_ledger + agent_schedule, agent_unschedule, agent_pause, agent_resume, agent_runs (v3.18 autonomous)
  ...SCANNER_TOOLS,      // 3 - score_token, check_token, scan_market (dips+momentum merged)
  ...CODER_TOOLS,        // 5 - generate_contract, audit_contract, explain_code, review_code, generate_mcp_skill
  ...BASE_TOOLS,         // 4 - query_vaults, list_markets, prepare_deposit, chain_stats
  ...BASE_MCP_TOOLS,     // 7 - base_mcp_{status,balance,send,swap,estimate,lend,resolve} (analyze removed v3.17.5 - dead backend route)
  ...MEMORY_TOOLS,       // 10 - memory_add, memory_search, memory_context, memory_profile, memory_list, memory_delete, memory_insight, memory_extract, memory_consolidate, memory_publish
  ...OS_TOOLS,           // 1 - noel_status
  ...RESEARCH_TOOLS,       // 2 - web_scrape, web_search
  ...DEEP_RESEARCH_TOOLS,    // 1 - deep_research (plan → search → scrape → synthesize → cite)
  ...RESEARCH_COMPARE_TOOLS, // 1 - research_compare (diff two reports across time)
  ...RESEARCH_CHAIN_TOOLS,   // 1 - research_chain (walk continueFrom evolution timeline)
  ...MONITOR_TOOLS,        // 4 - schedule_research, create_monitor (alias), list_monitors, cancel_monitor
  ...GITHUB_TOOLS,       // 8 - list_repos, list_prs, get_pr, list_issues, get_issue, get_file, get_commits, search_code
  ...CHRONICLE_TOOLS,    // 2 - chronicle_add, chronicle_list
  ...PACKET_TOOLS,       // 4 - packet_create, packet_run, packet_list, packet_share
  // total: 103 (v3.18: set_telegram -1, autonomous agent_* +5; v3.19: SWARM_TOOLS -5 → folded into deep_research)
];

// Build O(1) dispatch map at startup - avoids sequential chained awaits per call
export type Handler = (name: string, args: unknown) => Promise<import("./types.js").ToolResult | null>;
export const HANDLER_MAP = new Map<string, Handler>([
  ...MARKET_TOOLS.map(t      => [t.name, handleMarketTool]      as [string, Handler]),
  ...DEFI_TOOLS.map(t        => [t.name, handleDefiTool]        as [string, Handler]),
  ...AUTOMATION_TOOLS.map(t  => [t.name, handleAutomationTool]  as [string, Handler]),
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
  ...BASE_MCP_TOOLS.map(t    => [t.name, handleBaseMcpTool]    as [string, Handler]),
  ...MEMORY_TOOLS.map(t      => [t.name, handleMemoryTool]      as [string, Handler]),
  ...OS_TOOLS.map(t          => [t.name, handleOsTool]           as [string, Handler]),
  ...RESEARCH_TOOLS.map(t      => [t.name, handleResearchTool]   as [string, Handler]),
  ...DEEP_RESEARCH_TOOLS.map(t   => [t.name, handleDeepResearch]    as [string, Handler]),
  ...RESEARCH_COMPARE_TOOLS.map(t => [t.name, handleResearchCompare] as [string, Handler]),
  ...RESEARCH_CHAIN_TOOLS.map(t   => [t.name, handleResearchChain]   as [string, Handler]),
  ...MONITOR_TOOLS.map(t       => [t.name, handleMonitorTool]    as [string, Handler]),
  ...GITHUB_TOOLS.map(t      => [t.name, handleGithubTool]       as [string, Handler]),
  ...CHRONICLE_TOOLS.map(t   => [t.name, (n: string, a: unknown) => handleChronicle(n, a as Record<string, unknown>)] as [string, Handler]),
  ...PACKET_TOOLS.map(t      => [t.name, (n: string, a: unknown) => handlePacket(n, a as Record<string, unknown>)] as [string, Handler]),
]);

export const server = new Server(
  { name: "noelclaw", version: PKG_VERSION },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

// Tool listing respects NOELCLAW_TOOLS for users who want a smaller surface.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: filterTools(ALL_TOOLS),
}));

// MCP Resources - vault entries surface as `noelclaw://vault/<key>`.
// Clients can pull them via the standard resource flow instead of a Tool
// call, saving per-call schema cost. Listing is best-effort: it never
// throws to avoid breaking the initial handshake on transient backend
// errors.
server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
  // MCP cursor pagination - clients pass `cursor` from the previous response's
  // `nextCursor` to walk past the first 50 entries.
  const cursor = (request.params as { cursor?: string } | undefined)?.cursor;
  return listVaultResources(cursor);
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  return readVaultResource(request.params.uri);
});

// MCP Prompts - high-leverage workflows surface as slash commands in
// supporting clients (Claude Desktop, Cursor, Windsurf, Zed).
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: listPrompts(),
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as Record<string, string>;
  return getPrompt(request.params.name, args);
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (containsSensitiveRequest(args)) return PRIVATE_KEY_RESPONSE;

  if (PREMIUM_TOOLS.has(name)) {
    const tier = await getTier();
    if (tier === "basic") return tokenGateError(name);
  }

  // ─── MCP progress notifications ─────────────────────────────────────────
  // Clients can opt into live progress events by sending `_meta.progressToken`
  // on the call. For long-running tools like deep_research we route through
  // a streaming handler that emits per-stage notifications. Clients that
  // don't pass a token get the standard request/response (no behavior change).
  const progressToken = (request.params as any)._meta?.progressToken;
  if (progressToken && name === "deep_research") {
    let step = 0;
    const onProgress = async (message: string, totalSteps?: number) => {
      step += 1;
      try {
        await server.notification({
          method: "notifications/progress",
          params: {
            progressToken,
            progress: step,
            total: totalSteps,
            message,
          },
        });
      } catch {
        // notifications are best-effort - never block the tool
      }
    };
    try {
      const result = await handleDeepResearch(name, args, onProgress);
      if (result) return result;
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

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
