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
];

const SwapSchema = z.object({ fromToken: z.string().min(1), toToken: z.string().min(1), amount: z.string().min(1) });
const SendSchema = z.object({ token: z.string().min(1), toAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a valid 0x address"), amount: z.string().min(1) });

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
      if (result.feeTxData) {
        try { await signAndBroadcast(wallet, result.feeTxData); } catch { /* non-fatal */ }
      }
      return {
        content: [{
          type: "text",
          text: [`✅ Sent!`, `${amount} ${token.toUpperCase()} → \`${toAddress}\``, `Tx Hash: \`${txHash}\``, `https://basescan.org/tx/${txHash}`].join("\n"),
        }],
      };
    }

    default:
      return null;
  }
}
