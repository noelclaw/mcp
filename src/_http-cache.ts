// Shared cache + 429-backoff wrapper for external HTTP calls.
// Designed for read-heavy public APIs like CoinGecko (free tier: 30 req/min)
// and DexScreener - agent loops + parallel tool calls were tripping rate
// limits in production. Cache hit returns the prior body without a network
// round-trip; cache miss does a fetch with bounded retries on 429/503.
//
// The cache is in-process only - every MCP server process keeps its own
// LRU. That's intentional: tokens get fresh data on cold start, no shared
// state to invalidate across users.

const DEFAULT_TTL_MS = 45_000;       // 45s - fresh enough for prices, generous enough to absorb a flurry
const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_RETRY_DELAYS_MS = [500, 1500, 4000];

type CacheEntry = { body: string; status: number; expiresAt: number };

const cache = new Map<string, CacheEntry>();

function cacheKey(url: string, init?: RequestInit): string {
  // POST bodies are part of the key so two POSTs with different params don't collide.
  if (!init || !init.body || init.method === "GET") return `GET ${url}`;
  return `${init.method ?? "POST"} ${url} ${typeof init.body === "string" ? init.body : ""}`;
}

function evictExpired(): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt < now) cache.delete(k);
  }
  // LRU-ish eviction - Map preserves insertion order, so the first keys are oldest.
  while (cache.size > DEFAULT_MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey === undefined) break;
    cache.delete(firstKey);
  }
}

export interface CachedFetchOptions {
  ttlMs?: number;
  retryDelaysMs?: number[];
  timeoutMs?: number;
  bypassCache?: boolean;
}

export async function cachedFetch(
  url: string,
  init: RequestInit = {},
  opts: CachedFetchOptions = {},
): Promise<{ ok: boolean; status: number; text: string; fromCache: boolean }> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const retryDelays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const timeout = opts.timeoutMs ?? 15_000;

  evictExpired();
  const key = cacheKey(url, init);

  if (!opts.bypassCache) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      // Refresh recency - re-insert moves it to the end of the Map.
      cache.delete(key);
      cache.set(key, hit);
      return { ok: hit.status >= 200 && hit.status < 300, status: hit.status, text: hit.body, fromCache: true };
    }
  }

  let lastStatus = 0;
  let lastText = "";

  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
      const text = await res.text();
      lastStatus = res.status;
      lastText = text;

      // Cache successful responses + 404s (404 is "definitively not found" - no point retrying).
      if (res.ok || res.status === 404) {
        cache.set(key, { body: text, status: res.status, expiresAt: Date.now() + ttl });
        return { ok: res.ok, status: res.status, text, fromCache: false };
      }

      // Retry on 429 (rate limit) and 5xx (transient server errors).
      if (res.status === 429 || res.status >= 500) {
        const delay = retryDelays[attempt];
        if (delay === undefined) break;
        // Honor server's Retry-After if provided (CoinGecko sends this).
        const retryAfter = res.headers.get("retry-after");
        const waitMs = retryAfter ? Math.min(parseInt(retryAfter) * 1000, 30_000) : delay;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      // Non-retryable client error (400/401/403) - surface to caller without retry.
      return { ok: false, status: res.status, text, fromCache: false };
    } catch (err) {
      lastText = err instanceof Error ? err.message : String(err);
      const delay = retryDelays[attempt];
      if (delay === undefined) break;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return { ok: false, status: lastStatus, text: lastText, fromCache: false };
}

export function clearHttpCache(): void {
  cache.clear();
}

export function httpCacheStats(): { size: number; maxEntries: number } {
  return { size: cache.size, maxEntries: DEFAULT_MAX_ENTRIES };
}
