import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { getOrCreateWallet } from "../wallet.js";
import { ToolResult } from "../types.js";

export const WALLET_TOOLS: Tool[] = [
  {
    name: "get_wallet_address",
    description:
      "Get your Noelclaw wallet address. This is the local MCP wallet used to sign " +
      "requests and receive on-chain assets. Keys never leave your machine.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "set_telegram",
    description:
      "Connect your Telegram account for push notifications — trading signals, " +
      "whale alerts, and daily recaps sent directly to your Telegram.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: {
          type: "string",
          description:
            "Your Telegram chat ID. Get it by messaging @userinfobot on Telegram.",
        },
        bot_token: {
          type: "string",
          description: "Optional: your own Telegram bot token. Leave empty to use the Noelclaw bot.",
        },
      },
      required: ["chat_id"],
    },
  },
];

const SetTelegramSchema = z.object({
  chat_id: z.string().min(1),
  bot_token: z.string().optional(),
});

export async function handleWalletTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "get_wallet_address": {
      try {
        const wallet = await getOrCreateWallet();
        return {
          content: [{
            type: "text",
            text: [
              `**Your Noelclaw Wallet**`,
              ``,
              `Address: \`${wallet.address}\``,
              `Network: Base mainnet (chainId 8453)`,
              ``,
              `This wallet is stored locally at \`~/.noelclaw/wallet.json\`.`,
              `Private keys never leave your machine — all signing happens locally.`,
              ``,
              `Use this address to receive ETH, USDC, or any ERC-20 token on Base.`,
            ].join("\n"),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Failed to load wallet: ${err.message}` }], isError: true };
      }
    }

    case "set_telegram": {
      const parsed = SetTelegramSchema.safeParse(args);
      if (!parsed.success) {
        return { content: [{ type: "text", text: `Invalid input: chat_id ${parsed.error.issues[0].message}` }], isError: true };
      }
      const { chat_id, bot_token } = parsed.data;
      const result = await callConvex("/telegram/connect", "POST", {
        chatId: chat_id,
        botToken: bot_token,
      }, "set_telegram");

      if (result.error) {
        return { content: [{ type: "text", text: `Failed: ${result.error}` }], isError: true };
      }

      return {
        content: [{
          type: "text",
          text: [
            `✅ **Telegram connected**`,
            ``,
            `Chat ID: \`${chat_id}\``,
            `You'll now receive:`,
            `• Trading signals (BTC/ETH, 08:00 UTC daily)`,
            `• Whale alerts (every 6 hours)`,
            `• Daily recap`,
            `• Research reports`,
            ``,
            `To stop: message the bot or use \`set_telegram\` with an empty chat_id.`,
          ].join("\n"),
        }],
      };
    }

    default:
      return null;
  }
}
