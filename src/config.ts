import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const CONFIG_DIR  = path.join(os.homedir(), ".noelclaw");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

interface NoelConfig {
  sessionToken?: string;
  email?: string;
}

export function readConfig(): NoelConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch {}
  return {};
}

export function writeConfig(patch: Partial<NoelConfig>): void {
  const current = readConfig();
  const updated  = { ...current, ...patch };
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), { mode: 0o600 });
}

export function getSavedToken(): string | undefined {
  // env var always wins over saved config
  return process.env.NOELCLAW_SESSION_TOKEN ?? readConfig().sessionToken;
}
