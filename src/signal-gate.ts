// Insufficient-signal detector used by deep_research before saving to vault.
// Mirrors convex/_signalGate.ts in the app - same logic, different runtime.

export type SignalCheck = {
  ok: boolean;
  reason?: string;
  score: number;
};

const META_FAILURE_PHRASES = [
  "search returned directory",
  "directory pages",
  "topic landing pages",
  "landing pages from major",
  "aggregator homepages",
  "index pages",
  "results provide no",
  "no specific findings",
  "no specific developments",
  "no specific announcements",
  "no specific stories",
  "no concrete findings",
  "no substantive findings",
  "no specific breakthroughs",
  "no specific data",
  "rather than current stories",
  "rather than specific",
  "rather than individual articles",
  "insufficient data to",
  "search results were thin",
] as const;

export function checkSignal(content: string): SignalCheck {
  const text = (content ?? "").trim();
  if (text.length < 300) {
    return { ok: false, reason: "output too short (<300 chars)", score: 0 };
  }

  const lower = text.toLowerCase();
  for (const phrase of META_FAILURE_PHRASES) {
    if (lower.includes(phrase)) {
      return {
        ok: false,
        reason: `search returned only metadata pages - LLM flagged it ("${phrase}")`,
        score: 0.2,
      };
    }
  }

  const numbers = (text.match(/\b\d{1,4}([.,]\d+)?\s*(%|USD|usd|m|M|k|K|bn|B|x|gwei|eth|ETH|btc|BTC)?\b/g) ?? []).length;
  const links = (text.match(/https?:\/\//g) ?? []).length;
  const quotes = (text.match(/"[^"]{10,}"/g) ?? []).length;

  if (text.length < 800 && numbers < 3 && links < 1 && quotes < 1) {
    return {
      ok: false,
      reason: "low concrete-data density (no numbers, links, or quoted findings)",
      score: 0.3,
    };
  }

  const lengthScore = Math.min(1, text.length / 2000);
  const dataScore = Math.min(1, (numbers + links * 2 + quotes * 2) / 25);
  const score = Math.max(0, Math.min(1, lengthScore * 0.4 + dataScore * 0.6));

  return { ok: true, score };
}
