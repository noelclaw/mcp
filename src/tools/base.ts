import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";

const MORPHO_API  = "https://blue-api.morpho.org/graphql";
const MOONWELL_API = "https://api.moonwell.fi/v1/markets";

export const BASE_TOOLS: Tool[] = [
  {
    name: "base_mcp_yield_vaults",
    description:
      "Find the best yield/earning opportunities on Base chain using Morpho vaults. Returns all vaults ranked by APY — use this when the user asks about yield farming, APY, best rates to earn, where to put USDC, or passive income on Base. For yield on a specific token, also see base_mcp_lend.",
    inputSchema: {
      type: "object",
      properties: {
        asset: {
          type: "string",
          description: "Filter by asset symbol (e.g. USDC, WETH, cbBTC). Leave empty for all.",
        },
        limit: {
          type: "number",
          description: "Max vaults to return (default 10)",
        },
      },
      required: [],
    },
  },
  {
    name: "base_mcp_lending_rates",
    description:
      "Get lending and borrowing rates across all Moonwell markets on Base. Returns supply APY, borrow APY, liquidity, and utilization per asset. Use when the user asks about borrow rates, lending rates, interest rates, or supply APY on Base.",
    inputSchema: {
      type: "object",
      properties: {
        asset: {
          type: "string",
          description: "Filter by asset symbol (e.g. USDC, ETH, cbBTC). Leave empty for all.",
        },
      },
      required: [],
    },
  },
  {
    name: "base_mcp_deposit_guide",
    description:
      "Get step-by-step deposit instructions for a Morpho vault — shows the vault address, expected APY, and manual deposit steps. Does NOT execute the transaction. Call base_mcp_yield_vaults first to find the vault, then call this to get instructions.",
    inputSchema: {
      type: "object",
      properties: {
        vaultName: {
          type: "string",
          description: "Name or partial name of the vault (e.g. 'Gauntlet USDC', 'steakUSDC')",
        },
        amount: {
          type: "string",
          description: "Amount to deposit (e.g. '100', '1000')",
        },
        asset: {
          type: "string",
          description: "Asset to deposit (e.g. USDC, WETH)",
        },
      },
      required: ["asset", "amount"],
    },
  },
  {
    name: "base_mcp_network",
    description:
      "Get real-time Base network stats: ETH price in USD, gas price in gwei, and latest block number. Use when the user asks about gas fees, ETH price, Base network status, or current block. Does not require wallet auth.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(decimals)}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

// ── Morpho vaults ─────────────────────────────────────────────────────────────

async function fetchMorphoVaults(asset?: string, limit = 10): Promise<string> {
  const gql = `{
    vaults(
      where: { chainId_in: [8453] }
      orderBy: NetApy
      orderDirection: Desc
      first: 50
    ) {
      items {
        name
        address
        asset { symbol name }
        state { apy netApy totalAssetsUsd }
      }
    }
  }`;

  const res = await fetch(MORPHO_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: gql }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Morpho API error: ${res.status}`);
  const data = await res.json() as any;
  let vaults: any[] = data?.data?.vaults?.items ?? [];

  // Filter out test/spam vaults: min $10k TVL, max 500% APY
  vaults = vaults.filter((v: any) => {
    const tvl = v.state?.totalAssetsUsd ?? 0;
    const apy = v.state?.netApy ?? v.state?.apy ?? 0;
    return tvl >= 10_000 && apy <= 5;
  });

  if (asset) {
    vaults = vaults.filter((v: any) =>
      v.asset?.symbol?.toLowerCase().includes(asset.toLowerCase())
    );
  }

  vaults = vaults.slice(0, limit);
  if (!vaults.length) return "No vaults found for that asset.";

  const lines = vaults.map((v: any, i: number) => {
    const apy    = pct(v.state?.netApy ?? v.state?.apy ?? 0);
    const tvl    = fmt(v.state?.totalAssetsUsd ?? 0);
    const addr   = `${v.address?.slice(0, 6)}...${v.address?.slice(-4)}`;
    return `${i + 1}. ${v.name}\n   Asset: ${v.asset?.symbol}  APY: ${apy}  TVL: ${tvl}\n   Address: ${addr}`;
  });

  return `Morpho Vaults on Base (sorted by APY):\n\n${lines.join("\n\n")}`;
}

// ── Moonwell markets ───────────────────────────────────────────────────────────

async function fetchMoonwellMarkets(asset?: string): Promise<string> {
  const res = await fetch(`${MOONWELL_API}?network=base`, {
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Moonwell API error: ${res.status}`);
  const data = await res.json() as any;
  let markets: any[] = Array.isArray(data) ? data : (data?.data ?? data?.markets ?? []);

  // Filter deprecated markets
  markets = markets.filter((m: any) => !m.deprecated);

  if (asset) {
    markets = markets.filter((m: any) =>
      (m.asset ?? m.underlyingSymbol ?? m.symbol ?? "").toLowerCase().includes(asset.toLowerCase())
    );
  }

  if (!markets.length) return "No markets found.";

  const lines = markets.slice(0, 15).map((m: any, i: number) => {
    const symbol    = m.asset ?? m.underlyingSymbol ?? m.symbol ?? "?";
    const supplyApy = pct((m.baseSupplyApy ?? m.supplyApy ?? m.supplyRate ?? 0) / 100);
    const borrowApy = pct((m.baseBorrowApy ?? m.borrowApy ?? m.borrowRate ?? 0) / 100);
    const liquidity = fmt(m.totalSupplyUsd ?? m.liquidityUsd ?? m.totalSupply ?? 0);
    const util      = m.utilization != null ? `${(m.utilization * 100).toFixed(1)}%` : "-";
    return `${i + 1}. ${symbol}\n   Supply APY: ${supplyApy}  Borrow APY: ${borrowApy}  Liquidity: ${liquidity}  Util: ${util}`;
  });

  return `Moonwell Markets on Base:\n\n${lines.join("\n\n")}`;
}

// ── Base chain stats ───────────────────────────────────────────────────────────

async function fetchBaseStats(): Promise<string> {
  const rpc = "https://mainnet.base.org";

  const [blockRes, priceRes, gasRes] = await Promise.all([
    fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: AbortSignal.timeout(8000),
    }).then(r => r.json() as Promise<any>).catch(() => null),

    fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", {
      signal: AbortSignal.timeout(8000),
    }).then(r => r.json() as Promise<any>).catch(() => null),

    fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_gasPrice", params: [] }),
      signal: AbortSignal.timeout(8000),
    }).then(r => r.json() as Promise<any>).catch(() => null),
  ]);

  const block    = blockRes?.result ? parseInt(blockRes.result, 16) : "-";
  const ethPrice = priceRes?.ethereum?.usd ?? "-";
  const gasPriceGwei = gasRes?.result
    ? (parseInt(gasRes.result, 16) / 1e9).toFixed(4)
    : "-";

  return `Base Chain Stats:\n\n• ETH Price: $${ethPrice}\n• Gas Price: ${gasPriceGwei} gwei\n• Latest Block: ${block.toLocaleString()}\n• Network: Base Mainnet (Chain ID 8453)`;
}

// ── Prepare deposit info ───────────────────────────────────────────────────────

async function prepareDeposit(vaultName: string | undefined, asset: string, amount: string): Promise<string> {
  const gql = `{
    vaults(
      where: { chainId_in: [8453] }
      orderBy: NetApy
      orderDirection: Desc
      first: 100
    ) {
      items {
        name
        address
        asset { symbol name }
        state { netApy apy totalAssetsUsd }
      }
    }
  }`;

  const res = await fetch(MORPHO_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: gql }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Morpho API error: ${res.status}`);
  const data = await res.json() as any;
  let vaults: any[] = data?.data?.vaults?.items ?? [];

  // Filter by asset first
  vaults = vaults.filter((v: any) =>
    v.asset?.symbol?.toLowerCase() === asset.toLowerCase()
  );

  // Filter by vault name if provided
  if (vaultName) {
    const match = vaults.find((v: any) =>
      v.name?.toLowerCase().includes(vaultName.toLowerCase())
    );
    if (match) vaults = [match];
  }

  // Take best APY vault
  const vault = vaults[0];
  if (!vault) {
    return `No Morpho vault found for ${asset} on Base. Try base_mcp_yield_vaults to see available vaults.`;
  }

  const apy = pct(vault.state?.netApy ?? vault.state?.apy ?? 0);
  const tvl = fmt(vault.state?.totalAssetsUsd ?? 0);

  return [
    `Morpho Vault Deposit Instructions`,
    ``,
    `Vault: ${vault.name}`,
    `Asset: ${vault.asset?.symbol}`,
    `APY: ${apy}  |  TVL: ${tvl}`,
    `Contract: ${vault.address}`,
    ``,
    `Steps to deposit ${amount} ${asset}:`,
    `1. Go to app.morpho.org or use the vault address above`,
    `2. Connect your wallet (ensure you have ${amount} ${asset})`,
    `3. Approve the vault contract to spend your ${asset}`,
    `4. Call deposit(${amount}, yourAddress) on the vault contract`,
    `5. You'll receive vault shares representing your deposit`,
    ``,
    `Expected yield: ~${apy} on ${amount} ${asset}`,
    `Note: APY is variable and changes based on market conditions.`,
  ].join("\n");
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function handleBaseTool(name: string, args: unknown): Promise<ToolResult | null> {
  const a = (args ?? {}) as Record<string, any>;

  switch (name) {
    case "base_mcp_yield_vaults": {
      const text = await fetchMorphoVaults(a.asset, a.limit ?? 10);
      return { content: [{ type: "text", text }] };
    }

    case "base_mcp_lending_rates": {
      const text = await fetchMoonwellMarkets(a.asset);
      return { content: [{ type: "text", text }] };
    }

    case "base_mcp_deposit_guide": {
      const text = await prepareDeposit(a.vaultName, a.asset, a.amount);
      return { content: [{ type: "text", text }] };
    }

    case "base_mcp_network": {
      const text = await fetchBaseStats();
      return { content: [{ type: "text", text }] };
    }

    default:
      return null;
  }
}
