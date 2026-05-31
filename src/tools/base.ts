import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";

const MORPHO_API  = "https://blue-api.morpho.org/graphql";
const MOONWELL_API = "https://api.moonwell.fi/v1/markets";

export const BASE_TOOLS: Tool[] = [
  {
    name: "base_query_vaults",
    description:
      "List Morpho yield vaults on Base sorted by APY. Shows vault name, asset, current APY, and total deposits. Use this to find the best yield opportunities on Base.",
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
    name: "base_list_markets",
    description:
      "List Moonwell lending/borrowing markets on Base. Shows supply APY, borrow APY, total liquidity, and utilization rate for each asset.",
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
    name: "base_prepare_deposit",
    description:
      "Get deposit instructions for a Morpho vault — shows the vault address, expected APY, and step-by-step instructions. Does NOT execute the transaction.",
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
    name: "base_chain_stats",
    description:
      "Get real-time Base chain stats: ETH price, gas price in gwei, and latest block info.",
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
      orderBy: "state_netApy"
      orderDirection: "desc"
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
  const data = await res.json();
  let vaults: any[] = data?.data?.vaults?.items ?? [];

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
  const data = await res.json();
  let markets: any[] = data?.data ?? data?.markets ?? [];

  if (asset) {
    markets = markets.filter((m: any) =>
      (m.underlyingSymbol ?? m.symbol ?? "").toLowerCase().includes(asset.toLowerCase())
    );
  }

  if (!markets.length) return "No markets found.";

  const lines = markets.slice(0, 15).map((m: any, i: number) => {
    const symbol     = m.underlyingSymbol ?? m.symbol ?? "?";
    const supplyApy  = pct((m.supplyApy ?? m.supplyRate ?? 0));
    const borrowApy  = pct((m.borrowApy ?? m.borrowRate ?? 0));
    const liquidity  = fmt(m.totalSupplyUsd ?? m.totalSupply ?? 0);
    const util       = m.utilization != null ? `${(m.utilization * 100).toFixed(1)}%` : "—";
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
    }).then(r => r.json()).catch(() => null),

    fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", {
      signal: AbortSignal.timeout(8000),
    }).then(r => r.json()).catch(() => null),

    fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_gasPrice", params: [] }),
      signal: AbortSignal.timeout(8000),
    }).then(r => r.json()).catch(() => null),
  ]);

  const block    = blockRes?.result ? parseInt(blockRes.result, 16) : "—";
  const ethPrice = priceRes?.ethereum?.usd ?? "—";
  const gasPriceGwei = gasRes?.result
    ? (parseInt(gasRes.result, 16) / 1e9).toFixed(4)
    : "—";

  return `Base Chain Stats:\n\n• ETH Price: $${ethPrice}\n• Gas Price: ${gasPriceGwei} gwei\n• Latest Block: ${block.toLocaleString()}\n• Network: Base Mainnet (Chain ID 8453)`;
}

// ── Prepare deposit info ───────────────────────────────────────────────────────

async function prepareDeposit(vaultName: string | undefined, asset: string, amount: string): Promise<string> {
  const gql = `{
    vaults(
      where: { chainId_in: [8453] }
      orderBy: "state_netApy"
      orderDirection: "desc"
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
  const data = await res.json();
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
    return `No Morpho vault found for ${asset} on Base. Try base_query_vaults to see available vaults.`;
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
    case "base_query_vaults": {
      const text = await fetchMorphoVaults(a.asset, a.limit ?? 10);
      return { content: [{ type: "text", text }] };
    }

    case "base_list_markets": {
      const text = await fetchMoonwellMarkets(a.asset);
      return { content: [{ type: "text", text }] };
    }

    case "base_prepare_deposit": {
      const text = await prepareDeposit(a.vaultName, a.asset, a.amount);
      return { content: [{ type: "text", text }] };
    }

    case "base_chain_stats": {
      const text = await fetchBaseStats();
      return { content: [{ type: "text", text }] };
    }

    default:
      return null;
  }
}
