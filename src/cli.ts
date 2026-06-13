#!/usr/bin/env node
import * as readline from "readline";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runAgent } from "./agent-loop.js";
import { ALL_TOOLS } from "./server.js";
import { writeConfig, readConfig } from "./config.js";
import type { ChatMessage } from "./llm.js";

const CONVEX_SITE = process.env.NOELCLAW_CONVEX_URL ?? "https://api.noelclaw.com";

async function loginWithOtp(rl: readline.Interface): Promise<void> {
  const ask = (q: string) => new Promise<string>(resolve => rl.question(q, resolve));

  const email = (await ask(`  Email: `)).trim();
  if (!email) return;

  process.stdout.write(`  Sending code to ${email}...`);
  const sendRes = await fetch(`${CONVEX_SITE}/auth/otp/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!sendRes.ok) {
    const e = await sendRes.json().catch(() => ({})) as any;
    console.log(`\n  ${C.red}✗${C.reset} ${(e as any).error ?? "Failed to send code"}\n`);
    return;
  }
  console.log(` ${C.green}✓${C.reset}`);

  const code = (await ask(`  6-digit code: `)).trim();

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
  console.log(`  ${C.dim}Token saved to ~/.noelclaw/config.json — all 102 tools unlocked.${C.reset}\n`);
}

async function loginWithApiKey(rl: readline.Interface): Promise<void> {
  const ask = (q: string) => new Promise<string>(resolve => rl.question(q, resolve));

  console.log(`  ${C.dim}Generate an API key at app.noelclaw.com → Settings → API Keys${C.reset}`);
  const apiKey = (await ask(`  API key (noel_sk_...): `)).trim();
  if (!apiKey) return;

  process.stdout.write(`  Authenticating...`);
  const res = await fetch(`${CONVEX_SITE}/auth/apikey/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  const data = await res.json() as any;
  if (!res.ok || !data.token) {
    console.log(`\n  ${C.red}✗${C.reset} ${data.error ?? "Invalid API key"}\n`);
    return;
  }

  writeConfig({ sessionToken: data.token, email: data.email ?? "api-key-user" });
  console.log(`  ${C.green}✓ Authenticated${data.email ? ` as ${data.email}` : ""}${C.reset}`);
  console.log(`  ${C.dim}Token saved to ~/.noelclaw/config.json — all 102 tools unlocked.${C.reset}\n`);
}

async function loginFlow(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>(resolve => rl.question(q, resolve));

  console.log(`\n  ${C.cyan}${C.bold}Sign in to Noelclaw${C.reset}\n`);
  console.log(`  ${C.dim}[1] Email (OTP code sent to your email)${C.reset}`);
  console.log(`  ${C.dim}[2] API key (from app.noelclaw.com → Settings)${C.reset}\n`);

  const choice = (await ask(`  Choose [1/2]: `)).trim();

  if (choice === "2") {
    await loginWithApiKey(rl);
  } else {
    await loginWithOtp(rl);
  }

  rl.close();
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
  white:  "\x1b[97m",
  bg:     "\x1b[48;5;17m",
};

const BANNER = `
${C.cyan}${C.bold}  ███╗   ██╗ ██████╗ ███████╗██╗      ██████╗██╗      █████╗ ██╗    ██╗${C.reset}
${C.cyan}${C.bold}  ████╗  ██║██╔═══██╗██╔════╝██║     ██╔════╝██║     ██╔══██╗██║    ██║${C.reset}
${C.cyan}${C.bold}  ██╔██╗ ██║██║   ██║█████╗  ██║     ██║     ██║     ███████║██║ █╗ ██║${C.reset}
${C.cyan}${C.bold}  ██║╚██╗██║██║   ██║██╔══╝  ██║     ██║     ██║     ██╔══██║██║███╗██║${C.reset}
${C.cyan}${C.bold}  ██║ ╚████║╚██████╔╝███████╗███████╗╚██████╗███████╗██║  ██║╚███╔███╔╝${C.reset}
${C.cyan}${C.bold}  ╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚══════╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝${C.reset}

  ${C.dim}v3.16.4  ·  102 tools  ·  persistent AI OS  ·  noelclaw.com${C.reset}
  ${C.dim}────────────────────────────────────────────────────────────${C.reset}
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
    /login     Sign in to unlock all tools
    /logout    Sign out and clear saved token
    /clear     Clear conversation history
    /tools     List all available tools
    /quit      Exit

  ${C.dim}Examples:
    remember that I prefer concise answers
    search the web for recent AI news
    save a note to my vault
    research "top AI agent frameworks in 2025"
    send me a weekly digest every Monday${C.reset}
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
    console.log(`  ${C.dim}Not signed in. Run${C.reset} ${C.cyan}/login${C.reset} ${C.dim}to unlock all 102 tools.${C.reset}\n`);
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

// ── Install command ───────────────────────────────────────────────────────────
interface McpClient {
  name: string;
  configPath: string;
  // Which JSON key holds the servers map
  serversKey: "mcpServers";
}

function resolveClients(): McpClient[] {
  const home    = os.homedir();
  const plat    = os.platform();
  const appdata = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");

  const defs: { name: string; paths: Record<string, string> }[] = [
    {
      name: "Claude Desktop",
      paths: {
        darwin: path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
        win32:  path.join(appdata, "Claude", "claude_desktop_config.json"),
        linux:  path.join(home, ".config", "Claude", "claude_desktop_config.json"),
      },
    },
    {
      name: "Cursor",
      paths: {
        darwin: path.join(home, ".cursor", "mcp.json"),
        win32:  path.join(home, ".cursor", "mcp.json"),
        linux:  path.join(home, ".cursor", "mcp.json"),
      },
    },
    {
      name: "Windsurf",
      paths: {
        darwin: path.join(home, ".windsurf", "mcp.json"),
        win32:  path.join(home, ".windsurf", "mcp.json"),
        linux:  path.join(home, ".windsurf", "mcp.json"),
      },
    },
    {
      name: "VS Code",
      paths: {
        darwin: path.join(home, "Library", "Application Support", "Code", "User", "mcp.json"),
        win32:  path.join(appdata, "Code", "User", "mcp.json"),
        linux:  path.join(home, ".config", "Code", "User", "mcp.json"),
      },
    },
    {
      name: "VS Code Insiders",
      paths: {
        darwin: path.join(home, "Library", "Application Support", "Code - Insiders", "User", "mcp.json"),
        win32:  path.join(appdata, "Code - Insiders", "User", "mcp.json"),
        linux:  path.join(home, ".config", "Code - Insiders", "User", "mcp.json"),
      },
    },
    {
      name: "Zed",
      paths: {
        darwin: path.join(home, ".config", "zed", "mcp.json"),
        win32:  path.join(home, ".config", "zed", "mcp.json"),
        linux:  path.join(home, ".config", "zed", "mcp.json"),
      },
    },
  ];

  return defs
    .map((d) => {
      const configPath = d.paths[plat] ?? d.paths.linux;
      return { name: d.name, configPath, serversKey: "mcpServers" as const };
    })
    .filter((c) => {
      // Include if the config file exists OR the parent directory exists (app installed but not yet configured)
      return fs.existsSync(c.configPath) || fs.existsSync(path.dirname(c.configPath));
    });
}

const NOELCLAW_ENTRY = {
  command: "npx",
  args: ["-y", "@noelclaw/mcp"],
  env: {} as Record<string, string>,
};

function installIntoConfig(configPath: string): "added" | "updated" | "error" {
  try {
    let json: any = {};

    if (fs.existsSync(configPath)) {
      try { json = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch { json = {}; }
    } else {
      // Ensure parent dir exists
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
    }

    if (!json.mcpServers) json.mcpServers = {};
    const existed = !!json.mcpServers.noelclaw;
    json.mcpServers.noelclaw = NOELCLAW_ENTRY;

    fs.writeFileSync(configPath, JSON.stringify(json, null, 2), "utf8");
    return existed ? "updated" : "added";
  } catch {
    return "error";
  }
}

async function installFlow(): Promise<void> {
  console.log(`\n  ${C.cyan}${C.bold}noelclaw install${C.reset}\n`);
  console.log(`  ${C.dim}Scanning for MCP-compatible apps...${C.reset}\n`);

  const clients = resolveClients();

  if (clients.length === 0) {
    console.log(`  ${C.yellow}No MCP-compatible apps found.${C.reset}`);
    console.log(`  ${C.dim}Install Claude Desktop, Cursor, or Windsurf, then run this again.${C.reset}\n`);
    console.log(`  ${C.dim}Or add manually to your app's MCP config:${C.reset}`);
    console.log(`  ${C.dim}  "noelclaw": { "command": "npx", "args": ["-y", "@noelclaw/mcp"] }${C.reset}\n`);
    return;
  }

  let installed = 0;
  const toRestart: string[] = [];

  for (const client of clients) {
    const result = installIntoConfig(client.configPath);
    const short  = client.configPath.replace(os.homedir(), "~");

    if (result === "added") {
      console.log(`  ${C.green}✓${C.reset}  ${C.bold}${client.name}${C.reset}  ${C.dim}→ added${C.reset}`);
      console.log(`     ${C.dim}${short}${C.reset}`);
      installed++;
      toRestart.push(client.name);
    } else if (result === "updated") {
      console.log(`  ${C.green}↑${C.reset}  ${C.bold}${client.name}${C.reset}  ${C.dim}→ updated to latest${C.reset}`);
      console.log(`     ${C.dim}${short}${C.reset}`);
      installed++;
      toRestart.push(client.name);
    } else {
      console.log(`  ${C.yellow}✗${C.reset}  ${C.bold}${client.name}${C.reset}  ${C.dim}→ write failed (check permissions)${C.reset}`);
    }
  }

  console.log(`\n  ${C.dim}${"─".repeat(52)}${C.reset}\n`);

  if (installed === 0) {
    console.log(`  ${C.yellow}Nothing was installed. Check file permissions.${C.reset}\n`);
    return;
  }

  console.log(`  ${C.green}${C.bold}✓ Noelclaw installed in ${installed} app${installed === 1 ? "" : "s"}.${C.reset}\n`);

  if (toRestart.length > 0) {
    console.log(`  ${C.dim}Restart to activate:  ${toRestart.join("  ·  ")}${C.reset}`);
  }

  const cfg = readConfig();
  if (!cfg.sessionToken) {
    console.log(`\n  ${C.dim}Next step — sign in to unlock all tools:${C.reset}`);
    console.log(`  ${C.cyan}  noelclaw login${C.reset}\n`);
  } else {
    console.log(`\n  ${C.dim}Already signed in as ${cfg.email ?? "user"}.${C.reset}`);
    console.log(`  ${C.dim}Open your MCP client and start using Noelclaw.${C.reset}\n`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
const cmd = process.argv[2];

if (cmd === "install") {
  installFlow().catch((err) => {
    console.error(`  ${C.red}✗ install error: ${err.message}${C.reset}`);
    process.exit(1);
  });
} else if (cmd === "login") {
  loginFlow().catch((err) => {
    console.error(`  ${C.red}✗ login error: ${err.message}${C.reset}`);
    process.exit(1);
  });
} else if (cmd === "help" || cmd === "--help" || cmd === "-h") {
  console.log(`
  ${C.cyan}${C.bold}noelclaw${C.reset}  ${C.dim}AI OS for your terminal${C.reset}

  ${C.cyan}Commands:${C.reset}
    noelclaw              Start interactive AI terminal
    noelclaw install      Auto-configure all detected MCP clients
    noelclaw login        Sign in to unlock all tools
    noelclaw help         Show this help

  ${C.dim}Claude Desktop / Cursor / Windsurf / VS Code are all supported.${C.reset}
`);
} else {
  main().catch(err => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
