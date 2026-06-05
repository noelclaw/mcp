#!/usr/bin/env node
import * as readline from "readline";
import { runAgent } from "./agent-loop.js";
import { ALL_TOOLS } from "./server.js";
import type { ChatMessage } from "./llm.js";

// ── ANSI ─────────────────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  cyan:   "\x1b[36m",
  violet: "\x1b[35m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
};

const BANNER = `
${C.cyan}${C.bold}  NOELCLAW${C.reset}  ${C.dim}v3.2.0 · 76 tools · persistent AI${C.reset}
  ${C.dim}─────────────────────────────────────────${C.reset}
  ${C.dim}Type anything. /help for commands. Ctrl+C to exit.${C.reset}
`;

// ── Spinner ───────────────────────────────────────────────────────────────────
function spinner(label: string): () => void {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const iv = setInterval(() => {
    process.stdout.write(`\r  ${C.dim}${frames[i % frames.length]} ${label}${C.reset}  `);
    i++;
  }, 80);
  return () => {
    clearInterval(iv);
    process.stdout.write("\r" + " ".repeat(label.length + 12) + "\r");
  };
}

// ── Help ─────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
  ${C.cyan}Commands:${C.reset}
    /clear     Clear conversation history
    /tools     List all 74 available tools
    /quit      Exit

  ${C.dim}Examples:
    remember my coding style for next time
    what's ETH doing right now?
    swap 0.5 ETH to USDC on Base
    send me a weekly digest every Monday
    research "best DeFi yields on Base"${C.reset}
`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  process.stdout.write(BANNER);

  // Detect active LLM
  const mode = process.env.ANTHROPIC_API_KEY
    ? `${C.green}Anthropic${C.reset} ${C.dim}(full tool use)${C.reset}`
    : process.env.BANKR_API_KEY
    ? `${C.green}Bankr${C.reset} ${C.dim}(full tool use)${C.reset}`
    : `${C.green}Noelclaw${C.reset} ${C.dim}(full tool use · auto-wallet)${C.reset}`;

  console.log(`  ${C.dim}Mode:${C.reset} ${mode}\n`);

  const history: ChatMessage[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${C.green}>${C.reset} `,
  });

  rl.prompt();

  rl.on("line", async (raw) => {
    const line = raw.trim();
    if (!line) { rl.prompt(); return; }

    // Built-in commands
    if (line === "/quit" || line === "/exit") {
      console.log(`\n  ${C.dim}Goodbye.${C.reset}\n`);
      process.exit(0);
    }

    if (line === "/clear") {
      history.length = 0;
      console.log(`  ${C.dim}History cleared.${C.reset}\n`);
      rl.prompt();
      return;
    }

    if (line === "/help") {
      printHelp();
      rl.prompt();
      return;
    }

    if (line === "/tools") {
      console.log(`\n  ${C.cyan}${ALL_TOOLS.length} tools:${C.reset}`);
      for (const t of ALL_TOOLS) {
        console.log(`  ${C.dim}·${C.reset} ${t.name}  ${C.dim}${(t.description as string ?? "").slice(0, 60)}${C.reset}`);
      }
      console.log();
      rl.prompt();
      return;
    }

    // Agent call
    const stop = spinner("thinking");
    let toolsUsed = 0;

    try {
      const result = await runAgent(line, history, (toolName) => {
        stop();
        toolsUsed++;
        process.stdout.write(`  ${C.dim}✦ ${toolName}${C.reset}\n`);
      });

      stop();

      // Update conversation history (keep last 20 turns)
      history.push({ role: "user", content: line });
      history.push({ role: "assistant", content: result.text });
      while (history.length > 20) history.splice(0, 2);

      // Output
      console.log();
      const lines = result.text.split("\n");
      for (const l of lines) {
        console.log(`  ${l}`);
      }
      console.log();
    } catch (err: any) {
      stop();
      console.log(`\n  ${C.red}✗${C.reset} ${err.message}\n`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log(`\n  ${C.dim}Goodbye.${C.reset}\n`);
    process.exit(0);
  });
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
