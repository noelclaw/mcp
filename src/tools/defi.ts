import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { getOrCreateWallet, signAndBroadcast } from "../wallet.js";
import { ToolResult } from "../types.js";

export const DEFI_TOOLS: Tool[] = [
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

export async function handleDefiTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "swap_tokens": {
      const parsed = SwapSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${String(parsed.error.issues[0].path[0])} ${parsed.error.issues[0].message}` }], isError: true };
      const { fromToken, toToken, amount } = parsed.data;
      const wallet = await getOrCreateWallet();
      const result = await callConvex("/mcp/defi/swap", "POST", { fromToken, toToken, amount }, "swap_tokens");
      if (!result.success) return { content: [{ type: "text", text: `Swap failed: ${result.error}` }], isError: true };
      const txHash = await signAndBroadcast(wallet, result.quote);
      const buyAmountHuman = (parseInt(result.quote.buyAmount) / 1e6).toFixed(4);
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
