import { ALL_TOOLS, HANDLER_MAP } from "./server.js";
import { callLLM, type ChatMessage } from "./llm.js";
import { callConvex } from "./convex.js";

const SYSTEM_PROMPT =
  "You are Noelclaw, a persistent AI operating system with 102 tools spanning memory, vault, deep research, agents, code, automations, DeFi, and GitHub. " +
  "Be direct and concise. Pick the right tool — don't narrate the choice. Summarize tool results in plain English. " +
  "For deep research: prefer deep_research (multi-stage, saves to vault). Use continueFrom when extending prior reports. " +
  "For live web info: use web_search. For market questions: use get_market_data or market_thesis. " +
  "Save substantive findings to vault; do not save thin or empty outputs.";

export type AgentResult = {
  text: string;
  toolCalls: Array<{ name: string }>;
};

export async function runAgent(
  userMessage: string,
  history: ChatMessage[],
  onToolCall: (name: string) => void,
): Promise<AgentResult> {
  const bankrKey     = process.env.BANKR_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (bankrKey)     return runBankrLoop(bankrKey, userMessage, history, onToolCall);
  if (anthropicKey) return runAnthropicLoop(anthropicKey, userMessage, history, onToolCall);

  // No direct key — proxy through Noelclaw backend. Wallet auto-creates at ~/.noelclaw/wallet.json
  // on first use and signs requests transparently. No account or config needed.
  try {
    return await runConvexProxiedLoop(userMessage, history, onToolCall);
  } catch {
    // Network down or backend unavailable — plain chat fallback
    const text = await callLLM(SYSTEM_PROMPT, userMessage, 1024, history);
    return { text, toolCalls: [] };
  }
}

// ── Anthropic agent loop ─────────────────────────────────────────────────────

function toAnthropicTool(tool: any) {
  return {
    name: tool.name,
    description: tool.description ?? "",
    input_schema: tool.inputSchema ?? { type: "object", properties: {} },
  };
}

async function runAnthropicLoop(
  apiKey: string,
  userMessage: string,
  history: ChatMessage[],
  onToolCall: (name: string) => void,
): Promise<AgentResult> {
  const model = process.env.NOELCLAW_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
  const tools = ALL_TOOLS.map(toAnthropicTool);
  const toolCalls: Array<{ name: string }> = [];

  const messages: any[] = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: "user", content: userMessage },
  ];

  for (let turn = 0; turn < 10; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: 2048, system: SYSTEM_PROMPT, tools, messages }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json() as any;
    messages.push({ role: "assistant", content: data.content });

    if (data.stop_reason !== "tool_use") {
      const text = (data.content as any[])
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("");
      return { text, toolCalls };
    }

    // Execute all tool_use blocks
    const toolResults: any[] = [];
    for (const block of data.content as any[]) {
      if (block.type !== "tool_use") continue;

      onToolCall(block.name);
      toolCalls.push({ name: block.name });

      let resultText: string;
      try {
        const handler = HANDLER_MAP.get(block.name);
        if (!handler) throw new Error(`Unknown tool: ${block.name}`);
        const result = await handler(block.name, block.input ?? {});
        resultText = result?.content?.[0]?.text ?? "Done.";
      } catch (err: any) {
        resultText = `Error: ${err.message}`;
      }

      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return { text: "Reached max tool iterations.", toolCalls };
}

// ── Convex-proxied Anthropic loop (session token only — platform covers LLM) ──

async function runConvexProxiedLoop(
  userMessage: string,
  history: ChatMessage[],
  onToolCall: (name: string) => void,
): Promise<AgentResult> {
  const model = process.env.NOELCLAW_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
  const tools = ALL_TOOLS.map(toAnthropicTool);
  const toolCalls: Array<{ name: string }> = [];

  const messages: any[] = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: "user", content: userMessage },
  ];

  for (let turn = 0; turn < 10; turn++) {
    // callConvex handles wallet/session auth automatically; 90s timeout matches the proxy endpoint
    const data = await callConvex("/llm/complete", "POST", {
      model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    }, "llm_complete", 90_000);

    messages.push({ role: "assistant", content: data.content });

    if (data.stop_reason !== "tool_use") {
      const text = (data.content as any[])
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("");
      return { text, toolCalls };
    }

    const toolResults: any[] = [];
    for (const block of data.content as any[]) {
      if (block.type !== "tool_use") continue;

      onToolCall(block.name);
      toolCalls.push({ name: block.name });

      let resultText: string;
      try {
        const handler = HANDLER_MAP.get(block.name);
        if (!handler) throw new Error(`Unknown tool: ${block.name}`);
        const result = await handler(block.name, block.input ?? {});
        resultText = result?.content?.[0]?.text ?? "Done.";
      } catch (err: any) {
        resultText = `Error: ${err.message}`;
      }

      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return { text: "Reached max tool iterations.", toolCalls };
}

// ── Bankr (OpenAI-compatible) agent loop ─────────────────────────────────────

function toBankrTool(tool: any) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
    },
  };
}

async function runBankrLoop(
  apiKey: string,
  userMessage: string,
  history: ChatMessage[],
  onToolCall: (name: string) => void,
): Promise<AgentResult> {
  const model = process.env.NOELCLAW_MODEL ?? process.env.BANKR_MODEL ?? "claude-haiku-4-5-20251001";
  const tools = ALL_TOOLS.map(toBankrTool);
  const toolCalls: Array<{ name: string }> = [];

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: "user", content: userMessage },
  ];

  for (let turn = 0; turn < 10; turn++) {
    const res = await fetch("https://llm.bankr.bot/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ model, messages, tools, max_tokens: 2048 }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Bankr ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json() as any;
    const choice = data.choices?.[0]?.message;
    if (!choice) throw new Error("Empty response from Bankr");

    messages.push(choice);

    if (!choice.tool_calls?.length) {
      return { text: choice.content ?? "", toolCalls };
    }

    for (const call of choice.tool_calls) {
      onToolCall(call.function.name);
      toolCalls.push({ name: call.function.name });

      let resultText: string;
      try {
        const args = JSON.parse(call.function.arguments ?? "{}");
        const handler = HANDLER_MAP.get(call.function.name);
        if (!handler) throw new Error(`Unknown tool: ${call.function.name}`);
        const result = await handler(call.function.name, args);
        resultText = result?.content?.[0]?.text ?? "Done.";
      } catch (err: any) {
        resultText = `Error: ${err.message}`;
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: resultText });
    }
  }

  return { text: "Reached max tool iterations.", toolCalls };
}
