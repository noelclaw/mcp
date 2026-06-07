import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";

// ── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_MIN_LIQ   = 50_000;
const DEFAULT_MIN_SCORE = 50;

// ── Types ─────────────────────────────────────────────────────────────────────
interface Candidate {
  mint:           string;
  symbol:         string;
  priceUsd:       number;
  priceChange5m:  number;
  priceChange1h:  number;
  priceChange6h:  number;
  priceChange24h: number;
  volume1h:       number;
  liquidity:      number;
  buys5m:         number;
  sells5m:        number;
  buys1h:         number;
  sells1h:        number;
}

interface ScoreResult {
  score:         number;
  passed:        boolean;
  pattern:       string | null;
  breakdown:     Record<string, { value?: number; points: number; vol1h?: number; txns1h?: number; pc6h?: number; pc24h?: number }>;
  gateFailures:  string[];
  buyPressure5m: number;
}

// ── Dip-reversal scorer ───────────────────────────────────────────────────────
// Ported 1:1 from circuit-agent/lib/scoring.js (battle-tested, pure math).
function scoreDipReversal(c: Candidate, minLiquidity = DEFAULT_MIN_LIQ): ScoreResult {
  const pc5m  = c.priceChange5m;
  const pc1h  = c.priceChange1h;
  const pc6h  = c.priceChange6h;
  const pc24h = c.priceChange24h;
  const liq   = c.liquidity;
  const vol1h = c.volume1h;

  const totalTxns5m = c.buys5m + c.sells5m;
  const buyRatio5m  = totalTxns5m > 0 ? c.buys5m / totalTxns5m : 0;
  const totalTxns1h = c.buys1h + c.sells1h;
  const buyRatio1h  = totalTxns1h > 0 ? c.buys1h / totalTxns1h : 0;

  // ── Hard gates — all must pass ────────────────────────────────────────────
  const gateFailures: string[] = [];
  if (pc1h >= 0)                              gateFailures.push(`1h not negative (${pc1h.toFixed(1)}%)`);
  if (pc5m < 0.5)                             gateFailures.push(`5m bounce weak (${pc5m.toFixed(1)}% < 0.5%)`);
  if (totalTxns5m > 5 && buyRatio5m <= 0.50) gateFailures.push(`buy ratio low (${(buyRatio5m * 100).toFixed(0)}%)`);
  if (liq < minLiquidity)                     gateFailures.push(`liquidity $${(liq / 1000).toFixed(0)}k < $${(minLiquidity / 1000).toFixed(0)}k min`);
  if (pc6h <= -20 && pc24h <= -20)            gateFailures.push(`dead cat (6h ${pc6h.toFixed(0)}% / 24h ${pc24h.toFixed(0)}%)`);

  if (gateFailures.length > 0) {
    return { score: 0, passed: false, pattern: null, breakdown: {}, gateFailures, buyPressure5m: buyRatio5m * 100 };
  }

  // ── 1. Drop depth (0–25 pts) — deeper dip = more bounce room ─────────────
  const dropPts = pc1h <= -10 ? 25 : pc1h <= -5 ? 20 : pc1h <= -3 ? 15 : 5;

  // ── 2. Bounce confirmation (0–20 pts) ─────────────────────────────────────
  const bouncePts = pc5m >= 5 ? 20 : pc5m >= 3 ? 17 : pc5m >= 2 ? 14 : pc5m >= 1 ? 10 : 5;

  // ── 3. Sentiment shift (0–15 pts) — buyers returning after selloff ────────
  const sentimentShift = buyRatio5m - buyRatio1h;
  const sentPts = sentimentShift >= 0.10 ? 15
    : sentimentShift >= 0.05 ? 10
    : sentimentShift >= 0.02 ? 7
    : sentimentShift > 0     ? 3 : 0;

  // ── 4. Buy pressure (0–10 pts) ────────────────────────────────────────────
  const bp    = buyRatio5m * 100;
  const bpPts = bp >= 65 ? 10 : bp >= 58 ? 8 : bp >= 53 ? 5 : 2;

  // ── 5. Volume & activity (0–15 pts) — validates bounce is real ───────────
  const actPts = vol1h >= 100_000 && totalTxns1h >= 200 ? 15
    : vol1h >= 50_000 && totalTxns1h >= 100 ? 12
    : vol1h >= 20_000 && totalTxns1h >= 40  ? 8
    : vol1h >= 5_000  && totalTxns1h >= 10  ? 4 : 1;

  // ── 6. Trend alignment (−10 to +15 pts) — dip in uptrend vs dead cat ─────
  let trendPts: number;
  if (pc6h > 0 && pc24h > 0)  trendPts = 15;
  else if (pc24h > 0)          trendPts = 10;
  else if (pc6h > 0)           trendPts = 5;
  else {
    const avg = (pc6h + pc24h) / 2;
    trendPts = avg <= -15 ? -10 : avg <= -8 ? -7 : avg <= -4 ? -5 : -2;
  }

  const score = Math.max(0, Math.min(100,
    dropPts + bouncePts + sentPts + bpPts + actPts + trendPts,
  ));

  const pattern: string = pc1h < -10 ? "DEEP-REVERSAL"
    : pc1h < -5 ? "REVERSAL"
    : pc1h < -3 ? "DIP-BUY"
    : "SHALLOW-DIP";

  return {
    score,
    passed: true,
    pattern,
    breakdown: {
      dropDepth:       { value: +pc1h.toFixed(1),           points: dropPts   },
      bounce:          { value: +pc5m.toFixed(1),           points: bouncePts },
      sentimentShift:  { value: +sentimentShift.toFixed(2), points: sentPts   },
      buyPressure:     { value: +bp.toFixed(0),             points: bpPts     },
      activity:        { vol1h, txns1h: totalTxns1h,        points: actPts    },
      trendAlignment:  { pc6h: +pc6h.toFixed(1), pc24h: +pc24h.toFixed(1), points: trendPts },
    },
    gateFailures: [],
    buyPressure5m: bp,
  };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  return res.json();
}

async function fetchBasePools(minLiquidity: number, limit: number): Promise<Candidate[]> {
  const [trendingRes, newPoolsRes] = await Promise.allSettled([
    fetchJson("https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1"),
    fetchJson("https://api.geckoterminal.com/api/v2/networks/base/new_pools?page=1"),
  ]);

  const rawPools: any[] = [
    ...(trendingRes.status === "fulfilled" ? trendingRes.value.data ?? [] : []),
    ...(newPoolsRes.status === "fulfilled"  ? newPoolsRes.value.data  ?? [] : []),
  ];

  if (!rawPools.length) throw new Error("GeckoTerminal returned no pools. Try again in a moment.");

  const seen = new Set<string>();
  const deduped = rawPools.filter(p => {
    if (!p?.attributes || !p.id) return false;
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return deduped
    .map((p: any) => {
      const a    = p.attributes ?? {};
      const txns = a.transactions ?? {};
      const pc   = a.price_change_percentage ?? {};
      const vol  = a.volume_usd ?? {};
      const liq  = parseFloat(a.reserve_in_usd ?? "0");
      const tokenRel = p.relationships?.base_token?.data?.id ?? "";
      const mint = tokenRel.includes("_") ? tokenRel.split("_")[1] : tokenRel;
      if (!mint?.startsWith("0x")) return null;
      return {
        mint,
        symbol:         (a.name ?? "").split(" / ")[0] || mint.slice(0, 8),
        priceUsd:       parseFloat(a.base_token_price_usd ?? "0"),
        priceChange5m:  parseFloat(pc.m5  ?? "0"),
        priceChange1h:  parseFloat(pc.h1  ?? "0"),
        priceChange6h:  parseFloat(pc.h6  ?? "0"),
        priceChange24h: parseFloat(pc.h24 ?? "0"),
        volume1h:       parseFloat(vol.h1  ?? "0"),
        liquidity:      liq,
        buys5m:         txns.m5?.buys  ?? 0,
        sells5m:        txns.m5?.sells ?? 0,
        buys1h:         txns.h1?.buys  ?? 0,
        sells1h:        txns.h1?.sells ?? 0,
      } satisfies Candidate;
    })
    .filter((c): c is Candidate => c !== null && c.liquidity >= minLiquidity)
    .slice(0, limit);
}

// ── Momentum scorer (inverse of dip-reversal) ────────────────────────────────
interface MomentumResult {
  score:         number;
  passed:        boolean;
  pattern:       string | null;
  gateFailures:  string[];
  buyPressure5m: number;
}

function scoreMomentum(c: Candidate, minLiquidity = DEFAULT_MIN_LIQ): MomentumResult {
  const pc5m  = c.priceChange5m;
  const pc1h  = c.priceChange1h;
  const pc6h  = c.priceChange6h;
  const pc24h = c.priceChange24h;
  const liq   = c.liquidity;
  const vol1h = c.volume1h;

  const totalTxns5m = c.buys5m + c.sells5m;
  const buyRatio5m  = totalTxns5m > 0 ? c.buys5m / totalTxns5m : 0;
  const totalTxns1h = c.buys1h + c.sells1h;
  const buyRatio1h  = totalTxns1h > 0 ? c.buys1h / totalTxns1h : 0;
  const bp          = buyRatio5m * 100;

  // Hard gates — all must pass
  const gateFailures: string[] = [];
  if (pc1h < 3)                              gateFailures.push(`1h momentum weak (${pc1h.toFixed(1)}% < 3%)`);
  if (pc5m < 0.5)                            gateFailures.push(`5m not accelerating (${pc5m.toFixed(1)}% < 0.5%)`);
  if (totalTxns5m > 5 && buyRatio5m < 0.55) gateFailures.push(`buy pressure low (${bp.toFixed(0)}% < 55%)`);
  if (liq < minLiquidity)                    gateFailures.push(`liquidity $${(liq / 1000).toFixed(0)}k < $${(minLiquidity / 1000).toFixed(0)}k min`);
  if (pc24h > 150)                           gateFailures.push(`already parabolic (24h ${pc24h.toFixed(0)}%)`);

  if (gateFailures.length > 0) {
    return { score: 0, passed: false, pattern: null, gateFailures, buyPressure5m: bp };
  }

  // 1. Momentum strength (0–25 pts)
  const momentumPts = pc1h >= 20 ? 25 : pc1h >= 10 ? 20 : pc1h >= 6 ? 15 : pc1h >= 3 ? 8 : 3;

  // 2. 5m acceleration (0–20 pts)
  const accelPts = pc5m >= 5 ? 20 : pc5m >= 3 ? 16 : pc5m >= 2 ? 12 : pc5m >= 1 ? 7 : 3;

  // 3. Buy pressure (0–15 pts)
  const bpPts = bp >= 70 ? 15 : bp >= 65 ? 12 : bp >= 60 ? 9 : bp >= 55 ? 5 : 2;

  // 4. Volume & activity (0–15 pts)
  const actPts = vol1h >= 100_000 && totalTxns1h >= 200 ? 15
    : vol1h >= 50_000 && totalTxns1h >= 100 ? 12
    : vol1h >= 20_000 && totalTxns1h >= 40  ? 8
    : vol1h >= 5_000  && totalTxns1h >= 10  ? 4 : 1;

  // 5. Trend continuation (0–15 pts)
  let trendPts = 0;
  if (pc6h > 5 && pc24h > 5)   trendPts = 15;
  else if (pc6h > 0 && pc24h > 0) trendPts = 10;
  else if (pc6h > 0)             trendPts = 5;

  // 6. Sentiment acceleration (0–10 pts)
  const sentAccel = buyRatio5m - buyRatio1h;
  const sentPts = sentAccel >= 0.10 ? 10 : sentAccel >= 0.05 ? 7 : sentAccel >= 0 ? 3 : 0;

  const score = Math.max(0, Math.min(100, momentumPts + accelPts + bpPts + actPts + trendPts + sentPts));
  const pattern = pc1h >= 15 ? "BREAKOUT" : pc1h >= 8 ? "MOMENTUM" : pc1h >= 3 ? "PUSH" : "WEAK-PUSH";

  return { score, passed: true, pattern, gateFailures: [], buyPressure5m: bp };
}

// ── Schemas ───────────────────────────────────────────────────────────────────
const AddressSchema    = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a valid 0x address");
const ScoreTokenSchema = z.object({ address: AddressSchema, minLiquidity: z.number().positive().optional() });
const CheckTokenSchema = z.object({ address: AddressSchema });
const ScanDipsSchema   = z.object({
  minScore:     z.number().min(0).max(100).optional(),
  minLiquidity: z.number().positive().optional(),
  limit:        z.number().int().min(1).max(100).optional(),
}).default({});

const ScanMomentumSchema = z.object({
  minScore:     z.number().min(0).max(100).optional(),
  minLiquidity: z.number().positive().optional(),
  limit:        z.number().int().min(1).max(100).optional(),
}).default({});

// ── Tool definitions ──────────────────────────────────────────────────────────
export const SCANNER_TOOLS: Tool[] = [
  {
    name: "score_token",
    description: "Run the 6-component dip-reversal score on any Base token. Returns a 0–100 score, pattern label (DEEP-REVERSAL / REVERSAL / DIP-BUY / SHALLOW-DIP), and full component breakdown. Data from DexScreener — no API key required.",
    inputSchema: {
      type: "object",
      properties: {
        address:      { type: "string", description: "Token contract address on Base (0x…)" },
        minLiquidity: { type: "number", description: "Minimum liquidity in USD (default 50000)" },
      },
      required: ["address"],
    },
  },
  {
    name: "check_token",
    description: "Security audit a Base token: honeypot, rug risk score, mint authority, freeze authority, LP lock %, buy/sell tax, holder count. Powered by GoPlusLabs (free). Always run this before buying an unknown token.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Token contract address on Base (0x…)" },
      },
      required: ["address"],
    },
  },
  {
    name: "scan_market",
    description:
      "Scan all trending + new Base pools for trading opportunities. Two modes: " +
      "'dips' finds dip-reversal setups (6-component scorer: momentum, buy pressure, depth, volume surge, trend context, volatility). " +
      "'momentum' finds breakout setups — tokens with strong 1h+ upward momentum still accelerating (gates: 1h > +3%, 5m rising, buy pressure > 55%). " +
      "No API keys required.",
    inputSchema: {
      type: "object",
      properties: {
        mode:         { type: "string", enum: ["dips", "momentum"], description: "Scan mode: 'dips' for reversal setups (default), 'momentum' for breakouts" },
        minScore:     { type: "number", description: "Min score to include in results (default 50)" },
        minLiquidity: { type: "number", description: "Min pool liquidity in USD (default 50000)" },
        limit:        { type: "number", description: "Max pools to scan (default 40, max 100)" },
      },
      required: [],
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────
export async function handleScannerTool(name: string, args: unknown): Promise<ToolResult | null> {

  // ── score_token ────────────────────────────────────────────────────────────
  if (name === "score_token") {
    const parsed = ScoreTokenSchema.safeParse(args);
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

    const { address, minLiquidity = DEFAULT_MIN_LIQ } = parsed.data;

    const data = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const pair = (data.pairs ?? [])
      .filter((p: any) => p.chainId === "base")
      .sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

    if (!pair) {
      return { content: [{ type: "text", text: `No Base trading pair found for \`${address}\`. Check the address or try a different token.` }], isError: true };
    }

    const c: Candidate = {
      mint:           address,
      symbol:         pair.baseToken?.symbol ?? address.slice(0, 8),
      priceUsd:       parseFloat(pair.priceUsd ?? "0"),
      priceChange5m:  pair.priceChange?.m5  ?? 0,
      priceChange1h:  pair.priceChange?.h1  ?? 0,
      priceChange6h:  pair.priceChange?.h6  ?? 0,
      priceChange24h: pair.priceChange?.h24 ?? 0,
      volume1h:       pair.volume?.h1       ?? 0,
      liquidity:      pair.liquidity?.usd   ?? 0,
      buys5m:         pair.txns?.m5?.buys   ?? 0,
      sells5m:        pair.txns?.m5?.sells  ?? 0,
      buys1h:         pair.txns?.h1?.buys   ?? 0,
      sells1h:        pair.txns?.h1?.sells  ?? 0,
    };

    const result = scoreDipReversal(c, minLiquidity);
    const bd     = result.breakdown;
    const bar    = "█".repeat(Math.round(result.score / 5)).padEnd(20, "░");

    const lines = [
      `## Dip-Reversal Score: ${c.symbol}`,
      `\`${address}\``,
      ``,
      `**Score: ${result.score}/100** \`${bar}\``,
      `**Pattern:** ${result.pattern ?? "—"}`,
      `**Price:** $${c.priceUsd.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}`,
      `**Liquidity:** $${(c.liquidity / 1_000).toFixed(0)}k`,
      ``,
    ];

    if (!result.passed) {
      lines.push(`**Gates failed — not a valid dip-reversal setup:**`);
      result.gateFailures.forEach(f => lines.push(`• ${f}`));
    } else {
      lines.push(`**Breakdown:**`);
      lines.push(`| Component | Signal | Points |`);
      lines.push(`|-----------|--------|--------|`);
      lines.push(`| Drop depth | ${bd.dropDepth?.value}% (1h) | ${bd.dropDepth?.points}/25 |`);
      lines.push(`| Bounce | ${bd.bounce?.value}% (5m) | ${bd.bounce?.points}/20 |`);
      lines.push(`| Sentiment shift | ${bd.sentimentShift?.value} ratio shift | ${bd.sentimentShift?.points}/15 |`);
      lines.push(`| Buy pressure | ${bd.buyPressure?.value}% buyers (5m) | ${bd.buyPressure?.points}/10 |`);
      lines.push(`| Activity | $${((bd.activity?.vol1h ?? 0) / 1000).toFixed(0)}k vol / ${bd.activity?.txns1h} txns | ${bd.activity?.points}/15 |`);
      lines.push(`| Trend | 6h ${bd.trendAlignment?.pc6h}% / 24h ${bd.trendAlignment?.pc24h}% | ${(bd.trendAlignment?.points ?? 0) > 0 ? "+" : ""}${bd.trendAlignment?.points}/15 |`);
      lines.push(``);

      if (result.score >= 65)     lines.push(`**Strong setup.** Score ≥65 — high probability dip-reversal.`);
      else if (result.score >= 50) lines.push(`**Marginal.** Score 50–64 — look for additional confirmation before entry.`);
      else                         lines.push(`**Weak.** Score <50 — skip this setup.`);

      lines.push(``, `Run \`check_token address="${address}"\` for a rug/security check before buying.`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ── check_token ────────────────────────────────────────────────────────────
  if (name === "check_token") {
    const parsed = CheckTokenSchema.safeParse(args);
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

    const { address } = parsed.data;

    // GoPlusLabs — chain 8453 = Base mainnet
    const data = await fetchJson(
      `https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${address}`,
    );
    const info = data.result?.[address.toLowerCase()] ?? data.result?.[address] ?? {};

    const isHoneypot   = info.is_honeypot     === "1";
    const isMintable   = info.is_mintable     === "1";
    const isFreezeAuth = info.transfer_pausable === "1";
    const isOpenSource = info.is_open_source   === "1";

    // LP lock: sum of all locked LP holders
    const lpLockedPct = ((info.lp_holders ?? []) as any[])
      .filter(h => h.is_locked)
      .reduce((s, h) => s + parseFloat(h.percent ?? "0"), 0) * 100;

    const buyTax  = parseFloat(info.buy_tax  ?? "0");
    const sellTax = parseFloat(info.sell_tax ?? "0");

    // Rug score: accumulate risk factors
    let rugScore = 0;
    if (isHoneypot)       rugScore += 50; // cannot sell → auto-danger
    if (isMintable)       rugScore += 30; // unlimited supply risk
    if (isFreezeAuth)     rugScore += 30; // transfers can be blocked
    if (lpLockedPct < 50) rugScore += 20; // LP can be pulled
    if (sellTax > 10)     rugScore += 15; // high sell tax
    rugScore = Math.min(100, rugScore);

    const verdict = (isHoneypot || rugScore >= 60) ? "DANGER"
      : rugScore >= 30 ? "CAUTION"
      : "SAFE";

    const icon = { DANGER: "🔴", CAUTION: "🟡", SAFE: "🟢" }[verdict];

    const lines = [
      `## Token Security Check`,
      `\`${address}\``,
      ``,
      `**Verdict: ${icon} ${verdict}** (rug score: ${rugScore}/100)`,
      ``,
      `| Check | Status |`,
      `|-------|--------|`,
      `| Honeypot | ${isHoneypot   ? "🔴 YES — cannot sell" : "🟢 No"} |`,
      `| Mint authority | ${isMintable   ? "🔴 Yes — supply can inflate" : "🟢 No"} |`,
      `| Transfer freeze | ${isFreezeAuth ? "🔴 Yes — transfers can be paused" : "🟢 No"} |`,
      `| Open source | ${isOpenSource ? "🟢 Yes" : "🔴 No — unverified contract"} |`,
      `| LP locked | ${lpLockedPct >= 80 ? "🟢" : lpLockedPct >= 50 ? "🟡" : "🔴"} ${lpLockedPct.toFixed(1)}% |`,
      `| Buy tax | ${buyTax > 5 ? "🟡" : "🟢"} ${buyTax}% |`,
      `| Sell tax | ${sellTax > 10 ? "🔴" : sellTax > 5 ? "🟡" : "🟢"} ${sellTax}% |`,
      `| Holder count | ${info.holder_count ?? "unknown"} |`,
      ``,
    ];

    if (verdict === "DANGER") {
      lines.push(`**Do not buy.** This token has critical red flags. High risk of total loss.`);
    } else if (verdict === "CAUTION") {
      lines.push(`**Trade carefully.** Elevated risk — verify team, community, and LP lock before buying. Keep position size small.`);
    } else {
      lines.push(`**Passes basic security checks.** No critical red flags found. Always DYOR — security checks are not a guarantee.`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ── scan_market ────────────────────────────────────────────────────────────
  if (name === "scan_market") {
    const parsed = ScanDipsSchema.safeParse(args ?? {});
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

    const input = args as any;
    const mode = input?.mode === "momentum" ? "momentum" : "dips";
    const { minScore = DEFAULT_MIN_SCORE, minLiquidity = DEFAULT_MIN_LIQ, limit = 40 } = parsed.data;

    let candidates: Candidate[];
    try {
      candidates = await fetchBasePools(minLiquidity, limit);
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }

    const sign = (n: number) => n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1);

    if (mode === "momentum") {
      type ScoredMomentum = Candidate & MomentumResult;
      const scored: ScoredMomentum[] = candidates
        .map(c => ({ ...c, ...scoreMomentum(c, minLiquidity) }))
        .filter(c => c.passed && c.score >= minScore)
        .sort((a, b) => b.score - a.score);

      if (!scored.length) {
        return {
          content: [{
            type: "text",
            text: [
              `## Momentum Scan — No Breakouts Found`,
              `Scanned **${candidates.length} pools** on Base. None passed the momentum gates with score ≥ ${minScore}.`,
              `When nothing breaks out, the market may be in consolidation. Try \`scan_market mode=dips\` instead.`,
            ].join("\n"),
          }],
        };
      }

      const lines = [
        `## Momentum Scan — ${scored.length} Breakout${scored.length !== 1 ? "s" : ""} Found`,
        `Scanned **${candidates.length} pools** · Score ≥ ${minScore} · Liq ≥ $${(minLiquidity / 1000).toFixed(0)}k`,
        ``,
      ];
      for (const c of scored.slice(0, 10)) {
        const bar = "█".repeat(Math.round(c.score / 10)).padEnd(10, "░");
        lines.push(`### ${c.symbol} · ${c.score}/100 \`${bar}\``);
        lines.push(`**Pattern:** ${c.pattern} · **Liq:** $${(c.liquidity / 1_000).toFixed(0)}k · **1h:** ${sign(c.priceChange1h)}% · **5m:** ${sign(c.priceChange5m)}%`);
        lines.push(`**Buy pressure:** ${c.buyPressure5m.toFixed(0)}% · **Vol 1h:** $${(c.volume1h / 1_000).toFixed(0)}k`);
        lines.push(`**Trend:** 6h ${sign(c.priceChange6h)}% / 24h ${sign(c.priceChange24h)}%`);
        lines.push(`\`${c.mint}\``);
        lines.push(``);
      }
      lines.push(`---`);
      lines.push(`Next steps: \`score_token\` · \`check_token\` for rug check`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    // mode === "dips"
    type ScoredCandidate = Candidate & ScoreResult;
    const scored: ScoredCandidate[] = candidates
      .map(c => ({ ...c, ...scoreDipReversal(c, minLiquidity) }))
      .filter(c => c.passed && c.score >= minScore)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      return {
        content: [{
          type: "text",
          text: [
            `## Dip Scan — No Setups Found`,
            `Scanned **${candidates.length} pools** on Base. None passed the dip-reversal gates with score ≥ ${minScore}.`,
            `This is a signal in itself — try \`scan_market mode=momentum\` or check back in 5–10 minutes.`,
          ].join("\n"),
        }],
      };
    }

    const lines = [
      `## Dip Scan — ${scored.length} Setup${scored.length !== 1 ? "s" : ""} Found`,
      `Scanned **${candidates.length} pools** · Score ≥ ${minScore} · Liq ≥ $${(minLiquidity / 1000).toFixed(0)}k`,
      ``,
    ];
    for (const c of scored.slice(0, 10)) {
      const bar = "█".repeat(Math.round(c.score / 10)).padEnd(10, "░");
      const bd  = c.breakdown;
      lines.push(`### ${c.symbol} · ${c.score}/100 \`${bar}\``);
      lines.push(`**Pattern:** ${c.pattern} · **Liq:** $${(c.liquidity / 1_000).toFixed(0)}k · **1h:** ${sign(c.priceChange1h)}% · **5m:** ${sign(c.priceChange5m)}%`);
      lines.push(`**Buy pressure:** ${c.buyPressure5m.toFixed(0)}% · **Vol 1h:** $${((bd.activity?.vol1h ?? 0) / 1_000).toFixed(0)}k · **Txns:** ${bd.activity?.txns1h ?? 0}`);
      lines.push(`**Trend:** 6h ${sign(c.priceChange6h)}% / 24h ${sign(c.priceChange24h)}%`);
      lines.push(`\`${c.mint}\``);
      lines.push(``);
    }
    lines.push(`---`);
    lines.push(`Next steps: \`score_token\` for full breakdown · \`check_token\` for rug check`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  return null;
}
