#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { ethers } from "ethers";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";

const CONVEX_SITE = process.env.NOELCLAW_CONVEX_URL ?? "https://valuable-fish-533.convex.site";

const WALLET_DIR = path.join(os.homedir(), ".noelclaw");
const WALLET_FILE = path.join(WALLET_DIR, "wallet.json");
let _cachedWallet: ethers.Wallet | ethers.HDNodeWallet | null = null;

function getMachineKey(): string {
  return crypto
    .createHash("sha256")
    .update(os.hostname() + os.platform() + os.arch())
    .digest("hex")
    .slice(0, 32);
}

async function getOrCreateWallet(): Promise<ethers.Wallet | ethers.HDNodeWallet> {
  if (_cachedWallet) return _cachedWallet;
  if (fs.existsSync(WALLET_FILE)) {
    try {
      const encrypted = fs.readFileSync(WALLET_FILE, "utf8");
      const wallet = await ethers.Wallet.fromEncryptedJson(encrypted, getMachineKey());
      _cachedWallet = wallet;
      return wallet;
    } catch {
      // fall through to create new wallet
    }
  }
  const wallet = ethers.Wallet.createRandom();
  if (!fs.existsSync(WALLET_DIR)) fs.mkdirSync(WALLET_DIR, { recursive: true });
  const encrypted = await wallet.encrypt(getMachineKey());
  fs.writeFileSync(WALLET_FILE, encrypted, { mode: 0o600 });
  _cachedWallet = wallet;
  return wallet;
}

async function signRequest(toolName: string): Promise<{ address: string; signature: string; timestamp: string }> {
  const wallet = await getOrCreateWallet();
  const timestamp = Date.now().toString();
  const signature = await wallet.signMessage(`noelclaw:${toolName}:${timestamp}`);
  return { address: wallet.address, signature, timestamp };
}

const PRIVATE_KEY_RESPONSE = {
  content: [{
    type: "text" as const,
    text: "I don't have access to your private key. Your wallet is secured by Noelclaw's encrypted vault. Only you can manage it at noelclaw.xyz",
  }],
};

function containsSensitiveRequest(args: unknown): boolean {
  const text = JSON.stringify(args ?? "").toLowerCase();
  return text.includes("private key") || text.includes("seed phrase") || text.includes("mnemonic") || text.includes("privatekey");
}

class PaymentRequiredError extends Error {
  readonly details: unknown;
  constructor(details: unknown) {
    super("Payment required");
    this.name = "PaymentRequiredError";
    this.details = details;
  }
}

export function buildPaymentHeader(txHash: string, requestId: string): string {
  return Buffer.from(`${txHash}:${requestId}`).toString("base64");
}

async function callConvex(path: string, method: string, body?: unknown, toolName = "unknown"): Promise<any> {
  const url = `${CONVEX_SITE}${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const apiKey = process.env.NOELCLAW_API_KEY;
  const sessionToken = process.env.NOELCLAW_SESSION_TOKEN;
  const authHeader = apiKey
    ? `Bearer ${apiKey}`
    : sessionToken
    ? `Bearer ${sessionToken}`
    : null;
  if (authHeader) {
    headers["Authorization"] = authHeader;
  } else {
    try {
      const { address, signature, timestamp } = await signRequest(toolName);
      headers["X-Wallet-Address"] = address;
      headers["X-Wallet-Signature"] = signature;
      headers["X-Wallet-Timestamp"] = timestamp;
    } catch {
      // continue without wallet headers — server will respond with 401/402
    }
  }

  const paymentHeader = process.env.NOELCLAW_PAYMENT_HEADER;
  if (paymentHeader) headers["X-Payment"] = paymentHeader;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });

  if (res.status === 402) {
    const body = await res.json().catch(() => ({})) as {
      tool?: string;
      price?: { amount: number; currency: string };
      payTo?: string;
      memo?: string;
    };
    throw new Error(
      `💳 This tool requires payment or an API key.\n\n` +
      `Option 1 (recommended): Get a free API key at noelclaw.com → Settings → API Keys\n` +
      `Then set: NOELCLAW_API_KEY=noel_sk_xxx\n\n` +
      `Option 2 (pay per call): Send ${body.price?.amount || "?"} ${body.price?.currency || "USDC"} on Base to:\n` +
      `${body.payTo || "Address not available"}\n` +
      `Memo: ${body.memo || "See response for memo"}\n` +
      `Then retry with X-PAYMENT header.`
    );
  }

  if (res.status === 401) {
    const body = await res.json().catch(() => ({})) as {
      message?: string; url?: string; hint?: string; alternative?: string;
    };
    throw new Error(
      `🔑 ${body.message || "Authentication required"}\n\n` +
      `→ Get your API key: ${body.url || "https://noelclaw.com"}\n\n` +
      `Hint: ${body.hint || "Set NOELCLAW_API_KEY=noel_sk_xxx in your MCP config"}\n\n` +
      `${body.alternative ? `Alternative: ${body.alternative}` : ""}`
    );
  }

  if (!res.ok) throw new Error(`Noelclaw API error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

async function notifyTelegram(userId: string, message: string): Promise<{ sent: boolean; reason?: string }> {
  try {
    return await callConvex("/user/telegram/notify", "POST", { userId, message }, "set_telegram");
  } catch {
    return { sent: false, reason: "error" };
  }
}

const TELEGRAM_SETUP_HINT =
  "\n\n⚙️ No Telegram configured. To receive results directly in Telegram:\n" +
  "1. Create a bot via @BotFather on Telegram → get a bot token\n" +
  "2. Get your chat ID from @userinfobot\n" +
  "3. Run the `set_telegram` tool with your userId, bot token, and chat ID";

const TOOLS: Tool[] = [
  {
    name: "get_market_data",
    description:
      "Get live crypto market data: top 20 coins by market cap, trending coins, and key prices for BTC/ETH/SOL. Results are also sent to your Telegram if configured.",
    inputSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Optional: specific token to focus on, e.g. 'BTC', 'ETH'",
        },
      },
      required: [],
    },
  },
  {
    name: "get_token_data",
    description:
      "Get market data for specific tokens. Returns price, 24h change, market cap, and volume. Results are sent to your Telegram if configured.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Describe which tokens to look up, e.g. 'show me data for ETH, SOL, and ARB'",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "get_latest_signal",
    description:
      "Get the latest BTC and/or ETH 1H trading signals from Noel. Includes entry price, take profit targets, stop loss, confidence score, and reasoning. Generated daily at 08:00 UTC.",
    inputSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Token to get signal for: 'BTC', 'ETH', or omit for both",
        },
      },
      required: [],
    },
  },
  {
    name: "get_signal_history",
    description: "Get signal history with win/loss record and winrate statistics.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "BTC or ETH" },
        days: { type: "number", description: "Number of days to look back (default: 7)" },
      },
      required: [],
    },
  },
  {
    name: "get_smart_money_alerts",
    description: "Get smart money and insider wallet movements for micro-cap tokens. Tracks early accumulation by alpha wallets on Base, Solana, and ETH.",
    inputSchema: {
      type: "object",
      properties: {
        hours: {
          type: "number",
          description: "How many hours back to look (default: 24)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_daily_recap",
    description: "Get today's trading performance recap with winrate, PnL stats, and AI review.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format (default: today UTC)",
        },
      },
      required: [],
    },
  },
  {
    name: "research",
    description:
      "Research any crypto topic on demand — like Perplexity but for crypto. Ask about a token, protocol, market event, or trend. Noel searches the web and returns a structured analysis with overview, key findings, market impact, affected tokens, sentiment, and what to watch.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Topic to research, e.g. 'Ethereum ETF approval impact', 'What is happening with SOL?', 'Latest news on Base ecosystem'",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_portfolio",
    description:
      "Get your Base wallet address and full token portfolio including all token balances with USD values. Auto-creates a secure encrypted wallet on first use.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "swap_tokens",
    description:
      "Swap tokens on Base mainnet via 0x Permit2. Supported: ETH, USDC, USDT, DAI, WETH. Amount in smallest unit (wei for ETH/WETH, 6 decimals for USDC/USDT, 18 for DAI). Auto-creates wallet on first use.",
    inputSchema: {
      type: "object",
      properties: {
        fromToken: { type: "string", description: "Token to sell: ETH, USDC, USDT, DAI, WETH" },
        toToken: { type: "string", description: "Token to buy: ETH, USDC, USDT, DAI, WETH" },
        amount: {
          type: "string",
          description: "Amount in smallest unit (e.g. '1000000' = 1 USDC, '1000000000000000000' = 1 ETH)",
        },
      },
      required: ["fromToken", "toToken", "amount"],
    },
  },
  {
    name: "send_token",
    description: "Send ETH or ERC-20 tokens (USDC, USDT, DAI, WETH) to any address on Base mainnet.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Token to send: ETH, USDC, USDT, DAI, WETH" },
        toAddress: { type: "string", description: "Destination address (0x...)" },
        amount: { type: "string", description: "Amount in smallest unit" },
      },
      required: ["token", "toAddress", "amount"],
    },
  },
  {
    name: "ask_noel",
    description:
      "Ask Noel AI for DeFi analysis, trade ideas, market outlook, and crypto research. Noel has live market context. Results are sent to your Telegram if configured.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Your question or request for Noel",
        },
        messages: {
          type: "array",
          description: "Previous conversation messages for context (optional)",
          items: {
            type: "object",
            properties: {
              role: { type: "string", enum: ["user", "assistant"] },
              content: { type: "string" },
            },
            required: ["role", "content"],
          },
        },
      },
      required: ["question"],
    },
  },
  {
    name: "create_automation",
    description:
      "Create an automation in plain English. Supports DCA (buy X daily), price alerts, conditional buys/sells, and recurring market updates. Examples: 'Buy 50 USDC of ETH every day. Stop after spending 500 USDC', 'If ETH drops 5%, buy $100', 'Alert me when BTC dominance drops below 50%', 'Sell 20% of my ETH if it's up 3x'.",
    inputSchema: {
      type: "object",
      properties: {
        rawInput: { type: "string", description: "Plain English description of the automation" },
      },
      required: ["rawInput"],
    },
  },
  {
    name: "list_automations",
    description: "List all your automations — active, paused, and completed — with status, run counts, and next scheduled run.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "pause_automation",
    description: "Pause or resume an automation by ID. Paused automations won't run until resumed.",
    inputSchema: {
      type: "object",
      properties: {
        automationId: { type: "string", description: "Automation ID (from list_automations)" },
      },
      required: ["automationId"],
    },
  },
  {
    name: "delete_automation",
    description: "Permanently delete an automation. Cannot be undone.",
    inputSchema: {
      type: "object",
      properties: {
        automationId: { type: "string", description: "Automation ID (from list_automations)" },
      },
      required: ["automationId"],
    },
  },
  {
    name: "start_swarm",
    description:
      "Start the multi-agent swarm for autonomous market monitoring, sentiment tracking, and workflow execution. Agents coordinate through shared memory and improve over time.",
    inputSchema: {
      type: "object",
      properties: {
        config: {
          type: "object",
          description: "Optional swarm config",
          properties: {
            enabledAgents: {
              type: "array",
              items: { type: "string" },
              description: "Agent IDs to enable: market-monitor, sentiment-tracker, workflow-executor, memory-manager, risk-verifier",
            },
            byok: { type: "boolean", description: "Use your own Bankr API key" },
          },
        },
      },
      required: [],
    },
  },
  {
    name: "stop_swarm",
    description: "Stop the active swarm session for a user.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_swarm_status",
    description:
      "Get the current status of the swarm: active agents, shared memory snapshot, execution scores, and recent runs.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "write_swarm_memory",
    description:
      "Write a key-value pair to the swarm's shared memory. Used by agents to coordinate state across the swarm.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "ID of the agent writing this memory entry" },
        key: { type: "string", description: "Memory key (e.g. 'last_signal', 'btc_sentiment')" },
        value: { type: "string", description: "Value to store (JSON-serializable string)" },
        ttlSeconds: { type: "number", description: "Optional TTL in seconds — entry is auto-deleted after this" },
      },
      required: ["agentId", "key", "value"],
    },
  },
  {
    name: "get_swarm_memory",
    description: "Read a value from the swarm's shared memory by key.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Memory key to read" },
      },
      required: ["key"],
    },
  },
  {
    name: "get_execution_scores",
    description:
      "Get the self-improvement scores for all skills. Shows which workflows are performing best, success/fail rates, and adapted thresholds.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

const server = new Server(
  { name: "noelclaw", version: "1.6.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (containsSensitiveRequest(args)) return PRIVATE_KEY_RESPONSE;

  try {
    switch (name) {
      case "get_market_data": {
        const a = (args ?? {}) as { token?: string };
        const tokenQ = a.token ? `?token=${encodeURIComponent(a.token)}` : "";
        const data = await callConvex(`/mcp/market${tokenQ}`, "GET", undefined, "get_market_data");
        const lines: string[] = [`**Market Data** — ${data.fetchedAt ?? new Date().toISOString()}`, ""];

        if (data.keyPrices) {
          lines.push("**Key Prices**");
          for (const [coin, info] of Object.entries(data.keyPrices as Record<string, any>)) {
            const price = info.usd?.toLocaleString("en-US", { style: "currency", currency: "USD" });
            const change = info.usd_24h_change?.toFixed(2);
            const sign = (info.usd_24h_change ?? 0) >= 0 ? "+" : "";
            lines.push(`• ${coin.toUpperCase()}: ${price} (${sign}${change}%)`);
          }
          lines.push("");
        }

        if (data.trending?.length) {
          lines.push("**Trending** (top 10)");
          for (const c of data.trending) {
            const ch = c.change24h?.toFixed(2);
            const sign = (c.change24h ?? 0) >= 0 ? "+" : "";
            lines.push(`• ${c.name} (${c.symbol?.toUpperCase()}) — rank #${c.rank ?? "?"} ${ch != null ? `${sign}${ch}%` : ""}`);
          }
          lines.push("");
        }

        if (data.top20?.length) {
          lines.push("**Top 20 by Market Cap**");
          lines.push("| # | Name | Price | 24h% |");
          lines.push("|---|------|-------|------|");
          for (const c of data.top20) {
            const price = c.price?.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
            const ch = c.change24h?.toFixed(2);
            const sign = (c.change24h ?? 0) >= 0 ? "+" : "";
            lines.push(`| ${c.rank} | ${c.name} (${c.symbol?.toUpperCase()}) | ${price} | ${sign}${ch}% |`);
          }
        }

        const text = lines.join("\n");
        return { content: [{ type: "text", text }] };
      }

      case "get_token_data": {
        const a = args as { question: string };
        const data = await callConvex("/mcp/chat", "POST", {
          question: a.question,
          agentId: "coingecko-default",
          messages: [],
        }, "get_token_data");
        const answer = data.answer ?? JSON.stringify(data);
        return { content: [{ type: "text", text: answer }] };
      }

      case "get_latest_signal": {
        const a = (args ?? {}) as { token?: string };
        const tokenParam = a.token?.toUpperCase() ?? "both";
        const data = await callConvex(
          `/signals/latest${tokenParam !== "BOTH" && tokenParam !== "both" ? `?token=${encodeURIComponent(tokenParam)}` : ""}`,
          "GET", undefined, "get_latest_signal"
        );
        const lines: string[] = ["**Latest Noel Signals**", ""];
        for (const [tok, sig] of Object.entries(data as Record<string, any>)) {
          if (!sig) { lines.push(`**${tok}:** No signal available`, ""); continue; }
          const emoji = sig.signalType === "BUY" ? "🟢" : sig.signalType === "SELL" ? "🔴" : "🟡";
          lines.push(
            `${emoji} **${tok}/USD — ${sig.signalType}**`,
            `Entry: $${sig.entryPrice?.toLocaleString()} | TP1: $${sig.target1?.toLocaleString()}${sig.target2 ? ` | TP2: $${sig.target2?.toLocaleString()}` : ""} | SL: $${sig.stopLoss?.toLocaleString()}`,
            `Confidence: ${sig.confidence}% | Status: ${sig.status}`,
            `📝 ${sig.reasoning}`,
            "",
          );
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "get_signal_history": {
        const a = (args ?? {}) as { token?: string; days?: number };
        const token = a.token?.toUpperCase() ?? "BTC";
        const days = a.days ?? 7;
        const [hist, wr] = await Promise.all([
          callConvex(`/signals/history?token=${token}&days=${days}`, "GET", undefined, "get_signal_history"),
          callConvex(`/signals/winrate?token=${token}&days=${days}`, "GET", undefined, "get_signal_history"),
        ]);
        const lines: string[] = [
          `**${token} Signal History — Last ${days} days**`,
          `Total: ${wr.total} resolved | Wins: ${wr.wins} | Losses: ${wr.losses}`,
          `Winrate: ${wr.winrate}% | Avg PnL: ${Number(wr.avgPnl) >= 0 ? "+" : ""}${wr.avgPnl}%`,
          `Best: +${wr.bestPnl}% | Worst: ${wr.worstPnl}%`,
          "",
          "**Recent Signals:**",
        ];
        for (const sig of (hist.signals ?? []).slice(0, 5)) {
          const emoji = sig.signalType === "BUY" ? "🟢" : sig.signalType === "SELL" ? "🔴" : "🟡";
          const outcome = sig.isWin === true ? "✅" : sig.isWin === false ? "❌" : "⏳";
          const pnl = sig.pnlPercent != null ? ` (${sig.pnlPercent >= 0 ? "+" : ""}${sig.pnlPercent.toFixed(2)}%)` : "";
          lines.push(`${emoji} ${sig.token} ${sig.signalType} @ $${sig.entryPrice?.toLocaleString()} — ${outcome} ${sig.status}${pnl}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "get_smart_money_alerts": {
        const a = (args ?? {}) as { hours?: number };
        const hours = a.hours ?? 24;
        const data = await callConvex(`/whales/latest?hours=${hours}`, "GET", undefined, "get_smart_money_alerts");
        if (!data.count) return { content: [{ type: "text", text: `No whale alerts in the last ${hours}h.` }] };
        const lines: string[] = [`**Whale Alerts — Last ${hours}h** (${data.count} total)`, ""];
        for (const alert of (data.alerts ?? []).slice(0, 5)) {
          const sig = alert.significance === "HIGH" ? "🔴" : "🟡";
          lines.push(
            `${sig} **${alert.token} | ${alert.direction}**`,
            `${alert.description}`,
            `💡 ${alert.implication}`,
            "",
          );
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "get_daily_recap": {
        const a = (args ?? {}) as { date?: string };
        const date = a.date ?? new Date().toISOString().slice(0, 10);
        let data: any;
        try {
          data = await callConvex("/recap/today", "GET", undefined, "get_daily_recap");
        } catch {
          return { content: [{ type: "text", text: `No recap available for ${date}` }] };
        }
        if (data.error) return { content: [{ type: "text", text: data.error }] };
        const lines: string[] = [
          `**Noel Daily Recap — ${data.date ?? date}**`,
          "",
          `₿ **BTC** — ${data.btcWins}W / ${data.btcLosses}L | Winrate: ${data.btcWinrate?.toFixed(1)}%`,
          `Best: +${data.btcBestPnl?.toFixed(2)}% | Worst: ${data.btcWorstPnl?.toFixed(2)}%`,
          "",
          `Ξ **ETH** — ${data.ethWins}W / ${data.ethLosses}L | Winrate: ${data.ethWinrate?.toFixed(1)}%`,
          `Best: +${data.ethBestPnl?.toFixed(2)}% | Worst: ${data.ethWorstPnl?.toFixed(2)}%`,
          "",
          `**Overall:** ${data.totalWinrate?.toFixed(1)}% winrate | Avg PnL: ${Number(data.avgPnl) >= 0 ? "+" : ""}${data.avgPnl?.toFixed(2)}% per signal`,
          "",
          `🤖 AI Review:`,
          data.aiReview ?? "No review",
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "research": {
        const a = args as { query: string };
        const data = await callConvex("/mcp/research", "POST", { query: a.query }, "research");
        if (!data.success) {
          return { content: [{ type: "text", text: `Research failed: ${data.error ?? "unknown error"}` }] };
        }
        const text = data.text ?? "No results returned.";
        return { content: [{ type: "text", text }] };
      }

      case "get_portfolio": {
        const data = await callConvex("/mcp/defi/portfolio", "GET", undefined, "get_portfolio");
        if (data.error) return { content: [{ type: "text", text: `Portfolio error: ${data.error}` }], isError: true };
        const lines = [
          `**Portfolio — Base Mainnet**`,
          `Address: \`${data.address}\``,
          ``,
          `**Balances**`,
        ];
        for (const b of (data.balances ?? [])) {
          lines.push(`• ${b.token}: ${b.balance}${b.valueUsd ? ` (~$${Number(b.valueUsd).toFixed(2)})` : ""}`);
        }
        lines.push(``, `**Total Value:** ~$${Number(data.totalValueUsd ?? 0).toFixed(2)}`);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "swap_tokens": {
        const a = args as { fromToken: string; toToken: string; amount: string };
        const data = await callConvex("/mcp/defi/swap", "POST", a, "swap_tokens");
        if (data.error) return { content: [{ type: "text", text: `Swap failed: ${data.error}` }], isError: true };
        return {
          content: [{
            type: "text",
            text: [
              `✅ Swap executed!`,
              `${a.fromToken.toUpperCase()} → ${a.toToken.toUpperCase()}`,
              `Sold: ${a.amount} (smallest unit) | Bought: ${data.buyAmount ?? "?"}`,
              `Tx Hash: \`${data.txHash}\``,
              `https://basescan.org/tx/${data.txHash}`,
            ].join("\n"),
          }],
        };
      }

      case "send_token": {
        const a = args as { token: string; toAddress: string; amount: string };
        const data = await callConvex("/mcp/defi/send", "POST", a, "send_token");
        if (data.error) return { content: [{ type: "text", text: `Send failed: ${data.error}` }], isError: true };
        return {
          content: [{
            type: "text",
            text: [
              `✅ Transfer sent!`,
              `${a.token.toUpperCase()} → \`${a.toAddress}\``,
              `Amount: ${a.amount} (smallest unit)`,
              `Tx Hash: \`${data.txHash}\``,
              `https://basescan.org/tx/${data.txHash}`,
            ].join("\n"),
          }],
        };
      }

      case "ask_noel": {
        const a = args as { question: string; messages?: unknown[] };
        const data = await callConvex("/mcp/chat", "POST", {
          question: a.question,
          agentId: "noel-default",
          messages: a.messages ?? [],
        }, "ask_noel");
        const answer = data.answer ?? JSON.stringify(data);
        return { content: [{ type: "text", text: answer }] };
      }

      case "create_automation": {
        const a = args as { rawInput: string };
        const data = await callConvex("/automations/create", "POST", { rawInput: a.rawInput }, "create_automation");
        if (!data.success) {
          return { content: [{ type: "text", text: `Failed: ${data.error}` }], isError: true };
        }
        const triggerLabel: Record<string, string> = {
          schedule: "⏰ Schedule",
          price_drop_pct: "📉 Price Drop %",
          price_rise_pct: "📈 Price Rise %",
          price_below: "⬇️ Price Below",
          price_above: "⬆️ Price Above",
          dominance_below: "📊 Dominance Below",
          dominance_above: "📊 Dominance Above",
        };
        const actionLabel: Record<string, string> = { swap: "💱 Swap", send: "📤 Send", alert: "🔔 Alert" };
        return {
          content: [{
            type: "text",
            text: [
              `✅ **Automation Created**`,
              ``,
              `**Name:** ${data.name}`,
              `**ID:** \`${data.automationId}\``,
              `**Trigger:** ${triggerLabel[data.triggerType] ?? data.triggerType}`,
              `**Action:** ${actionLabel[data.actionType] ?? data.actionType}`,
              data.priceBaselineUsd ? `**Baseline price:** $${Number(data.priceBaselineUsd).toLocaleString()}` : ``,
              ``,
              `Use \`list_automations\` to see all your automations.`,
            ].filter(Boolean).join("\n"),
          }],
        };
      }

      case "list_automations": {
        const data = await callConvex("/automations/list", "GET", undefined, "list_automations");
        if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

        const automations: any[] = data.automations ?? [];
        if (!automations.length) {
          return { content: [{ type: "text", text: "No automations yet. Use `create_automation` to create one." }] };
        }

        const statusIcon: Record<string, string> = { active: "🟢", paused: "⏸️", completed: "✅", error: "❌" };
        const lines: string[] = [`**Your Automations** (${automations.length})`, ""];
        for (const auto of automations) {
          lines.push(`${statusIcon[auto.status] ?? "•"} **${auto.name}** — \`${auto._id}\``);
          lines.push(`  Trigger: ${auto.triggerType} | Action: ${auto.actionType} | Runs: ${auto.totalRuns}`);
          if (auto.totalSpentUsd > 0) lines.push(`  Total spent: $${Number(auto.totalSpentUsd).toFixed(2)}`);
          if (auto.nextRunAt && auto.status === "active") {
            lines.push(`  Next run: ${new Date(auto.nextRunAt).toUTCString()}`);
          }
          if (auto.lastError) lines.push(`  ⚠️ Last error: ${auto.lastError}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "pause_automation": {
        const a = args as { automationId: string };
        const data = await callConvex("/automations/pause", "POST", {
          automationId: a.automationId,
        }, "pause_automation");
        if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
        const icon = data.status === "active" ? "▶️ Resumed" : "⏸️ Paused";
        return { content: [{ type: "text", text: `${icon} successfully.` }] };
      }

      case "delete_automation": {
        const a = args as { automationId: string };
        const data = await callConvex("/automations/delete", "POST", {
          automationId: a.automationId,
        }, "delete_automation");
        if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
        return { content: [{ type: "text", text: "🗑️ Automation deleted." }] };
      }

      case "start_swarm": {
        const a = (args ?? {}) as { config?: { enabledAgents?: string[]; byok?: boolean } };
        const data = await callConvex("/swarm/start", "POST", { config: a.config }, "start_swarm");
        if (!data.success) return { content: [{ type: "text", text: `Failed: ${data.error}` }], isError: true };
        const agents: string[] = data.activeAgents ?? [];
        return {
          content: [{
            type: "text",
            text: [
              `🤖 **Swarm Started**`,
              `Status: ${data.status}`,
              `Active agents (${agents.length}): ${agents.join(", ")}`,
              ``,
              `Use \`get_swarm_status\` to monitor, \`stop_swarm\` to stop.`,
            ].join("\n"),
          }],
        };
      }

      case "stop_swarm": {
        const data = await callConvex("/swarm/stop", "POST", {}, "stop_swarm");
        if (!data.success) return { content: [{ type: "text", text: `Failed: ${data.error}` }], isError: true };
        return { content: [{ type: "text", text: `⏹️ Swarm stopped.` }] };
      }

      case "get_swarm_status": {
        const data = await callConvex("/swarm/status", "GET", undefined, "get_swarm_status");
        if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

        const job = data.job;
        const memory: any[] = data.memory ?? [];
        const scores: any[] = data.scores ?? [];

        const lines: string[] = [
          `🤖 **Swarm Status**`,
          job ? `Status: ${job.status} | Agents: ${(job.activeAgents ?? []).join(", ")}` : `No active swarm.`,
          ``,
        ];

        if (memory.length > 0) {
          lines.push(`**Shared Memory** (${memory.length} entries)`);
          for (const m of memory.slice(0, 5)) {
            lines.push(`• [${m.agentId}] ${m.key}: ${m.value.slice(0, 80)}`);
          }
          if (memory.length > 5) lines.push(`  …and ${memory.length - 5} more`);
          lines.push("");
        }

        if (scores.length > 0) {
          lines.push(`**Execution Scores** (top skills)`);
          const sorted = scores.sort((a, b) => b.lastScore - a.lastScore).slice(0, 5);
          for (const s of sorted) {
            lines.push(`• ${s.skillName}: ${(s.lastScore * 100).toFixed(0)}% | ${s.successCount}W/${s.failCount}L | avg ${Math.round(s.avgDurationMs / 1000)}s`);
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "write_swarm_memory": {
        const a = args as { agentId: string; key: string; value: string; ttlSeconds?: number };
        await callConvex("/swarm/memory/write", "POST", {
          agentId: a.agentId, key: a.key, value: a.value, ttlSeconds: a.ttlSeconds,
        }, "write_swarm_memory");
        return {
          content: [{
            type: "text",
            text: `✅ Memory written: [${a.agentId}] ${a.key}${a.ttlSeconds ? ` (expires in ${a.ttlSeconds}s)` : ""}`,
          }],
        };
      }

      case "get_swarm_memory": {
        const a = args as { key: string };
        const data = await callConvex(`/swarm/memory?key=${encodeURIComponent(a.key)}`, "GET", undefined, "get_swarm_memory");
        if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
        if (data.value === null || data.value === undefined) {
          return { content: [{ type: "text", text: `No value found for key: ${a.key}` }] };
        }
        return { content: [{ type: "text", text: `**${a.key}**: ${data.value}` }] };
      }

      case "get_execution_scores": {
        const data = await callConvex("/swarm/scores", "GET", undefined, "get_execution_scores");
        if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

        const scores: any[] = data.scores ?? [];
        if (!scores.length) {
          return { content: [{ type: "text", text: "No execution scores yet. Run some swarm agents to build a history." }] };
        }

        const sorted = scores.sort((a, b) => b.lastScore - a.lastScore);
        const lines = [
          `**Execution Scores**`,
          ``,
          `| Skill | Score | W | L | Avg Duration | Last Adapted |`,
          `|-------|-------|---|---|--------------|--------------|`,
          ...sorted.map((s) =>
            `| ${s.skillName} | ${(s.lastScore * 100).toFixed(0)}% | ${s.successCount} | ${s.failCount} | ${Math.round(s.avgDurationMs / 1000)}s | ${new Date(s.lastAdaptedAt).toUTCString()} |`
          ),
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err: any) {
    if (err instanceof PaymentRequiredError) {
      const d = (err.details as any)?.paymentDetails;
      const lines = [
        "⚠️ **Payment Required**",
        "",
        "This tool requires a USDC micropayment on Base mainnet.",
        ...(d ? [
          ``,
          `Amount: **${d.amount} USDC**`,
          `To: \`${d.address}\``,
          `Request ID: \`${d.requestId}\``,
          ``,
          "**To pay:**",
          `1. Send ${d.amount} USDC to \`${d.address}\` on Base mainnet`,
          `2. Copy the transaction hash`,
          `3. Set env var: \`NOELCLAW_PAYMENT_HEADER=${buildPaymentHeader("<txHash>", d.requestId)}\``,
          `   (replace \`<txHash>\` with the actual transaction hash)`,
          `4. Retry the tool call`,
          ``,
          "**Or bypass with a session token:**",
          "Set `NOELCLAW_SESSION_TOKEN` with your Noelclaw session token from noelclaw.xyz",
        ] : []),
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
    }
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  try {
    const wallet = await getOrCreateWallet();
    console.error(`[noelclaw] wallet: ${wallet.address}`);
  } catch (err) {
    console.error(`[noelclaw] wallet init failed: ${err}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
