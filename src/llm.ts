import { signRequest } from "./wallet.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const BANKR_URL = "https://llm.bankr.bot/v1/chat/completions";
const GROK_URL = "https://api.x.ai/v1/chat/completions";
const CONVEX_SITE = process.env.NOELCLAW_CONVEX_URL ?? "https://api.noelclaw.com";

export type ChatMessage = { role: "user" | "assistant"; content: string };

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
): Promise<string> {
  const provider     = process.env.NOELCLAW_PROVIDER?.toLowerCase().trim();
  const bankrKey     = process.env.BANKR_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const grokKey      = process.env.GROK_API_KEY;

  // Explicit provider override — user picked one
  if (provider === "grok" && grokKey)           return callGrok(grokKey, systemPrompt, userPrompt, maxTokens, history, timeoutMs);
  if (provider === "anthropic" && anthropicKey) return callAnthropic(anthropicKey, systemPrompt, userPrompt, maxTokens, history, timeoutMs);
  if (provider === "bankr" && bankrKey)         return callBankr(bankrKey, systemPrompt, userPrompt, maxTokens, history, timeoutMs);

  // Auto priority
  if (bankrKey)     return callBankr(bankrKey, systemPrompt, userPrompt, maxTokens, history, timeoutMs);
  if (anthropicKey) return callAnthropic(anthropicKey, systemPrompt, userPrompt, maxTokens, history, timeoutMs);
  if (grokKey)      return callGrok(grokKey, systemPrompt, userPrompt, maxTokens, history, timeoutMs);

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
): Promise<string> {
  const messages: ChatMessage[] = [...history, { role: "user", content: userPrompt }];
  const model = process.env.NOELCLAW_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

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
): Promise<string> {
  const model = process.env.NOELCLAW_MODEL ?? process.env.BANKR_MODEL ?? "claude-haiku-4-5-20251001";

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
): Promise<string> {
  const model = process.env.NOELCLAW_MODEL ?? process.env.GROK_MODEL ?? "grok-4-fast-reasoning";

  const res = await fetch(GROK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Grok error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}
