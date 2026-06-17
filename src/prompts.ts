// MCP Prompts surface for noelclaw.
//
// Exposes a small curated set of high-leverage workflows as MCP Prompts so
// they appear as slash commands / quick actions in clients that support it
// (Claude Desktop, Cursor, Windsurf, Zed). Each Prompt is a parameterized
// template that resolves to a single message guiding the LLM to call the
// right tool chain - they don't run the tools themselves.
//
// Kept intentionally small. Prompts are discoverable in the UI, so quality
// matters more than count. If users routinely need a workflow we don't
// have here, that's a signal to add it - not to dump 30 templates.

type PromptArg = {
  name: string;
  description: string;
  required?: boolean;
};

type PromptDef = {
  name: string;
  description: string;
  arguments?: PromptArg[];
  build: (args: Record<string, string>) => string;
};

const PROMPTS: PromptDef[] = [
  {
    name: "crypto-thesis",
    description: "Generate a bull/bear thesis for a crypto asset with verified live price (CoinGecko + DexScreener).",
    arguments: [
      { name: "token", description: "Token symbol (e.g. BTC, ETH, SOL)", required: true },
      { name: "context", description: "Optional additional context - your stance, timeframe, watching for catalysts", required: false },
    ],
    build: ({ token, context }) =>
      `Call the \`market_thesis\` tool for token=${token}${context ? ` with context="${context}"` : ""}. ` +
      `If the tool returns an error about live price unavailability, do NOT improvise a thesis from training data - report the error verbatim and suggest the user retry in 30s.`,
  },
  {
    name: "trade-plan",
    description: "Build a structured trade plan (entry, stop loss, take profit) with verified live price.",
    arguments: [
      { name: "token", description: "Token symbol", required: true },
      { name: "side", description: "long or short (default: long)", required: false },
      { name: "risk", description: "conservative | moderate | aggressive (default: moderate)", required: false },
    ],
    build: ({ token, side, risk }) =>
      `Call the \`trade_plan\` tool with token=${token}` +
      `${side ? `, side=${side}` : ""}` +
      `${risk ? `, riskTolerance=${risk}` : ""}. ` +
      `Show the tool output verbatim including the verified-price source line. ` +
      `If the tool refuses for missing live data, do NOT fabricate entry/SL/TP from memory.`,
  },
  {
    name: "deep-research",
    description: "Kick off multi-stage deep research with date anchoring and live enrichment. Saves report to vault.",
    arguments: [
      { name: "topic", description: "Research topic - be specific (e.g. 'Aerodrome TVL trend Q2 2026', not 'Aerodrome')", required: true },
    ],
    build: ({ topic }) =>
      `Call the \`deep_research\` tool with topic="${topic}". ` +
      `This runs ~30-60s in the background. The result lands in vault as a research entry - surface the tool's text output to the user including any citations and the vault key for follow-up.`,
  },
  {
    name: "daily-brief",
    description: "Morning market brief: key prices, trending tokens, your prior vault context.",
    arguments: [],
    build: () =>
      `1. Call \`get_market_data\` with no token to get the overall market overview (BTC/ETH/SOL + top 20 + trending).\n` +
      `2. Call \`memory_context\` with topic="market preferences" to surface the user's saved DeFi / trading preferences.\n` +
      `3. Call \`vault_search\` with query="market" limit=3 to find recent thesis/research entries.\n` +
      `4. Synthesize into a 3-section brief: (a) Market state, (b) Watchlist movers, (c) Aligned with user's prior notes.\n` +
      `Keep total under 250 words. End with one specific question the user might want to act on today.`,
  },
  {
    name: "vault-recall",
    description: "Semantic search across the vault - works at paragraph level for large entries (blob chunking).",
    arguments: [
      { name: "query", description: "What you're looking for (natural language)", required: true },
      { name: "type", description: "Optional filter: research | execution | workflow | prompt | file | memory", required: false },
    ],
    build: ({ query, type }) =>
      `Call \`vault_search\` with query="${query}"${type ? `, type=${type}` : ""}. ` +
      `Show the top 5 results with their keys and best-matching previews. ` +
      `If results include chunk hits inside large entries, the count badge will indicate (N chunk hits) - surface that to the user.`,
  },
  {
    name: "spawn-tracker",
    description: "Spawn a persistent agent to track an ongoing topic across sessions.",
    arguments: [
      { name: "name", description: "Agent name (will become its vault key)", required: true },
      { name: "goal", description: "What the agent is tracking - be specific", required: true },
    ],
    build: ({ name, goal }) =>
      `Call \`agent_spawn\` with name="${name}", goal="${goal}". ` +
      `Confirm the agent's vault key with the user. ` +
      `Suggest they can update progress later with \`agent_update name=${name} progress="..."\` or read the latest state with \`agent_recall name=${name}\`.`,
  },
];

export function listPrompts(): Array<{
  name: string;
  description: string;
  arguments?: PromptArg[];
}> {
  return PROMPTS.map(({ build: _build, ...meta }) => meta);
}

export function getPrompt(
  name: string,
  args: Record<string, string>,
): { description: string; messages: Array<{ role: "user"; content: { type: "text"; text: string } }> } {
  const prompt = PROMPTS.find((p) => p.name === name);
  if (!prompt) {
    throw new Error(`Unknown prompt: ${name}`);
  }

  // Validate required args - return a hint instead of throwing so the UI
  // surfaces a friendly error.
  for (const arg of prompt.arguments ?? []) {
    if (arg.required && !(arg.name in args)) {
      return {
        description: prompt.description,
        messages: [{
          role: "user",
          content: { type: "text", text: `Missing required argument: ${arg.name}. ${arg.description}` },
        }],
      };
    }
  }

  return {
    description: prompt.description,
    messages: [{
      role: "user",
      content: { type: "text", text: prompt.build(args) },
    }],
  };
}
