import { Tool } from "@modelcontextprotocol/sdk/types.js";

// Tool-subset filter. Each user keeps the full handler map (so any tool
// can still be invoked by name if explicitly referenced), but the LIST
// response sent to MCP clients is trimmed based on NOELCLAW_TOOLS.
//
// Default = "core" - runtime essentials only (memory, vault, agents,
// chronicle, status). Opt-in presets let token-conscious users cut LLM
// context cost while keeping the full surface accessible by name:
//
//   NOELCLAW_TOOLS=core         runtime essentials (memory, vault, agents)
//   NOELCLAW_TOOLS=defi         Base + market + DeFi execution
//   NOELCLAW_TOOLS=research     research + memory + vault
//   NOELCLAW_TOOLS=memory       memory + vault + agents only
//   NOELCLAW_TOOLS=memory,defi  comma-separated combination
//   NOELCLAW_TOOLS=all          every registered tool
//
// Unknown presets fall back to all to avoid silently hiding tools.

const PRESETS: Record<string, RegExp> = {
  core: /^(memory_|vault_|agent_|list_agents|hire_agent|ask_noel|noel_status|get_wallet_address|chronicle_)/,
  defi: /^(get_market_data|get_token_data|compare_tokens|market_overview|token_history|market_thesis|trade_plan|base_mcp_|base_|get_defi_yields|score_token|check_token|scan_market|analyze_wallet)/,
  research: /^(memory_|vault_|deep_research|research_compare|research_chain|web_search|web_scrape|schedule_research|create_monitor|list_monitors|cancel_monitor|ask_noel)/,
  memory: /^(memory_|vault_|agent_|list_agents|hire_agent|chronicle_)/,
  coder: /^(generate_contract|audit_contract|explain_code|review_code|generate_mcp_skill|github_)/,
  social: /^(humanize_text|write_content)/,
};

export function filterTools(allTools: Tool[]): Tool[] {
  // Default is "core" - keeps LLM context cost low while everything
  // is still callable by name. Power users opt back in via
  // NOELCLAW_TOOLS=all. Explicit empty env still means "all" for back-compat.
  const raw = (process.env.NOELCLAW_TOOLS ?? "core").trim().toLowerCase();
  const env = raw === "" ? "core" : raw;
  if (env === "all") return allTools;

  const presetKeys = env.split(",").map((s) => s.trim()).filter(Boolean);
  const patterns = presetKeys
    .map((k) => PRESETS[k])
    .filter((p): p is RegExp => !!p);

  if (patterns.length === 0) {
    // Unknown preset(s) - surface full tool set rather than silently hide.
    return allTools;
  }

  return allTools.filter((t) => patterns.some((p) => p.test(t.name)));
}
