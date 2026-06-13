// Base MCP integration — exposes Base wallet + DeFi capabilities under the
// `base_mcp_*` namespace, mirroring the surface of Base's official MCP server
// at https://mcp.base.org but routed through noelclaw's existing infrastructure
// so users don't need a separate OAuth flow.
//
// Each tool below is a thin wrapper around an existing noelclaw tool — the
// value here is the namespacing + Base-specific defaults + basename resolution.
// Users can call these without knowing about the underlying `get_portfolio`,
// `send_token`, etc.

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";
import { handleDefiTool } from "./defi.js";
import { handleBaseTool } from "./base.js";
import { handleWalletTool } from "./wallet.js";

// ── Tool definitions ─────────────────────────────────────────────────────────

export const BASE_MCP_TOOLS: Tool[] = [
  {
    name: "base_mcp_status",
    description:
      "Base MCP — get live status of your Base wallet: address, chain info, current ETH price, gas. " +
      "Use at the start of any Base session to confirm everything is connected.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "base_mcp_balance",
    description:
      "Base MCP — get your current token balances on Base mainnet (ETH, USDC, USDT, DAI, WETH). " +
      "Mirrors `get_portfolio` from Base's official MCP server.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "base_mcp_send",
    description:
      "Base MCP — send ETH or ERC-20 tokens to any address (or basename like `jesse.base.eth`) on Base mainnet. " +
      "Signed and broadcast locally from your wallet. Resolves basenames automatically.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Token symbol: ETH, USDC, USDT, DAI, WETH" },
        to: { type: "string", description: "Destination — 0x address or Base basename (e.g. jesse.base.eth)" },
        amount: { type: "string", description: "Human-readable amount, e.g. '0.01' or '50'" },
      },
      required: ["token", "to", "amount"],
    },
  },
  {
    name: "base_mcp_swap",
    description:
      "Base MCP — swap tokens on Base via 0x Permit2. Supported: ETH, USDC, USDT, DAI, WETH. " +
      "Use base_mcp_estimate first to preview the rate.",
    inputSchema: {
      type: "object",
      properties: {
        fromToken: { type: "string", description: "Token to sell: ETH, USDC, USDT, DAI, WETH" },
        toToken: { type: "string", description: "Token to buy: ETH, USDC, USDT, DAI, WETH" },
        amount: { type: "string", description: "Amount or percentage (e.g. '0.001', '50%')" },
      },
      required: ["fromToken", "toToken", "amount"],
    },
  },
  {
    name: "base_mcp_estimate",
    description:
      "Base MCP — preview a swap's expected output and price impact without executing. " +
      "Always call before base_mcp_swap to confirm the rate.",
    inputSchema: {
      type: "object",
      properties: {
        fromToken: { type: "string", description: "Token to sell" },
        toToken: { type: "string", description: "Token to buy" },
        amount: { type: "string", description: "Amount to swap" },
      },
      required: ["fromToken", "toToken", "amount"],
    },
  },
  {
    name: "base_mcp_lend",
    description:
      "Base MCP — find the best lending opportunity for a token on Base (Morpho vaults + Moonwell markets) " +
      "and prepare a deposit transaction. Returns top yield options ranked by APY × TVL safety score.",
    inputSchema: {
      type: "object",
      properties: {
        asset: { type: "string", description: "Asset symbol: USDC, ETH, WETH, etc." },
        amount: { type: "string", description: "Optional — amount to deposit. If provided, returns a ready-to-sign deposit tx." },
        venue: { type: "string", description: "Optional — 'morpho' or 'moonwell'. Default: best across both." },
      },
      required: ["asset"],
    },
  },
  {
    name: "base_mcp_resolve",
    description:
      "Base MCP — resolve a Base basename (like `jesse.base.eth`) to its 0x address. " +
      "Uses Coinbase's basename resolver. Reverse-resolves addresses to names too.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Basename like `jesse.base.eth`, OR a 0x address for reverse lookup" },
      },
      required: ["name"],
    },
  },
  {
    name: "base_mcp_analyze",
    description:
      "Base MCP — analyze any wallet's Base activity: holdings, top tokens, recent activity, behavioral profile. " +
      "Works on any public 0x address. Useful before copying trades or auditing protocols.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Address (0x...) or basename to analyze" },
        label: { type: "string", description: "Optional label for context" },
      },
      required: ["address"],
    },
  },
];

// ── Direct Base RPC balance fetch ──────────────────────────────────────────
// Bypasses backend `/mcp/defi/portfolio` (currently throws RPC errors for
// empty wallets) — talks straight to Coinbase's public Base RPC.

const BASE_RPC = "https://mainnet.base.org";

const TOKENS: Array<{ symbol: string; address: string; decimals: number }> = [
  { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  { symbol: "USDT", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
  { symbol: "DAI",  address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
  { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  { symbol: "cbBTC",address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
];

// Minimal ABI-encoded balanceOf(address) selector + padded address.
function encodeBalanceOf(addr: string): string {
  const padded = addr.toLowerCase().replace("0x", "").padStart(64, "0");
  return "0x70a08231" + padded;
}

async function rpcCall(method: string, params: any[]): Promise<any> {
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const data = (await res.json()) as any;
  if (data.error) throw new Error(`RPC: ${data.error?.message ?? "unknown"}`);
  return data.result;
}

async function fetchBaseBalances(address: string): Promise<string> {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return "Invalid address.";
  }

  // ETH balance
  let ethStr = "?";
  try {
    const ethHex = await rpcCall("eth_getBalance", [address, "latest"]);
    const eth = Number(BigInt(ethHex)) / 1e18;
    ethStr = eth.toFixed(6);
  } catch (e: any) {
    ethStr = `error: ${e?.message ?? "rpc fail"}`;
  }

  // ERC-20 balances
  const erc20Results: Array<{ symbol: string; balance: string }> = [];
  for (const t of TOKENS) {
    try {
      const data = encodeBalanceOf(address);
      const hex = await rpcCall("eth_call", [{ to: t.address, data }, "latest"]);
      if (hex && hex !== "0x" && hex !== "0x0") {
        const bal = Number(BigInt(hex)) / 10 ** t.decimals;
        if (bal > 0) erc20Results.push({ symbol: t.symbol, balance: bal.toFixed(t.decimals > 6 ? 6 : 4) });
      }
    } catch { /* skip on RPC fail */ }
  }

  const lines: string[] = [`**Wallet**: \`${address}\``, ``, `**Balances on Base mainnet:**`];
  lines.push(`- ETH: ${ethStr}`);
  if (erc20Results.length === 0) {
    lines.push(`- (no ERC-20 token balances)`);
  } else {
    for (const r of erc20Results) lines.push(`- ${r.symbol}: ${r.balance}`);
  }
  lines.push(``, `_Source: Base RPC (mainnet.base.org) · queried directly._`);
  return lines.join("\n");
}

// ── Basename resolution (Web3.bio — supports basenames + ENS) ────────────────

async function resolveBasename(input: string): Promise<{ address?: string; name?: string; error?: string }> {
  const trimmed = input.trim();
  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(trimmed);

  // Forward lookup (basename → address) — Web3.bio basenames namespace
  if (!isAddress) {
    const looksLikeName = trimmed.endsWith(".base.eth") || trimmed.endsWith(".base");
    if (!looksLikeName) {
      return { error: "Input is not a valid 0x address or .base.eth basename" };
    }
    try {
      const res = await fetch(
        `https://api.web3.bio/ns/basenames/${encodeURIComponent(trimmed.toLowerCase())}`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (res.ok) {
        const data = (await res.json()) as any;
        const addr = data?.address ?? null;
        if (addr) return { address: addr, name: trimmed };
        return { error: `Basename ${trimmed} has no address registered` };
      }
      if (res.status === 404) return { error: `Basename ${trimmed} not found` };
      return { error: `Resolver returned ${res.status}` };
    } catch (e: any) {
      return { error: `Resolver error: ${e?.message ?? "fetch failed"}` };
    }
  }

  // Reverse lookup (address → basename) — Web3.bio supports multi-namespace
  try {
    const res = await fetch(
      `https://api.web3.bio/profile/basenames/${trimmed.toLowerCase()}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (res.ok) {
      const data = (await res.json()) as any;
      const name = data?.identity ?? data?.displayName ?? null;
      if (name && name.endsWith(".base.eth")) return { address: trimmed, name };
    }
    // No basename — that's fine, return address with no name
    return { address: trimmed };
  } catch {
    return { address: trimmed };
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handleBaseMcpTool(name: string, args: unknown): Promise<ToolResult | null> {
  const a = (args ?? {}) as any;

  switch (name) {
    case "base_mcp_status": {
      // Combine chain stats + wallet address into one status snapshot
      const [chainRes, walletRes] = await Promise.all([
        handleBaseTool("base_chain_stats", {}),
        handleWalletTool("get_wallet_address", {}).catch(() => null),
      ]);
      const chainText = chainRes?.content?.[0]?.text ?? "Chain stats unavailable";
      const walletText = walletRes?.content?.[0]?.text ?? "(not connected)";
      return {
        content: [{
          type: "text",
          text: [
            "## 🔵 Base MCP — Status",
            "",
            "**Wallet**:",
            walletText,
            "",
            "**Chain**:",
            chainText,
          ].join("\n"),
        }],
      };
    }

    case "base_mcp_balance": {
      // Resolve wallet address from existing wallet config / file, then query
      // Base RPC directly. Bypasses the backend portfolio endpoint which
      // currently throws RPC errors for empty wallets.
      const walletRes = await handleWalletTool("get_wallet_address", {}).catch(() => null);
      const text = walletRes?.content?.[0]?.text ?? "";
      const addrMatch = text.match(/0x[a-fA-F0-9]{40}/);
      if (!addrMatch) {
        return { content: [{ type: "text", text: "Wallet not configured. Run noelclaw login first." }], isError: true };
      }
      const body = await fetchBaseBalances(addrMatch[0]);
      return { content: [{ type: "text", text: `## 🔵 Base MCP — Balance\n\n${body}` }] };
    }

    case "base_mcp_send": {
      if (!a.token || !a.to || !a.amount) {
        return { content: [{ type: "text", text: "Required: token, to, amount" }], isError: true };
      }
      // Resolve basename if needed
      let toAddress = a.to;
      if (typeof a.to === "string" && !/^0x[a-fA-F0-9]{40}$/.test(a.to)) {
        const resolved = await resolveBasename(a.to);
        if (resolved.error || !resolved.address) {
          return {
            content: [{ type: "text", text: `Could not resolve "${a.to}": ${resolved.error ?? "unknown"}` }],
            isError: true,
          };
        }
        toAddress = resolved.address;
      }
      return handleDefiTool("send_token", { token: a.token, toAddress, amount: a.amount });
    }

    case "base_mcp_swap": {
      return handleDefiTool("swap_tokens", { fromToken: a.fromToken, toToken: a.toToken, amount: a.amount });
    }

    case "base_mcp_estimate": {
      return handleDefiTool("estimate_swap", { fromToken: a.fromToken, toToken: a.toToken, amount: a.amount });
    }

    case "base_mcp_lend": {
      const asset = (a.asset ?? "").toString().toUpperCase();
      if (!asset) {
        return { content: [{ type: "text", text: "Required: asset (USDC, ETH, etc.)" }], isError: true };
      }
      const venue = (a.venue ?? "").toString().toLowerCase();

      // Two parallel lookups — Morpho vaults + Moonwell markets — unless venue specified
      const promises: Array<Promise<ToolResult | null>> = [];
      if (venue !== "moonwell") promises.push(handleBaseTool("base_query_vaults", { asset }));
      if (venue !== "morpho") promises.push(handleBaseTool("base_list_markets", { asset }));

      const results = await Promise.all(promises);
      const blocks = results
        .filter((r): r is ToolResult => !!r && Array.isArray(r.content))
        .map((r) => r.content?.[0]?.text ?? "")
        .filter(Boolean);

      const lines = [
        `## 🔵 Base MCP — Lend ${asset}`,
        "",
        ...blocks,
      ];

      if (a.amount) {
        // If amount provided, also prepare a deposit tx for the top option
        const prep = await handleBaseTool("base_prepare_deposit", { asset, amount: a.amount });
        if (prep?.content?.[0]?.text) {
          lines.push("", "### 📝 Prepared deposit", prep.content[0].text);
        }
      } else {
        lines.push("", "_Add `amount` to prepare a ready-to-sign deposit transaction._");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "base_mcp_resolve": {
      if (!a.name) {
        return { content: [{ type: "text", text: "Required: name (basename or 0x address)" }], isError: true };
      }
      const result = await resolveBasename(a.name);
      if (result.error) {
        return { content: [{ type: "text", text: `❌ ${result.error}` }], isError: true };
      }
      const lines = ["## 🔵 Base MCP — Resolve", ""];
      if (result.name) lines.push(`**Basename**: \`${result.name}\``);
      if (result.address) lines.push(`**Address**: \`${result.address}\``);
      if (!result.name && result.address) lines.push(`_No reverse basename registered for this address._`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "base_mcp_analyze": {
      // Resolve basename if input is a name
      let address = a.address;
      if (typeof a.address === "string" && !/^0x[a-fA-F0-9]{40}$/.test(a.address)) {
        const resolved = await resolveBasename(a.address);
        if (resolved.error || !resolved.address) {
          return { content: [{ type: "text", text: `Could not resolve "${a.address}": ${resolved.error ?? "unknown"}` }], isError: true };
        }
        address = resolved.address;
      }
      return handleDefiTool("analyze_wallet", { address, label: a.label });
    }

    default:
      return null;
  }
}
