#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

const CONVEX_SITE = process.env.NOELCLAW_CONVEX_URL ?? "https://valuable-fish-533.convex.site";

async function callConvex(path: string, method: string, body?: unknown): Promise<any> {
  const url = `${CONVEX_SITE}${path}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Noelclaw API error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

async function notifyTelegram(userId: string, message: string): Promise<{ sent: boolean; reason?: string }> {
  try {
    return await callConvex("/user/telegram/notify", "POST", { userId, message });
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
      "Get live crypto market data: top 20 coins by market cap, trending coins, and key prices for BTC/ETH/SOL. Results are also sent to your Telegram if configured. First-time: run set_telegram to configure your bot.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "Your user ID — results will be sent to your Telegram bot if configured",
        },
        token: {
          type: "string",
          description: "Optional: specific token to focus on, e.g. 'BTC', 'ETH'",
        },
      },
      required: [],
    },
  },
  {
    name: "ask_noel",
    description:
      "Ask Noel, a crypto AI agent with DeFi trading intelligence and live market context. Best for analysis, trade ideas, and DeFi questions. Results are sent to your Telegram if configured.",
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
        userId: {
          type: "string",
          description: "Your user ID — the answer will be sent to your Telegram bot if configured",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "get_token_data",
    description:
      "Get market data for specific tokens. Returns price, 24h change, market cap, and volume in a clean list. Results are sent to your Telegram if configured.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "Describe which tokens to look up, e.g. 'show me data for ETH, SOL, and ARB'",
        },
        userId: {
          type: "string",
          description: "Your user ID — results will be sent to your Telegram bot if configured",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "run_research",
    description:
      "Trigger Noel's autonomous research cycle on demand. Noel fetches live market data, analyzes trends, and returns structured findings with confidence scores.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "Optional user ID to associate research with (defaults to anonymous)",
        },
      },
      required: [],
    },
  },
  {
    name: "start_research",
    description:
      "Start Noel's 8-hour autonomous research shift. Noel collects market data every 30 minutes, sends interim reports at 2.5h and 5h, and a final comprehensive report at 8h — all via Telegram.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "User ID to associate the research shift with",
        },
        telegramChatId: {
          type: "string",
          description: "Telegram chat ID to send reports to (optional, uses default if not provided)",
        },
        token: {
          type: "string",
          description: "Specific token symbol to focus on e.g. 'ETH', 'SOL' (optional, tracks whole market if not set)",
        },
      },
      required: [],
    },
  },
  {
    name: "stop_research",
    description:
      "Stop Noel's active research shift. Terminates data collection and report scheduling for the given user.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "User ID whose active shift should be stopped",
        },
      },
      required: [],
    },
  },
  {
    name: "get_research_status",
    description:
      "Get the status of Noel's research shift: active job details (elapsed time, remaining time, report count) and the last 3 reports.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "User ID to check research status for",
        },
      },
      required: [],
    },
  },
  {
    name: "get_research_report",
    description:
      "Get the latest research report for a specific token (e.g. 'ETH', 'SOL'). Returns the most recent report generated during a shift that was tracking that token.",
    inputSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Token symbol to get the report for, e.g. 'ETH'",
        },
      },
      required: ["token"],
    },
  },
  {
    name: "create_wallet",
    description:
      "Create a Base mainnet wallet for a user (MCP/agent context). Returns the wallet address. If the user already has a wallet, returns the existing one.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "User ID to create the wallet for",
        },
      },
      required: ["userId"],
    },
  },
  {
    name: "get_wallet_balance",
    description:
      "Get the ETH and USDC balance for a user's Base mainnet wallet created via MCP.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "User ID to get wallet balance for",
        },
      },
      required: ["userId"],
    },
  },
  {
    name: "set_telegram",
    description:
      "Configure a user's personal Telegram bot token and chat ID for receiving Noel research reports. Users must set this up before starting a research shift to receive Telegram notifications.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "User ID to configure Telegram for",
        },
        telegramBotToken: {
          type: "string",
          description: "Telegram bot token (get from @BotFather)",
        },
        telegramChatId: {
          type: "string",
          description: "Telegram chat ID to send messages to (your personal chat ID or a group)",
        },
      },
      required: ["userId"],
    },
  },
  {
    name: "get_latest_signal",
    description:
      "Get the latest BTC and/or ETH trading signals from Noel. Includes entry price, take profit targets, stop loss, confidence score, and reasoning.",
    inputSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Token to get signal for: 'BTC', 'ETH', or 'both' (default: both)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_whale_alerts",
    description:
      "Get recent whale movement and smart money activity alerts for BTC and ETH.",
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
    name: "get_signal_history",
    description:
      "Get signal history with win/loss record and winrate statistics.",
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
    name: "get_daily_recap",
    description:
      "Get today's trading performance recap with winrate, PnL stats, and AI review.",
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
    name: "connect_wallet",
    description:
      "Create or retrieve a Base mainnet DeFi wallet (Privy Server Wallet). Returns the wallet address. Run this before swap_tokens, send_token, deploy_token, or get_portfolio.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "Your user ID" },
      },
      required: ["userId"],
    },
  },
  {
    name: "swap_tokens",
    description:
      "Swap tokens on Base mainnet via 0x Permit2. Supports ETH, USDC, USDT, DAI, WETH. Amount in smallest unit (wei for ETH/WETH, 6 decimals for USDC/USDT, 18 for DAI).",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "Your user ID" },
        fromToken: { type: "string", description: "Token to sell: ETH, USDC, USDT, DAI, WETH" },
        toToken: { type: "string", description: "Token to buy: ETH, USDC, USDT, DAI, WETH" },
        amount: {
          type: "string",
          description: "Amount in smallest unit (e.g. '1000000' = 1 USDC, '1000000000000000000' = 1 ETH)",
        },
      },
      required: ["userId", "fromToken", "toToken", "amount"],
    },
  },
  {
    name: "send_token",
    description:
      "Send ETH or ERC-20 tokens (USDC, USDT, DAI, WETH) to any address on Base mainnet.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "Your user ID" },
        token: { type: "string", description: "Token to send: ETH, USDC, USDT, DAI, WETH" },
        toAddress: { type: "string", description: "Destination address (0x...)" },
        amount: { type: "string", description: "Amount in smallest unit" },
      },
      required: ["userId", "token", "toAddress", "amount"],
    },
  },
  {
    name: "deploy_token",
    description:
      "Deploy a new memecoin on Base via Bankr AI (uses Flaunch or Clanker automatically). Use upload_image first to prepare your token image. Bankr handles IPFS upload and contract deployment — no wallet setup needed.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Full token name, e.g. 'Moon Cat Token'" },
        symbol: { type: "string", description: "Token symbol, e.g. 'MCAT'" },
        description: { type: "string", description: "Short description of the token (optional)" },
        imageUrl: { type: "string", description: "Cloudinary or public image URL from upload_image (optional)" },
        initialBuyEth: {
          type: "string",
          description: "Initial ETH amount to buy on deploy, e.g. '0.01' (optional)",
        },
        userId: { type: "string", description: "Optional user ID for tracking" },
      },
      required: ["name", "symbol"],
    },
  },
  {
    name: "upload_image",
    description:
      "Upload an image for token deployment. Accepts a public image URL or base64-encoded image. Returns an optimized Cloudinary URL ready to use as imageUrl in deploy_token.",
    inputSchema: {
      type: "object",
      properties: {
        imageUrl: { type: "string", description: "Public image URL to upload to Cloudinary" },
        imageBase64: { type: "string", description: "Base64-encoded image (without the data:... prefix)" },
        fileName: { type: "string", description: "Optional filename/public_id for the uploaded image" },
      },
      required: [],
    },
  },
  {
    name: "get_portfolio",
    description:
      "Get the token balances and total USD value for a user's DeFi wallet on Base mainnet.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "Your user ID" },
      },
      required: ["userId"],
    },
  },
];

const server = new Server(
  { name: "noelclaw", version: "1.3.2" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_market_data": {
        const a = (args ?? {}) as { userId?: string; token?: string };
        const tokenQ = a.token ? `?token=${encodeURIComponent(a.token)}` : "";
        const data = await callConvex(`/mcp/market${tokenQ}`, "GET");
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

        let text = lines.join("\n");
        if (a.userId) {
          const tgMsg = `📊 Market Data — ${data.fetchedAt ?? new Date().toISOString()}\n\n` +
            lines.filter((l) => !l.startsWith("|") && !l.startsWith("**Top")).join("\n").slice(0, 3800) +
            "\n\n— via Noelclaw";
          const notif = await notifyTelegram(a.userId, tgMsg);
          if (!notif.sent && notif.reason === "no_config") text += TELEGRAM_SETUP_HINT;
          else if (notif.sent) text += "\n\n✅ _Sent to your Telegram._";
        }
        return { content: [{ type: "text", text }] };
      }

      case "ask_noel": {
        const a = args as { question: string; messages?: unknown[]; userId?: string };
        const data = await callConvex("/mcp/chat", "POST", {
          question: a.question,
          agentId: "noel-default",
          messages: a.messages ?? [],
        });
        let answer = data.answer ?? JSON.stringify(data);
        if (a.userId) {
          const tgMsg = `🤖 Noel:\n\n${answer}`.slice(0, 4000) + "\n\n— via Noelclaw";
          const notif = await notifyTelegram(a.userId, tgMsg);
          if (!notif.sent && notif.reason === "no_config") answer += TELEGRAM_SETUP_HINT;
          else if (notif.sent) answer += "\n\n✅ _Sent to your Telegram._";
        }
        return { content: [{ type: "text", text: answer }] };
      }

      case "get_token_data": {
        const a = args as { question: string; userId?: string };
        const data = await callConvex("/mcp/chat", "POST", {
          question: a.question,
          agentId: "coingecko-default",
          messages: [],
        });
        let answer = data.answer ?? JSON.stringify(data);
        if (a.userId) {
          const tgMsg = `🔍 Token Data:\n\n${answer}`.slice(0, 4000) + "\n\n— via Noelclaw";
          const notif = await notifyTelegram(a.userId, tgMsg);
          if (!notif.sent && notif.reason === "no_config") answer += TELEGRAM_SETUP_HINT;
          else if (notif.sent) answer += "\n\n✅ _Sent to your Telegram._";
        }
        return { content: [{ type: "text", text: answer }] };
      }

      case "run_research": {
        const a = (args ?? {}) as { userId?: string };
        const data = await callConvex("/mcp/research", "POST", {
          userId: a.userId ?? "mcp-anonymous",
        });

        if (!data.success) {
          return { content: [{ type: "text", text: `Research failed: ${data.error ?? "unknown error"}` }] };
        }

        const r = data.result;
        const summary = r?.shortSummary ?? r?.summary ?? "No summary available";
        const lines: string[] = [
          `**Noel Research** — ${r?.generatedAt ?? new Date().toISOString()}`,
          "",
          `**Outlook:** ${r?.marketOutlook ?? "neutral"}`,
          "",
          `**Summary:** ${summary}`,
        ];

        if (r?.fullAnalysis && r.fullAnalysis !== summary) {
          lines.push("", r.fullAnalysis);
        }

        const impacts = r?.impacts ?? r?.findings ?? [];
        if (impacts.length) {
          lines.push("", "**Key Impacts:**");
          for (const f of impacts) {
            const label = f.title ?? `${f.token} (${f.symbol})`;
            const detail = f.detail ?? f.rationale ?? "";
            const conf = ((f.confidence ?? f.confidenceScore ?? 0) * 100).toFixed(0);
            const emoji = f.sentiment === "bullish" ? "🟢" : f.sentiment === "bearish" ? "🔴" : "🟡";
            lines.push(`${emoji} **${label}** _(${conf}% conf)_`);
            if (detail) lines.push(`   ${detail}`);
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "start_research": {
        const a = (args ?? {}) as { userId?: string; telegramChatId?: string; token?: string };
        const data = await callConvex("/mcp/research/start", "POST", {
          userId: a.userId ?? "mcp-anonymous",
          telegramChatId: a.telegramChatId,
          token: a.token,
        });
        if (!data.success) {
          return { content: [{ type: "text", text: `Failed to start shift: ${data.error ?? "unknown error"}` }], isError: true };
        }
        const startedAt = data.startedAt ? new Date(data.startedAt).toUTCString() : "now";
        const stopsAt = data.stopsAt ? new Date(data.stopsAt).toUTCString() : "in 8 hours";
        const tokenLine = a.token ? `**Tracking:** ${a.token.toUpperCase()}` : `**Tracking:** whole market`;
        return {
          content: [{
            type: "text",
            text: [
              `🚀 **Noel Research Shift Started**`,
              ``,
              `**Job ID:** ${data.jobId}`,
              tokenLine,
              `**Started:** ${startedAt}`,
              `**Ends:** ${stopsAt}`,
              ``,
              `Noel will collect market data every 30 minutes.`,
              `Interim reports sent via Telegram at 2.5h and 5h.`,
              `Final report at 8h.`,
            ].join("\n"),
          }],
        };
      }

      case "stop_research": {
        const a = (args ?? {}) as { userId?: string };
        const data = await callConvex("/mcp/research/stop", "POST", {
          userId: a.userId ?? "mcp-anonymous",
        });
        if (!data.success) {
          return { content: [{ type: "text", text: `Failed to stop shift: ${data.error ?? "unknown error"}` }], isError: true };
        }
        return {
          content: [{
            type: "text",
            text: data.stopped > 0
              ? `✅ Research shift stopped (${data.stopped} job${data.stopped > 1 ? "s" : ""} terminated).`
              : `ℹ️ No active research shift found.`,
          }],
        };
      }

      case "get_research_status": {
        const a = (args ?? {}) as { userId?: string };
        const data = await callConvex(
          `/mcp/research/status?userId=${encodeURIComponent(a.userId ?? "mcp-anonymous")}`,
          "GET"
        );
        const lines: string[] = ["**Noel Research Status**", ""];

        if (data.activeJob) {
          const j = data.activeJob;
          lines.push(`**Active Shift**`);
          lines.push(`• Status: running`);
          lines.push(`• Elapsed: ${j.elapsedMinutes} min`);
          lines.push(`• Remaining: ${j.remainingMinutes} min`);
          lines.push(`• Interim reports sent: ${j.interimReportsCount}/2`);
          lines.push(`• Final report sent: ${j.finalReportSent ? "yes" : "no"}`);
        } else {
          lines.push(`**No active shift.** Use \`start_research\` to begin.`);
        }

        if (data.recentReports?.length) {
          lines.push("", "**Recent Reports**");
          for (const r of data.recentReports) {
            const emoji = r.outlook === "bullish" ? "🟢" : r.outlook === "bearish" ? "🔴" : "🟡";
            lines.push(`${emoji} [${r.type.toUpperCase()}] ${r.generatedAt}`);
            if (r.summary) lines.push(`   ${r.summary}`);
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "get_research_report": {
        const a = args as { token: string };
        const data = await callConvex(
          `/mcp/research/report?token=${encodeURIComponent(a.token)}`,
          "GET"
        );
        if (!data || data.error) {
          return { content: [{ type: "text", text: `No report found for ${a.token}` }] };
        }
        const r = data.result ?? {};
        const lines: string[] = [
          `**Latest Research Report — ${a.token.toUpperCase()}**`,
          `Generated: ${data.generatedAt ? new Date(data.generatedAt).toUTCString() : "unknown"}`,
          `Type: ${data.type ?? "unknown"} | Outlook: ${r.marketOutlook ?? "neutral"}`,
          "",
          r.shortSummary ?? "",
        ];
        if (r.fullAnalysis) {
          lines.push("", "**Analysis:**", r.fullAnalysis.slice(0, 1000));
        }
        const impacts: any[] = r.impacts ?? [];
        if (impacts.length) {
          lines.push("", "**Key Signals:**");
          for (const f of impacts.slice(0, 4)) {
            const e = f.sentiment === "bullish" ? "🟢" : f.sentiment === "bearish" ? "🔴" : "🟡";
            lines.push(`${e} ${f.title} — ${f.detail ?? ""}`);
          }
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "create_wallet": {
        const a = args as { userId: string };
        const data = await callConvex("/mcp/wallet/create", "POST", { userId: a.userId });
        return {
          content: [{
            type: "text",
            text: data.existing
              ? `Wallet already exists:\n**Address:** \`${data.address}\`\nNetwork: Base Mainnet`
              : `✅ Wallet created!\n**Address:** \`${data.address}\`\nNetwork: Base Mainnet\n\nFund with ETH and USDC to start trading.`,
          }],
        };
      }

      case "get_wallet_balance": {
        const a = args as { userId: string };
        const data = await callConvex(
          `/mcp/wallet/balance?userId=${encodeURIComponent(a.userId)}`,
          "GET"
        );
        if (!data || data.error) {
          return { content: [{ type: "text", text: `No wallet found. Use create_wallet first.` }] };
        }
        return {
          content: [{
            type: "text",
            text: [
              `**Wallet Balance** (${data.network})`,
              `Address: \`${data.address}\``,
              ``,
              `ETH: ${data.eth}`,
              `USDC: $${data.usdc}`,
            ].join("\n"),
          }],
        };
      }

      case "set_telegram": {
        const a = args as { userId: string; telegramBotToken?: string; telegramChatId?: string };
        await callConvex("/user/telegram", "POST", {
          userId: a.userId,
          telegramBotToken: a.telegramBotToken,
          telegramChatId: a.telegramChatId,
        });
        return {
          content: [{
            type: "text",
            text: [
              `✅ Telegram config saved for user ${a.userId}.`,
              a.telegramBotToken ? `Bot token: set` : ``,
              a.telegramChatId ? `Chat ID: ${a.telegramChatId}` : ``,
              ``,
              `Noel will now send research reports to your Telegram bot.`,
            ].filter(Boolean).join("\n"),
          }],
        };
      }

      case "get_latest_signal": {
        const a = (args ?? {}) as { token?: string };
        const tokenParam = a.token?.toUpperCase() ?? "both";
        const data = await callConvex(
          `/signals/latest${tokenParam !== "BOTH" && tokenParam !== "both" ? `?token=${encodeURIComponent(tokenParam)}` : ""}`,
          "GET"
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

      case "get_whale_alerts": {
        const a = (args ?? {}) as { hours?: number };
        const hours = a.hours ?? 24;
        const data = await callConvex(`/whales/latest?hours=${hours}`, "GET");
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

      case "get_signal_history": {
        const a = (args ?? {}) as { token?: string; days?: number };
        const token = a.token?.toUpperCase() ?? "BTC";
        const days = a.days ?? 7;
        const [hist, wr] = await Promise.all([
          callConvex(`/signals/history?token=${token}&days=${days}`, "GET"),
          callConvex(`/signals/winrate?token=${token}&days=${days}`, "GET"),
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

      case "get_daily_recap": {
        const a = (args ?? {}) as { date?: string };
        const date = a.date ?? new Date().toISOString().slice(0, 10);
        let data: any;
        try {
          data = await callConvex("/recap/today", "GET");
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

      case "connect_wallet": {
        const a = args as { userId: string };
        const data = await callConvex("/mcp/defi/connect", "POST", { userId: a.userId });
        if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
        return {
          content: [{
            type: "text",
            text: [
              data.existing ? `Wallet already exists:` : `✅ New DeFi wallet created!`,
              `**Address:** \`${data.address}\``,
              `Network: Base Mainnet`,
              ``,
              `Fund with ETH or USDC on Base, then use swap_tokens, send_token, or deploy_token.`,
            ].join("\n"),
          }],
        };
      }

      case "swap_tokens": {
        const a = args as { userId: string; fromToken: string; toToken: string; amount: string };
        const data = await callConvex("/mcp/defi/swap", "POST", a);
        if (data.error === "NO_WALLET") return { content: [{ type: "text", text: `No wallet found. Run connect_wallet first.` }], isError: true };
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
        const a = args as { userId: string; token: string; toAddress: string; amount: string };
        const data = await callConvex("/mcp/defi/send", "POST", a);
        if (data.error === "NO_WALLET") return { content: [{ type: "text", text: `No wallet found. Run connect_wallet first.` }], isError: true };
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

      case "deploy_token": {
        const a = (args ?? {}) as { name: string; symbol: string; description?: string; imageUrl?: string; initialBuyEth?: string; userId?: string };
        const data = await callConvex("/mcp/defi/deploy", "POST", a);
        if (data.error) return { content: [{ type: "text", text: `Deploy failed: ${data.error}` }], isError: true };
        const lines = [
          `🚀 Token deploy initiated on Base!`,
          `**Name:** ${a.name} (${a.symbol.toUpperCase()})`,
        ];
        if (data.contractAddress) {
          lines.push(`**Contract:** \`${data.contractAddress}\``);
          lines.push(`Basescan: https://basescan.org/address/${data.contractAddress}`);
          lines.push(`Flaunch: https://flaunch.gg/base/token/${data.contractAddress}`);
        }
        if (data.txHash) lines.push(`**Tx Hash:** \`${data.txHash}\``);
        if (data.bankrResponse) lines.push(``, `**Bankr:** ${data.bankrResponse}`);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "upload_image": {
        const a = (args ?? {}) as { imageUrl?: string; imageBase64?: string; fileName?: string };
        if (!a.imageUrl && !a.imageBase64) {
          return { content: [{ type: "text", text: `Provide imageUrl or imageBase64.` }], isError: true };
        }
        const data = await callConvex("/mcp/image/upload", "POST", a);
        if (data.error) return { content: [{ type: "text", text: `Upload failed: ${data.error}${data.detail ? ` — ${data.detail}` : ""}` }], isError: true };
        return {
          content: [{
            type: "text",
            text: [
              `✅ Image uploaded to Cloudinary!`,
              `**URL:** ${data.cloudinaryUrl}`,
              `**Public ID:** ${data.publicId}`,
              ``,
              `Pass this URL as imageUrl in deploy_token.`,
            ].join("\n"),
          }],
        };
      }

      case "get_portfolio": {
        const a = args as { userId: string };
        const data = await callConvex(`/mcp/defi/portfolio?userId=${encodeURIComponent(a.userId)}`, "GET");
        if (data.error === "NO_WALLET") return { content: [{ type: "text", text: `No wallet found. Run connect_wallet first.` }], isError: true };
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

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
