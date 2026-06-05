import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { getOrCreateWallet, signAndBroadcast } from "../wallet.js";
import { ToolResult } from "../types.js";

export const DEFI_TOOLS: Tool[] = [
  {
    name: "get_portfolio",
    description: "Get current token balances and total portfolio value for your MCP wallet on Base. Always call this before swapping to confirm available balance.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "estimate_swap",
    description: "Preview a swap — get the expected output amount and price impact without executing. Use this before swap_tokens to confirm the rate is acceptable.",
    inputSchema: {
      type: "object",
      properties: {
        fromToken: { type: "string", description: "Token to sell: ETH, USDC, USDT, DAI, WETH" },
        toToken: { type: "string", description: "Token to buy: ETH, USDC, USDT, DAI, WETH" },
        amount: { type: "string", description: "Amount to swap (e.g. '0.01', '50', '100%')" },
      },
      required: ["fromToken", "toToken", "amount"],
    },
  },
  {
    name: "swap_tokens",
    description: "Swap tokens on Base mainnet via 0x Permit2. Supported: ETH, USDC, USDT, DAI, WETH. Amount is human-readable. Signed and broadcast locally from your wallet.",
    inputSchema: {
      type: "object",
      properties: {
        fromToken: { type: "string", description: "Token to sell: ETH, USDC, USDT, DAI, WETH" },
        toToken: { type: "string", description: "Token to buy: ETH, USDC, USDT, DAI, WETH" },
        amount: { type: "string", description: "Amount to swap. Human-readable (e.g. '0.001') or percentage of balance (e.g. '50%', '100%')" },
      },
      required: ["fromToken", "toToken", "amount"],
    },
  },
  {
    name: "send_token",
    description: "Send ETH or ERC-20 tokens (USDC, USDT, DAI, WETH) to any address on Base mainnet. Signed and broadcast locally from your wallet.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Token to send: ETH, USDC, USDT, DAI, WETH" },
        toAddress: { type: "string", description: "Destination address (0x...)" },
        amount: { type: "string", description: "Human-readable amount" },
      },
      required: ["token", "toAddress", "amount"],
    },
  },
  {
    name: "analyze_wallet",
    description:
      "AI-powered analysis of any public wallet on Base — not just your own. " +
      "Enter any 0x address: see token holdings, portfolio value, concentration risk, " +
      "DeFi positions, and a behavioral profile (whale, degen, LP provider, etc.). " +
      "Use to track smart money, research whales, or audit any wallet before copying trades.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Wallet address to analyze (0x...)" },
        label: { type: "string", description: "Optional label for this wallet (e.g. 'whale from Twitter')" },
      },
      required: ["address"],
    },
  },
  {
    name: "get_defi_yields",
    description:
      "Fetch top DeFi yield opportunities on Base — Morpho, Moonwell, Aerodrome, Uniswap, and more. " +
      "Returns live APY, TVL, and pool info from DeFiLlama (no API key required). " +
      "Filter by token or minimum APY. Use before depositing to find the best rates.",
    inputSchema: {
      type: "object",
      properties: {
        token:  { type: "string", description: "Optional: filter by token symbol, e.g. 'USDC', 'ETH', 'WETH'" },
        minApy: { type: "number", description: "Optional: minimum APY % to show (default 1)" },
        limit:  { type: "number", description: "Max results to return (default 20)" },
      },
      required: [],
    },
  },
];

const SwapSchema = z.object({ fromToken: z.string().min(1), toToken: z.string().min(1), amount: z.string().min(1) });
const SendSchema = z.object({ token: z.string().min(1), toAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a valid 0x address"), amount: z.string().min(1) });
const AnalyzeWalletSchema = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a valid 0x address"), label: z.string().optional() });
const DefiYieldsSchema = z.object({
  token:  z.string().optional(),
  minApy: z.number().optional(),
  limit:  z.number().int().min(1).max(100).optional(),
}).default({});

const BUY_DECIMALS: Record<string, number> = { USDC: 6, USDT: 6, DAI: 18, ETH: 18, WETH: 18 };

function formatTokenAmount(raw: string, token: string): string {
  const dec = BUY_DECIMALS[token.toUpperCase()] ?? 18;
  return (parseInt(raw) / Math.pow(10, dec)).toFixed(dec === 6 ? 2 : 6);
}

export async function handleDefiTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "get_portfolio": {
      const result = await callConvex("/mcp/defi/portfolio", "GET", undefined, "get_portfolio");
      if (result.error) return { content: [{ type: "text", text: `Portfolio fetch failed: ${result.error}` }], isError: true };

      const balances: any[] = result.balances ?? [];
      const totalUsd: number = result.totalUsd ?? balances.reduce((s: number, b: any) => s + (b.valueUsd ?? 0), 0);

      if (!balances.length) {
        return { content: [{ type: "text", text: "Your wallet has no tokens yet. Send ETH or USDC on Base to get started." }] };
      }

      const lines = [`**Portfolio** — Total: $${totalUsd.toFixed(2)}`, ""];
      for (const b of balances) {
        const value = b.valueUsd != null ? ` ($${Number(b.valueUsd).toFixed(2)})` : "";
        lines.push(`• **${b.token ?? b.symbol}**: ${Number(b.balance ?? b.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}${value}`);
      }
      lines.push("", `Wallet: \`${result.address ?? "unknown"}\``);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "estimate_swap": {
      const parsed = SwapSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${String(parsed.error.issues[0].path[0])} ${parsed.error.issues[0].message}` }], isError: true };
      const { fromToken, toToken, amount } = parsed.data;
      const result = await callConvex("/mcp/defi/swap", "POST", { fromToken, toToken, amount }, "estimate_swap");
      if (!result.success) return { content: [{ type: "text", text: `Estimate failed: ${result.error}` }], isError: true };

      const q = result.quote;
      const buyHuman = formatTokenAmount(q.buyAmount, q.buyToken ?? toToken);
      const sellHuman = formatTokenAmount(q.sellAmount ?? "0", q.sellToken ?? fromToken);
      const priceImpact = q.estimatedPriceImpact != null ? `${Number(q.estimatedPriceImpact).toFixed(3)}%` : "< 0.01%";

      return {
        content: [{
          type: "text",
          text: [
            `**Swap Estimate** (not executed)`,
            ``,
            `You sell: **${sellHuman} ${(q.sellToken ?? fromToken).toUpperCase()}**`,
            `You get:  **~${buyHuman} ${(q.buyToken ?? toToken).toUpperCase()}**`,
            `Price impact: ${priceImpact}`,
            ``,
            `Run \`swap_tokens\` with the same params to execute.`,
          ].join("\n"),
        }],
      };
    }

    case "swap_tokens": {
      const parsed = SwapSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${String(parsed.error.issues[0].path[0])} ${parsed.error.issues[0].message}` }], isError: true };
      const { fromToken, toToken, amount } = parsed.data;
      const wallet = await getOrCreateWallet();
      const result = await callConvex("/mcp/defi/swap", "POST", { fromToken, toToken, amount }, "swap_tokens");
      if (!result.success) return { content: [{ type: "text", text: `Swap failed: ${result.error}` }], isError: true };
      const txHash = await signAndBroadcast(wallet, result.quote);
      const buyAmountHuman = formatTokenAmount(result.quote.buyAmount, result.quote.buyToken ?? toToken);
      return {
        content: [{
          type: "text",
          text: [`✅ Swap executed!`, `${amount} ${fromToken.toUpperCase()} → ${buyAmountHuman} ${result.quote.buyToken}`, `Tx Hash: \`${txHash}\``, `https://basescan.org/tx/${txHash}`].join("\n"),
        }],
      };
    }

    case "send_token": {
      const parsed = SendSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${String(parsed.error.issues[0].path[0])} ${parsed.error.issues[0].message}` }], isError: true };
      const { token, toAddress, amount } = parsed.data;
      const wallet = await getOrCreateWallet();
      const result = await callConvex("/mcp/defi/send", "POST", parsed.data, "send_token");
      if (!result.success) return { content: [{ type: "text", text: `Send failed: ${result.error}` }], isError: true };
      const txHash = await signAndBroadcast(wallet, result.txData);
      return {
        content: [{
          type: "text",
          text: [`✅ Sent!`, `${amount} ${token.toUpperCase()} → \`${toAddress}\``, `Tx Hash: \`${txHash}\``, `https://basescan.org/tx/${txHash}`].join("\n"),
        }],
      };
    }

    case "analyze_wallet": {
      const parsed = AnalyzeWalletSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { address, label } = parsed.data;

      const data = await callConvex("/wallet/analyze", "POST", { address, label }, "analyze_wallet") as {
        address?: string;
        label?: string;
        totalUsd?: number;
        holdings?: Array<{ token: string; balance: number; valueUsd: number | null; pct: number | null }>;
        profile?: string;
        analysis?: string | null;
        analysisError?: string;
        error?: string;
      };

      if (data.error) return { content: [{ type: "text", text: `Wallet analysis failed: ${data.error}` }], isError: true };

      const total = (data.totalUsd ?? 0).toFixed(2);
      const walletLabel = label ? ` — ${label}` : "";
      const topHoldings = (data.holdings ?? [])
        .slice(0, 8)
        .map(h => `• **${h.token}**: $${(h.valueUsd ?? 0).toFixed(2)}${h.pct != null ? ` (${h.pct}%)` : ""}`)
        .join("\n");

      const profileLine = data.profile ? `**Profile:** ${data.profile}\n` : "";

      const header = [
        `**Wallet Analysis**${walletLabel}`,
        `\`${address}\``,
        `**Portfolio value:** $${total}`,
        ``,
        profileLine,
        `**Holdings:**`,
        topHoldings || "No token holdings found.",
        ``,
      ].join("\n");

      const body = data.analysis ?? (data.analysisError ? `*AI analysis unavailable: ${data.analysisError}*` : "*AI analysis not available*");

      return { content: [{ type: "text", text: header + body }] };
    }

    case "get_defi_yields": {
      const parsed = DefiYieldsSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

      const { token, minApy = 1, limit = 20 } = parsed.data;

      let pools: any[];
      try {
        const res = await fetch("https://yields.llama.fi/pools", { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as any;
        pools = data.data ?? [];
      } catch (e: any) {
        return { content: [{ type: "text", text: `DeFiLlama fetch failed: ${e.message}` }], isError: true };
      }

      // Filter to Base chain
      let filtered = pools.filter((p: any) => p.chain === "Base");

      // Filter by token if specified
      if (token) {
        const upper = token.toUpperCase();
        filtered = filtered.filter((p: any) =>
          (p.symbol ?? "").toUpperCase().includes(upper) ||
          (p.underlyingTokens ?? []).some((t: string) => t.toUpperCase().includes(upper))
        );
      }

      // Filter by minimum APY and remove outliers (>10000% are usually broken)
      filtered = filtered
        .filter((p: any) => (p.apy ?? 0) >= minApy && (p.apy ?? 0) <= 10_000)
        .sort((a: any, b: any) => (b.apy ?? 0) - (a.apy ?? 0))
        .slice(0, limit);

      if (!filtered.length) {
        return {
          content: [{
            type: "text",
            text: [
              `## DeFi Yields on Base`,
              `No pools found${token ? ` for ${token.toUpperCase()}` : ""} with APY ≥ ${minApy}%.`,
              ``,
              `Try lowering \`minApy\` or removing the token filter.`,
            ].join("\n"),
          }],
        };
      }

      const fmt = (n: number) => n >= 1_000_000_000 ? `$${(n / 1_000_000_000).toFixed(1)}B`
        : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M`
        : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K`
        : `$${n.toFixed(0)}`;

      const lines = [
        `## DeFi Yields on Base${token ? ` — ${token.toUpperCase()}` : ""}`,
        `Top ${filtered.length} pools · APY ≥ ${minApy}% · Source: DeFiLlama`,
        ``,
        `| # | Pool | Protocol | APY | TVL |`,
        `|---|------|----------|-----|-----|`,
      ];

      filtered.forEach((p: any, i: number) => {
        const apy  = (p.apy ?? 0).toFixed(1);
        const tvl  = fmt(p.tvlUsd ?? 0);
        const name = (p.symbol ?? p.pool ?? "—").replace(/-/g, " ");
        const proj = p.project ?? "—";
        lines.push(`| ${i + 1} | ${name} | ${proj} | **${apy}%** | ${tvl} |`);
      });

      lines.push(``, `Use \`swap_tokens\` to position, then deposit via the protocol's UI. Always check smart contract risk before depositing.`);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    default:
      return null;
  }
}
