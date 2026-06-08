#!/usr/bin/env node
import * as readline from "readline";
import { runAgent } from "./agent-loop.js";
import { ALL_TOOLS } from "./server.js";
import { writeConfig, readConfig } from "./config.js";
import type { ChatMessage } from "./llm.js";

const CONVEX_SITE = process.env.NOELCLAW_CONVEX_URL ?? "https://api.noelclaw.com";

async function loginFlow(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>(resolve => rl.question(q, resolve));

  console.log(`\n  ${C.cyan}${C.bold}Sign in to Noelclaw${C.reset}\n`);

  const email = (await ask(`  Email: `)).trim();
  if (!email) { rl.close(); return; }

  process.stdout.write(`  Sending code to ${email}...`);
  const sendRes = await fetch(`${CONVEX_SITE}/auth/otp/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!sendRes.ok) {
    const e = await sendRes.json().catch(() => ({})) as any;
    console.log(`\n  ${C.red}✗${C.reset} ${e.error ?? "Failed to send code"}\n`);
    rl.close(); return;
  }
  console.log(` ${C.green}✓${C.reset}`);

  const code = (await ask(`  6-digit code: `)).trim();
  rl.close();

  process.stdout.write(`  Verifying...`);
  const verifyRes = await fetch(`${CONVEX_SITE}/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  const data = await verifyRes.json() as any;
  if (!verifyRes.ok || !data.token) {
    console.log(`\n  ${C.red}✗${C.reset} ${data.error ?? "Invalid code"}\n`);
    return;
  }

  writeConfig({ sessionToken: data.token, email });
  console.log(`  ${C.green}✓ Logged in as ${email}${C.reset}`);
  console.log(`  ${C.dim}Token saved to ~/.noelclaw/config.json — all 90 tools unlocked.${C.reset}\n`);
}

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
    /login     Sign in to unlock all 90 tools
    /logout    Sign out and clear saved token
    /clear     Clear conversation history
    /tools     List all available tools
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
  const mode = process.env.BANKR_API_KEY
    ? `${C.green}Bankr${C.reset} ${C.dim}(full tool use)${C.reset}`
    : process.env.ANTHROPIC_API_KEY
    ? `${C.green}Anthropic${C.reset} ${C.dim}(full tool use)${C.reset}`
    : `${C.green}Noelclaw${C.reset} ${C.dim}(full tool use · auto-wallet)${C.reset}`;

  console.log(`  ${C.dim}Mode:${C.reset} ${mode}`);

  const cfg = readConfig();
  if (cfg.email) {
    console.log(`  ${C.dim}Signed in as:${C.reset} ${C.green}${cfg.email}${C.reset} ${C.dim}· all tools unlocked${C.reset}\n`);
  } else {
    console.log(`  ${C.dim}Not signed in. Run${C.reset} ${C.cyan}/login${C.reset} ${C.dim}to unlock all 90 tools.${C.reset}\n`);
  }

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

    if (line === "/login") {
      rl.pause();
      await loginFlow();
      rl.resume();
      rl.prompt();
      return;
    }

    if (line === "/logout") {
      writeConfig({ sessionToken: undefined, email: undefined });
      console.log(`  ${C.dim}Logged out. Token cleared from ~/.noelclaw/config.json${C.reset}\n`);
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
