import { Tool } from "@modelcontextprotocol/sdk/types.js";
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
];

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
              `Private keys never leave your machine - all signing happens locally.`,
              ``,
              `Use this address to receive ETH, USDC, or any ERC-20 token on Base.`,
            ].join("\n"),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Failed to load wallet: ${err.message}` }], isError: true };
      }
    }

    default:
      return null;
  }
}
