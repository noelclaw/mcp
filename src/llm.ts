import { signRequest } from "./wallet.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const BANKR_URL = "https://llm.bankr.bot/v1/chat/completions";
const GROK_URL = "https://api.x.ai/v1/chat/completions";
const CONVEX_SITE = process.env.NOELCLAW_CONVEX_URL ?? "https://api.noelclaw.com";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type LiveSearchSource = "web" | "x" | "news" | "rss";

export interface LiveSearchOptions {
  mode: "auto" | "on";
  sources: LiveSearchSource[];
  maxResults?: number;
  fromDate?: string;  // ISO YYYY-MM-DD
  toDate?: string;    // ISO YYYY-MM-DD
}

export interface LLMOptions {
  /**
   * Provider-specific real-time search. Currently only applied when Grok is
   * the active provider (`provider="grok"` or auto-selected Grok).
   * For other providers this is silently ignored — the call proceeds normally.
   */
  liveSearch?: LiveSearchOptions;
  /**
   * Per-call model override. When set, takes precedence over NOELCLAW_MODEL
   * and provider defaults. Useful when one tool (e.g. deep_research) wants a
   * Grok model via Bankr for real-time search while the rest of the stack
   * stays on Claude. Pass a Bankr-supported name like `grok-4.3` or
   * `claude-sonnet-4-6`.
   */
  model?: string;
}

/**
 * Returns true if Grok is the currently active LLM provider, based on env.
 * Useful for tools that want to conditionally enable Grok-specific features
 * like Live Search.
 */
export function isGrokActive(): boolean {
  const provider = process.env.NOELCLAW_PROVIDER?.toLowerCase().trim();
  if (provider === "grok") return !!process.env.GROK_API_KEY;
  if (provider === "bankr" || provider === "anthropic") return false;
  // Auto-priority — Grok is only active if it's the only key present
  if (process.env.BANKR_API_KEY || process.env.ANTHROPIC_API_KEY) return false;
  return !!process.env.GROK_API_KEY;
}

/**
 * Call the best available LLM.
 *
 * Provider auto-priority (when NOELCLAW_PROVIDER unset):
 *   BANKR_API_KEY → ANTHROPIC_API_KEY → GROK_API_KEY → Convex backend
 *
 * Force a provider via NOELCLAW_PROVIDER: "bankr" | "anthropic" | "grok"
 *
 * Model selection (first wins):
 *   NOELCLAW_MODEL → {provider}_MODEL → provider default
 */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 1024,
  history: ChatMessage[] = [],
  timeoutMs = 60_000,
  options: LLMOptions = {},
): Promise<string> {
  const provider     = process.env.NOELCLAW_PROVIDER?.toLowerCase().trim();
  const bankrKey     = process.env.BANKR_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const grokKey      = process.env.GROK_API_KEY;

  // Explicit provider override — user picked one
  if (provider === "grok" && grokKey)           return callGrok(grokKey, systemPrompt, userPrompt, maxTokens, history, timeoutMs, options.liveSearch, options.model);
  if (provider === "anthropic" && anthropicKey) return callAnthropic(anthropicKey, systemPrompt, userPrompt, maxTokens, history, timeoutMs, options.model);
  if (provider === "bankr" && bankrKey)         return callBankr(bankrKey, systemPrompt, userPrompt, maxTokens, history, timeoutMs, options.model);

  // Auto priority
  if (bankrKey)     return callBankr(bankrKey, systemPrompt, userPrompt, maxTokens, history, timeoutMs, options.model);
  if (anthropicKey) return callAnthropic(anthropicKey, systemPrompt, userPrompt, maxTokens, history, timeoutMs, options.model);
  if (grokKey)      return callGrok(grokKey, systemPrompt, userPrompt, maxTokens, history, timeoutMs, options.liveSearch, options.model);

  // Fallback: route through Convex backend — owner covers cost
  return callViaConvex(systemPrompt, userPrompt, history, timeoutMs);
}

async function callViaConvex(
  systemPrompt: string,
  userPrompt: string,
  history: ChatMessage[],
  timeoutMs: number,
): Promise<string> {
  const fullQuestion = systemPrompt
    ? `[System: ${systemPrompt}]\n\n${userPrompt}`
    : userPrompt;

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const apiKey = process.env.NOELCLAW_API_KEY;
  const sessionToken = process.env.NOELCLAW_SESSION_TOKEN;
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else if (sessionToken) {
    headers["Authorization"] = `Bearer ${sessionToken}`;
  } else {
    try {
      const { address, signature, timestamp } = await signRequest("ask_noel");
      headers["X-Wallet-Address"] = address;
      headers["X-Wallet-Signature"] = signature;
      headers["X-Wallet-Timestamp"] = timestamp;
    } catch { /* proceed without wallet auth */ }
  }

  const res = await fetch(`${CONVEX_SITE}/mcp/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ question: fullQuestion, messages: history }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { answer?: string };
  return data.answer ?? "";
}

async function callAnthropic(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  history: ChatMessage[],
  timeoutMs: number,
  modelOverride?: string,
): Promise<string> {
  const messages: ChatMessage[] = [...history, { role: "user", content: userPrompt }];
  const model = modelOverride ?? process.env.NOELCLAW_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
  return data.content?.find(b => b.type === "text")?.text ?? "";
}

async function callBankr(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  history: ChatMessage[],
  timeoutMs: number,
  modelOverride?: string,
): Promise<string> {
  const model = modelOverride ?? process.env.NOELCLAW_MODEL ?? process.env.BANKR_MODEL ?? "claude-haiku-4-5-20251001";

  const res = await fetch(BANKR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Bankr error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

async function callGrok(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  history: ChatMessage[],
  timeoutMs: number,
  liveSearch?: LiveSearchOptions,
  modelOverride?: string,
): Promise<string> {
  const model = modelOverride ?? process.env.NOELCLAW_MODEL ?? process.env.GROK_MODEL ?? "grok-4-fast-reasoning";

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: userPrompt },
    ],
    max_tokens: maxTokens,
    stream: false,
  };

  // xAI Live Search — pulls real-time results from web/X/news/RSS during inference.
  // Docs: https://docs.x.ai/docs/guides/live-search
  // Note: as of late 2026 xAI deprecated this in favor of Agent Tools API
  // (returns 410 Gone). We detect that and retry without search_parameters
  // so synthesis still succeeds — just without the real-time augmentation.
  if (liveSearch) {
    body.search_parameters = {
      mode: liveSearch.mode,
      sources: liveSearch.sources.map((type) => ({ type })),
      max_search_results: liveSearch.maxResults ?? 10,
      ...(liveSearch.fromDate ? { from_date: liveSearch.fromDate } : {}),
      ...(liveSearch.toDate ? { to_date: liveSearch.toDate } : {}),
    };
  }

  let res = await fetch(GROK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  // Live Search deprecated → strip search_parameters and retry
  if (res.status === 410 && liveSearch) {
    delete (body as Record<string, unknown>).search_parameters;
    res = await fetch(GROK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Grok error ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    citations?: string[];
  };

  const content = data.choices?.[0]?.message?.content ?? "";

  // When Live Search ran (and was not deprecated), append the citations as a
  // parsable block at the bottom — downstream consumers (deep_research) can
  // read these and merge into the final source list.
  if (liveSearch && data.citations && data.citations.length > 0) {
    return `${content}\n\n<!--GROK_LIVE_CITATIONS\n${data.citations.join("\n")}\nGROK_LIVE_CITATIONS-->`;
  }

  return content;
}
