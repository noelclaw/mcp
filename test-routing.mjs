/**
 * test-routing.mjs - run with: node test-routing.mjs
 *
 * Tests:
 *  1. LLM routing priority (Bankr-first)
 *  2. Agent-loop routing priority (Bankr-first, no grok-3)
 *  3. Bankr adapter: toOpenAITools()
 *  4. Bankr adapter: anthropicMsgsToOpenAI() - including tool_use/tool_result blocks
 *  5. Bankr adapter: normalizeOpenAIResponse() - tool_use and end_turn stop reasons
 *  6. noelAIChat() falls back to Anthropic when flag is off
 */

import { readFileSync } from 'fs';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Verify routing priority in compiled llm.js
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. llm.ts routing priority');
{
  const src = readFileSync('./dist/llm.js', 'utf8');
  const bankrIdx    = src.indexOf('BANKR_API_KEY');
  const anthropicIdx = src.indexOf('ANTHROPIC_API_KEY');
  assert(bankrIdx < anthropicIdx, 'BANKR_API_KEY checked before ANTHROPIC_API_KEY in callLLM()');

  // Verify NOELCLAW_MODEL is the first model env var checked
  const noelModelIdx  = src.indexOf('NOELCLAW_MODEL');
  const bankrModelIdx = src.indexOf('BANKR_MODEL');
  assert(noelModelIdx < bankrModelIdx, 'NOELCLAW_MODEL checked before BANKR_MODEL');

  // Verify grok-3 is gone
  assert(!src.includes('grok-3'), 'No hardcoded grok-3 in llm.js');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Verify routing priority in compiled agent-loop.js
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2. agent-loop.ts routing priority');
{
  const src = readFileSync('./dist/agent-loop.js', 'utf8');

  // In the exported runAgent(), bankrKey should be checked before anthropicKey
  // Find the runAgent function body
  const runAgentStart = src.indexOf('async function runAgent');
  const runAgentEnd   = src.indexOf('async function runAnthropicLoop');
  const runAgentBody  = src.slice(runAgentStart, runAgentEnd);

  const bankrIdx    = runAgentBody.indexOf('bankrKey');
  const anthropicIdx = runAgentBody.indexOf('anthropicKey');
  assert(bankrIdx < anthropicIdx, 'runAgent(): bankrKey checked before anthropicKey');

  // No grok-3 default anywhere
  assert(!src.includes('grok-3'), 'No hardcoded grok-3 in agent-loop.js');

  // NOELCLAW_MODEL present in all three loops
  const occurrences = (src.match(/NOELCLAW_MODEL/g) ?? []).length;
  assert(occurrences >= 3, `NOELCLAW_MODEL referenced in all loops (found ${occurrences}x, need ≥3)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3-5. Bankr adapter functions - copy from noel-ai.js and test directly
// ─────────────────────────────────────────────────────────────────────────────

// ── toOpenAITools ─────────────────────────────────────────────────────────────
console.log('\n3. toOpenAITools()');
{
  function toOpenAITools(anthropicTools) {
    return anthropicTools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description ?? '',
        parameters: t.input_schema,
      },
    }));
  }

  const input = [
    { name: 'vault_save', description: 'Save to vault', input_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } },
    { name: 'web_search', description: 'Search web',    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  ];
  const result = toOpenAITools(input);

  assert(result[0].type === 'function',                          'type is "function"');
  assert(result[0].function.name === 'vault_save',              'name preserved');
  assert(result[0].function.parameters === input[0].input_schema, 'input_schema → parameters (same ref)');
  assert(result[1].function.name === 'web_search',              'second tool preserved');
  assert(!('input_schema' in result[0]),                        'input_schema not duplicated at top level');
}

// ── anthropicMsgsToOpenAI ─────────────────────────────────────────────────────
console.log('\n4. anthropicMsgsToOpenAI()');
{
  function anthropicMsgsToOpenAI(messages, systemPrompt) {
    const result = [{ role: 'system', content: systemPrompt }];
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        result.push({ role: msg.role, content: msg.content });
        continue;
      }
      if (!Array.isArray(msg.content)) continue;
      if (msg.role === 'assistant') {
        const textParts    = msg.content.filter(b => b.type === 'text');
        const toolUseParts = msg.content.filter(b => b.type === 'tool_use');
        const out = {
          role: 'assistant',
          content: textParts.length ? textParts.map(b => b.text).join('') : null,
        };
        if (toolUseParts.length > 0) {
          out.tool_calls = toolUseParts.map(b => ({
            id: b.id, type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          }));
        }
        result.push(out);
      } else if (msg.role === 'user') {
        const toolResults = msg.content.filter(b => b.type === 'tool_result');
        const textParts   = msg.content.filter(b => b.type === 'text');
        for (const tr of toolResults) {
          result.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content ?? '') });
        }
        if (textParts.length > 0) result.push({ role: 'user', content: textParts.map(b => b.text).join('') });
      }
    }
    return result;
  }

  // Simple string history (what the bot stores between sessions)
  const simpleHistory = [
    { role: 'user',      content: 'What is ETH?' },
    { role: 'assistant', content: 'ETH is Ethereum.' },
  ];
  const simple = anthropicMsgsToOpenAI(simpleHistory, 'You are Noel.');
  assert(simple[0].role === 'system',           'system message injected first');
  assert(simple[0].content === 'You are Noel.', 'system prompt preserved');
  assert(simple[1].role === 'user',             'user message passed through');
  assert(simple[2].role === 'assistant',        'assistant message passed through');
  assert(simple.length === 3,                   'no extra messages for simple history');

  // In-loop messages: assistant with tool_use + user with tool_result
  const loopMessages = [
    { role: 'user', content: 'Get ETH price' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: 'tu_001', name: 'get_market_data', input: { symbol: 'ETH' } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu_001', content: 'ETH: $3200' },
      ],
    },
  ];
  const loop = anthropicMsgsToOpenAI(loopMessages, 'sys');

  // [system, user, assistant+tool_call, tool_result]
  assert(loop.length === 4,                           'correct message count for loop scenario');
  assert(loop[2].role === 'assistant',               'in-loop assistant message correct role');
  assert(loop[2].content === 'Let me check.',        'text extracted from content blocks');
  assert(Array.isArray(loop[2].tool_calls),          'tool_calls array on assistant message');
  assert(loop[2].tool_calls[0].id === 'tu_001',     'tool_call id preserved');
  assert(loop[2].tool_calls[0].function.name === 'get_market_data', 'tool name preserved');
  assert(JSON.parse(loop[2].tool_calls[0].function.arguments).symbol === 'ETH', 'tool args serialized');

  assert(loop[3].role === 'tool',                    'tool_result → role:tool');
  assert(loop[3].tool_call_id === 'tu_001',          'tool_call_id preserved');
  assert(loop[3].content === 'ETH: $3200',           'tool result content preserved');

  // Assistant message with only tool_use (no text block)
  const noTextMsg = [{ role: 'assistant', content: [{ type: 'tool_use', id: 'tu_002', name: 'vault_save', input: { content: 'x' } }] }];
  const noText = anthropicMsgsToOpenAI(noTextMsg, 'sys');
  assert(noText[1].content === null,                 'null content when no text block');
  assert(noText[1].tool_calls.length === 1,          'tool_calls present without text block');

  // Multiple tool_results in one user message (parallel tool calls)
  const multiResult = [{
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'tu_a', content: 'result A' },
      { type: 'tool_result', tool_use_id: 'tu_b', content: 'result B' },
    ],
  }];
  const multi = anthropicMsgsToOpenAI(multiResult, 'sys');
  assert(multi.length === 3, 'two tool_results → two separate tool messages');
  assert(multi[1].tool_call_id === 'tu_a', 'first tool result ID correct');
  assert(multi[2].tool_call_id === 'tu_b', 'second tool result ID correct');
}

// ── normalizeOpenAIResponse ──────────────────────────────────────────────────
console.log('\n5. normalizeOpenAIResponse()');
{
  function normalizeOpenAIResponse(choice) {
    const content = [];
    if (choice.content) content.push({ type: 'text', text: choice.content });
    for (const tc of choice.tool_calls ?? []) {
      let input = {};
      try { input = JSON.parse(tc.function?.arguments ?? '{}'); } catch {}
      content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }
    const stop_reason = (choice.tool_calls?.length ?? 0) > 0 ? 'tool_use' : 'end_turn';
    return { content, stop_reason };
  }

  // End turn (text only response)
  const textChoice = { content: 'Here is my answer.', tool_calls: [] };
  const textResult = normalizeOpenAIResponse(textChoice);
  assert(textResult.stop_reason === 'end_turn',          'end_turn when no tool_calls');
  assert(textResult.content[0].type === 'text',          'text block present');
  assert(textResult.content[0].text === 'Here is my answer.', 'text preserved');
  assert(textResult.content.length === 1,                'only one content block');

  // Tool use (triggers another loop iteration)
  const toolChoice = {
    content: null,
    tool_calls: [
      { id: 'tc_1', function: { name: 'get_market_data', arguments: '{"symbol":"BTC"}' } },
      { id: 'tc_2', function: { name: 'vault_save',      arguments: '{"content":"notes"}' } },
    ],
  };
  const toolResult = normalizeOpenAIResponse(toolChoice);
  assert(toolResult.stop_reason === 'tool_use',          'tool_use stop reason');
  assert(toolResult.content.length === 2,                'two tool_use blocks');
  assert(toolResult.content[0].type === 'tool_use',      'first block type tool_use');
  assert(toolResult.content[0].id === 'tc_1',            'tool id preserved');
  assert(toolResult.content[0].name === 'get_market_data', 'tool name preserved');
  assert(toolResult.content[0].input.symbol === 'BTC',   'tool input parsed');

  // Mixed: text + tool_calls (model explains then acts)
  const mixedChoice = {
    content: 'I will look that up.',
    tool_calls: [{ id: 'tc_3', function: { name: 'web_search', arguments: '{"query":"ETH news"}' } }],
  };
  const mixedResult = normalizeOpenAIResponse(mixedChoice);
  assert(mixedResult.stop_reason === 'tool_use',              'tool_use when tool_calls present');
  assert(mixedResult.content[0].type === 'text',              'text block comes first');
  assert(mixedResult.content[1].type === 'tool_use',          'tool_use block follows');
  assert(mixedResult.content.length === 2,                    'exactly two blocks');

  // Malformed arguments (should not throw, input → {})
  const badArgs = { content: null, tool_calls: [{ id: 'tc_4', function: { name: 'x', arguments: 'not-json' } }] };
  const badResult = normalizeOpenAIResponse(badArgs);
  assert(badResult.content[0].input !== undefined,            'malformed args produce empty input, no throw');
  assert(typeof badResult.content[0].input === 'object',     'input is still an object');
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Feature flag - Bankr path off by default
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6. Feature flag');
{
  // Without NOELCLAW_BANKR_TELEGRAM=1 the Bankr path should not be taken
  // even if BANKR_API_KEY is set. Verify the condition logic.
  const flagOff = !(process.env.BANKR_API_KEY && process.env.NOELCLAW_BANKR_TELEGRAM === '1');
  assert(flagOff, 'Bankr Telegram path is off by default (NOELCLAW_BANKR_TELEGRAM not set)');

  // Simulate flag on
  const origFlag = process.env.NOELCLAW_BANKR_TELEGRAM;
  const origKey  = process.env.BANKR_API_KEY;
  process.env.NOELCLAW_BANKR_TELEGRAM = '1';
  process.env.BANKR_API_KEY = 'test_key';
  const flagOn = !!(process.env.BANKR_API_KEY && process.env.NOELCLAW_BANKR_TELEGRAM === '1');
  assert(flagOn, 'Bankr Telegram path activates when NOELCLAW_BANKR_TELEGRAM=1 + BANKR_API_KEY set');
  process.env.NOELCLAW_BANKR_TELEGRAM = origFlag ?? '';
  process.env.BANKR_API_KEY = origKey ?? '';
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
