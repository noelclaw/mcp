import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { getOrCreateWallet, signAndBroadcast } from "../wallet.js";
import { ToolResult } from "../types.js";

export const DEFI_TOOLS: Tool[] = [
  {
    name: "get_portfolio",
    description: "Get your Base wallet address and full token portfolio including all token balances with USD values. Auto-creates a secure encrypted wallet on first use.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "swap_tokens",
    description: "Swap tokens on Base mainnet via 0x Permit2. Supported: ETH, USDC, USDT, DAI, WETH. Amount is human-readable. Signed and broadcast locally from your wallet.",
    inputSchema: {
      type: "object",
      properties: {
        fromToken: { type: "string", description: "Token to sell: ETH, USDC, USDT, DAI, WETH" },
        toToken: { type: "string", description: "Token to buy: ETH, USDC, USDT, DAI, WETH" },
        amount: { type: "string", description: "Human-readable amount (e.g. '0.001')" },
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
    name: "deploy_token",
    description: "Launch a new memecoin on Base via Flaunch. Deploys with fair launch period, sets your revenue share (default 80% of swap fees), and returns a Memestream NFT that earns ETH from every swap forever. Image must be a publicly accessible URL.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Token name e.g. 'Pepe Noel'" },
        symbol: { type: "string", description: "Ticker 3-6 chars e.g. 'PNOEL'" },
        imageUrl: { type: "string", description: "Public image URL for the token" },
        description: { type: "string", description: "Token description (optional)" },
        initialMarketCapUSD: { type: "number", description: "Starting mcap in USD (default: 10000, min: 1000)" },
        creatorFeePercent: { type: "number", description: "Your % of swap fees (default: 80, max: 100)" },
        preminePercent: { type: "number", description: "% of supply to premine at launch (default: 0)" },
        fairLaunchDurationMinutes: { type: "number", description: "Fair launch window in minutes (default: 30)" },
      },
      required: ["name", "symbol", "imageUrl"],
    },
  },
  {
    name: "claim_fees",
    description: "Claim accumulated ETH from your Flaunch token swap fees. Calls claim() on the Flaunch PositionManager — pulls all pending ETH from your deployed tokens to your wallet.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mint_nft",
    description: "Auto-mint any NFT on Base. Pass the mint page URL or contract address. " +
      "Noel detects the contract, checks your eligibility and balance, " +
      "then mints directly from your wallet. Works with OpenSea, Zora, Highlight, and most Base NFT projects.",
    inputSchema: {
      type: "object",
      properties: {
        mintUrl: {
          type: "string",
          description: "NFT mint URL (OpenSea, Zora, Highlight) or raw contract address (0x...)",
        },
        quantity: {
          type: "number",
          description: "How many to mint (default: 1)",
        },
      },
      required: ["mintUrl"],
    },
  },
];

const SwapSchema = z.object({ fromToken: z.string().min(1), toToken: z.string().min(1), amount: z.string().min(1) });
const SendSchema = z.object({ token: z.string().min(1), toAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a valid 0x address"), amount: z.string().min(1) });
const MintNftSchema = z.object({
  mintUrl: z.string().min(1),
  quantity: z.number().min(1).max(100).optional(),
});
const DeployTokenSchema = z.object({
  name: z.string().min(1),
  symbol: z.string().min(3).max(6),
  imageUrl: z.string().url(),
  description: z.string().optional(),
  initialMarketCapUSD: z.number().min(1000).optional(),
  creatorFeePercent: z.number().min(0).max(100).optional(),
  preminePercent: z.number().min(0).max(50).optional(),
  fairLaunchDurationMinutes: z.number().min(1).optional(),
});

export async function handleDefiTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "get_portfolio": {
      const data = await callConvex("/mcp/defi/portfolio", "GET", undefined, "get_portfolio");
      if (data.error) return { content: [{ type: "text", text: `Portfolio error: ${data.error}` }], isError: true };
      const lines = [
        `**Portfolio — Base Mainnet**`, `Address: \`${data.address}\``, ``, `**Balances**`,
      ];
      for (const b of (data.balances ?? [])) {
        lines.push(`• ${b.token}: ${b.balance}${b.valueUsd ? ` (~$${Number(b.valueUsd).toFixed(2)})` : ""}`);
      }
      lines.push(``, `**Total Value:** ~$${Number(data.totalValueUsd ?? 0).toFixed(2)}`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "swap_tokens": {
      const parsed = SwapSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${String(parsed.error.issues[0].path[0])} ${parsed.error.issues[0].message}` }], isError: true };
      const { fromToken, toToken, amount } = parsed.data;
      const wallet = await getOrCreateWallet();
      const result = await callConvex("/mcp/defi/swap", "POST", parsed.data, "swap_tokens");
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
      return {
        content: [{
          type: "text",
          text: [`✅ Sent!`, `${amount} ${token.toUpperCase()} → \`${toAddress}\``, `Tx Hash: \`${txHash}\``, `https://basescan.org/tx/${txHash}`].join("\n"),
        }],
      };
    }

    case "mint_nft": {
      const parsed = MintNftSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { mintUrl, quantity } = parsed.data;
      const wallet = await getOrCreateWallet();
      const result = await callConvex("/mcp/nft/mint", "POST", { mintUrl, quantity: quantity ?? 1 }, "mint_nft");
      if (result.error) return { content: [{ type: "text", text: `Mint failed: ${result.error}` }], isError: true };
      if (result.action !== "sign_and_broadcast") return { content: [{ type: "text", text: "Unexpected response from server" }], isError: true };
      const txHash = await signAndBroadcast(wallet, result);
      const meta = result.metadata ?? {};
      return {
        content: [{
          type: "text",
          text: [
            `✅ Minted successfully!`,
            `Contract: ${meta.contractAddress ?? result.to}`,
            `Quantity: ${meta.quantity ?? quantity ?? 1}`,
            `Cost: ${meta.totalCost ?? "0"} ETH`,
            `Tx: \`${txHash}\``,
            `https://basescan.org/tx/${txHash}`,
          ].join("\n"),
        }],
      };
    }

    case "deploy_token": {
      const parsed = DeployTokenSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const wallet = await getOrCreateWallet();
      const result = await callConvex("/mcp/token/deploy", "POST", parsed.data, "deploy_token");
      if (result.error) return { content: [{ type: "text", text: `Deploy failed: ${result.error}` }], isError: true };
      const txHash = await signAndBroadcast(wallet, result);
      return {
        content: [{
          type: "text",
          text: [
            `✅ Token deployed!`,
            `Name: ${parsed.data.name} ($${parsed.data.symbol})`,
            `Tx Hash: \`${txHash}\``,
            `https://basescan.org/tx/${txHash}`,
            ``,
            `Your Memestream NFT earns ETH from every swap.`,
          ].join("\n"),
        }],
      };
    }

    case "claim_fees": {
      const wallet = await getOrCreateWallet();
      const result = await callConvex("/mcp/token/claim", "POST", {}, "claim_fees");
      if (result.error) return { content: [{ type: "text", text: `Claim failed: ${result.error}` }], isError: true };
      const txHash = await signAndBroadcast(wallet, result);
      return {
        content: [{
          type: "text",
          text: [`✅ ETH claimed successfully!`, `Tx Hash: \`${txHash}\``, `https://basescan.org/tx/${txHash}`].join("\n"),
        }],
      };
    }

    default:
      return null;
  }
}
