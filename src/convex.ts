import { signRequest } from "./wallet.js";
import { getSavedToken } from "./config.js";

const CONVEX_SITE = process.env.NOELCLAW_CONVEX_URL ?? "https://befitting-porcupine-276.convex.site";
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS = [500, 1000, 2000];

export class PaymentRequiredError extends Error {
  readonly details: unknown;
  constructor(details: unknown) {
    super("Payment required");
    this.name = "PaymentRequiredError";
    this.details = details;
  }
}

export function buildPaymentHeader(txHash: string, requestId: string): string {
  return Buffer.from(`${txHash}:${requestId}`).toString("base64");
}

async function attemptConvex(url: string, method: string, headers: Record<string, string>, body?: unknown, timeoutMs = 30_000): Promise<Response> {
  return fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function callConvex(path: string, method: string, body?: unknown, toolName = "unknown", timeoutMs = 30_000): Promise<any> {
  const url = `${CONVEX_SITE}${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const apiKey      = process.env.NOELCLAW_API_KEY;
  const sessionToken = getSavedToken(); // env var → saved config fallback
  const authHeader  = apiKey
    ? `Bearer ${apiKey}`
    : sessionToken
    ? `Bearer ${sessionToken}`
    : null;
  if (authHeader) {
    headers["Authorization"] = authHeader;
  } else {
    try {
      const { address, signature, timestamp } = await signRequest(toolName);
      headers["X-Wallet-Address"] = address;
      headers["X-Wallet-Signature"] = signature;
      headers["X-Wallet-Timestamp"] = timestamp;
    } catch {
      // continue without wallet headers - server will respond with 401/402
    }
  }

  const paymentHeader = process.env.NOELCLAW_PAYMENT_HEADER;
  if (paymentHeader) headers["X-Payment"] = paymentHeader;

  // BYOK headers - user pays for their own AI/service costs
  if (process.env.ANTHROPIC_API_KEY) headers["X-User-Anthropic-Key"] = process.env.ANTHROPIC_API_KEY;
  if (process.env.GROK_API_KEY) headers["X-User-Grok-Key"] = process.env.GROK_API_KEY;
  if (process.env.BANKR_API_KEY) headers["X-User-Bankr-Key"] = process.env.BANKR_API_KEY;
  if (process.env.TELEGRAM_BOT_TOKEN) headers["X-User-Telegram-Token"] = process.env.TELEGRAM_BOT_TOKEN;
  if (process.env.TELEGRAM_CHAT_ID) headers["X-User-Telegram-Chat"] = process.env.TELEGRAM_CHAT_ID;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt - 1]));
    }
    let res: Response;
    try {
      res = await attemptConvex(url, method, headers, body, timeoutMs);
    } catch (err: any) {
      lastError = err;
      continue;
    }

    if (res.status === 402) {
      const b = await res.json().catch(() => ({}));
      throw new PaymentRequiredError(b);
    }

    if (res.status === 401) {
      const b = await res.json().catch(() => ({})) as {
        message?: string; url?: string; hint?: string; alternative?: string;
      };
      throw new Error(
        `🔑 ${b.message || "Authentication required"}\n\n` +
        `→ Sign in at: ${b.url || "https://noelclaw.com"}\n\n` +
        `Hint: ${b.hint || 'Add NOELCLAW_SESSION_TOKEN=noel_... to the env block in your MCP config'}\n\n` +
        `${b.alternative ? `Alternative: ${b.alternative}` : ""}`
      );
    }

    if (RETRY_STATUSES.has(res.status) && attempt < RETRY_DELAYS.length) {
      lastError = new Error(`Noelclaw API error: ${res.status}`);
      continue;
    }

    if (!res.ok) throw new Error(`Noelclaw API error: ${res.status} ${await res.text()}`);
    return res.json() as Promise<any>;
  }

  throw lastError ?? new Error("Request failed after retries");
}

// Variant that returns the response body as raw text. Used for endpoints
// that stream non-JSON content like /vault/blob (large vault entries that
// were offloaded to Convex File Storage).
export async function callConvexRaw(path: string, toolName = "unknown", timeoutMs = 60_000): Promise<string> {
  const url = `${CONVEX_SITE}${path}`;
  const headers: Record<string, string> = {};

  const apiKey       = process.env.NOELCLAW_API_KEY;
  const sessionToken = getSavedToken();
  const authHeader   = apiKey
    ? `Bearer ${apiKey}`
    : sessionToken
    ? `Bearer ${sessionToken}`
    : null;
  if (authHeader) {
    headers["Authorization"] = authHeader;
  } else {
    try {
      const { address, signature, timestamp } = await signRequest(toolName);
      headers["X-Wallet-Address"] = address;
      headers["X-Wallet-Signature"] = signature;
      headers["X-Wallet-Timestamp"] = timestamp;
    } catch {}
  }

  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Noelclaw API error: ${res.status}`);
  return res.text();
}

export async function notifyTelegram(userId: string, message: string): Promise<{ sent: boolean; reason?: string }> {
  try {
    return await callConvex("/user/telegram/notify", "POST", { userId, message }, "set_telegram");
  } catch (error: any) {
    return { sent: false, reason: error.message ?? String(error) };
  }
}
