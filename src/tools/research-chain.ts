import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";
import { callLLM } from "../llm.js";
import { callConvex } from "../convex.js";

// ─── Tool schema ──────────────────────────────────────────────────────────────

export const RESEARCH_CHAIN_TOOLS: Tool[] = [
  {
    name: "research_chain",
    description:
      "Walk the temporal chain of a research topic and visualize how your " +
      "understanding evolved across time. Follows the `continues` relations " +
      "in your vault (built up by deep_research's continueFrom parameter) " +
      "both backward (older) and forward (newer) from a starting report. " +
      "Returns a chronological timeline with each report's date, title, and " +
      "TL;DR, plus an LLM-synthesized 'net evolution' summary that calls out " +
      "what changed at each step. " +
      "Use cases: review how your competitor analysis evolved over a quarter; " +
      "spot the moment your thesis on a market shifted; demonstrate research " +
      "compounding to a teammate. " +
      "This is what makes Noelclaw research different — the knowledge isn't " +
      "disposable, it's a timeline you can walk through.",
    inputSchema: {
      type: "object",
      properties: {
        startKey: {
          type: "string",
          description: "Vault key of any research entry in the chain. The tool walks both directions from there. Format: 'research/...'",
        },
        maxDepth: {
          type: "number",
          description: "Max number of entries to walk in each direction. Default 8 (so up to 17 entries including start). Capped at 20.",
        },
        synthesize: {
          type: "boolean",
          description: "Generate an LLM-synthesized 'net evolution' summary at the end. Adds ~30s. Default true.",
        },
      },
      required: ["startKey"],
    },
  },
];

const InputSchema = z.object({
  startKey: z.string().min(3).max(200),
  maxDepth: z.number().int().min(1).max(20).optional(),
  synthesize: z.boolean().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ChainEntry {
  key: string;
  title: string;
  updatedAt?: number;
  content: string;
  tldr: string;
}

async function loadEntry(key: string): Promise<ChainEntry | null> {
  try {
    const e = (await callConvex(
      `/vault/entry?key=${encodeURIComponent(key)}`,
      "GET",
      undefined,
      "vault_read",
    )) as { key?: string; title?: string; content?: string; updatedAt?: number } | null;
    if (!e?.content) return null;
    return {
      key: e.key ?? key,
      title: e.title ?? key,
      updatedAt: e.updatedAt,
      content: e.content,
      tldr: extractTLDR(e.content),
    };
  } catch {
    return null;
  }
}

function extractTLDR(content: string): string {
  // Look for "## TL;DR" / "## Summary" section.
  const m = content.match(/##\s*(TL;DR|Summary)[\s\S]*?(?=\n##|\n#|$)/i);
  if (m) {
    const body = m[0].replace(/^##.*$/m, "").trim();
    return body.split("\n\n")[0].trim().slice(0, 320);
  }
  // Fallback: first non-header paragraph
  const para = content
    .split("\n\n")
    .find((p) => p.trim() && !p.trim().startsWith("#") && !p.trim().startsWith("📁") && !p.trim().startsWith("🔬"));
  return (para ?? "").trim().slice(0, 320);
}

async function getLinkedKeys(key: string, relation: "continues" | "continued_by"): Promise<string[]> {
  // /vault/related returns linked entries via vault_related. Each result has
  // direction "outbound" (this -> other) or "inbound" (other -> this).
  // continues = outbound continues link → next-older report
  // continued_by = inbound continues link → next-newer report
  try {
    const result = (await callConvex(
      `/vault/related?key=${encodeURIComponent(key)}&relation=continues`,
      "GET",
      undefined,
      "vault_related",
    )) as { related?: Array<{ key: string; direction: string }> } | null;
    const wanted = relation === "continues" ? "outbound" : "inbound";
    return (result?.related ?? [])
      .filter((r) => r.direction === wanted)
      .map((r) => r.key);
  } catch {
    return [];
  }
}

async function walkChain(startKey: string, maxDepth: number): Promise<ChainEntry[]> {
  const startEntry = await loadEntry(startKey);
  if (!startEntry) return [];

  const visited = new Set<string>([startKey]);

  // Walk backward: follow outbound `continues` links (this report continues prior).
  const backward: ChainEntry[] = [];
  let backCursor: string = startKey;
  for (let i = 0; i < maxDepth; i++) {
    const linkedKeys: string[] = await getLinkedKeys(backCursor, "continues");
    const next: string | undefined = linkedKeys.find((k: string) => !visited.has(k));
    if (!next) break;
    visited.add(next);
    const entry = await loadEntry(next);
    if (!entry) break;
    backward.unshift(entry);  // oldest at front
    backCursor = next;
  }

  // Walk forward: follow inbound `continues` links (other reports continue this one).
  const forward: ChainEntry[] = [];
  let fwdCursor: string = startKey;
  for (let i = 0; i < maxDepth; i++) {
    const linkedKeys: string[] = await getLinkedKeys(fwdCursor, "continued_by");
    const next: string | undefined = linkedKeys.find((k: string) => !visited.has(k));
    if (!next) break;
    visited.add(next);
    const entry = await loadEntry(next);
    if (!entry) break;
    forward.push(entry);
    fwdCursor = next;
  }

  return [...backward, startEntry, ...forward];
}

async function synthesizeNetEvolution(chain: ChainEntry[]): Promise<string> {
  if (chain.length < 2) return "";

  const stops = chain.map((e, i) => {
    const date = e.updatedAt ? new Date(e.updatedAt).toISOString().slice(0, 10) : "unknown";
    return `[${i + 1}] (${date}) ${e.title}\nTL;DR: ${e.tldr.slice(0, 200)}`;
  }).join("\n\n");

  const sys = "You are a research analyst summarizing the evolution of a thesis across multiple research reports. Be concise, specific, and emphasize what CHANGED — not what stayed the same.";

  const user = `Below is a chronological chain of research reports on the same topic. Write a 4-6 sentence summary of how the user's understanding has evolved.

Specifically call out:
- Position shifts (claim X went from confident to weak, or vice versa)
- New entities/data points that appeared at specific stops
- Predictions that came true or were falsified
- The current state vs the starting state

DO NOT just list the reports. Synthesize the arc.

CHAIN (oldest to newest):

${stops}

Write the summary now. Plain prose, no markdown headers.`;

  try {
    return await callLLM(sys, user, 600, [], 60_000);
  } catch {
    return "";
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleResearchChain(name: string, args: unknown): Promise<ToolResult | null> {
  if (name !== "research_chain") return null;

  const parsed = InputSchema.safeParse(args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
  }

  const { startKey } = parsed.data;
  const maxDepth = parsed.data.maxDepth ?? 8;
  const synthesize = parsed.data.synthesize ?? true;

  const progress: string[] = [];
  const log = (line: string) => progress.push(line);

  log(`🔍 Loading start entry: \`${startKey}\``);
  log(`🧬 Walking continues chain (max ${maxDepth} steps each direction)...`);

  const chain = await walkChain(startKey, maxDepth);

  if (chain.length === 0) {
    return {
      content: [{
        type: "text",
        text: `Could not load \`${startKey}\` — check the vault key (use vault_list type:research) and make sure you're authenticated.`,
      }],
      isError: true,
    };
  }

  if (chain.length === 1) {
    return {
      content: [{
        type: "text",
        text:
          `🧬 **Research Chain** — \`${startKey}\` is a standalone report.\n\n` +
          `No \`continues\` links found in either direction. To start building a chain, ` +
          `run \`deep_research\` again on the same topic with \`continueFrom="${startKey}"\` — ` +
          `that creates the temporal link.\n\n` +
          `Once you have 2+ continuations, this tool will walk and synthesize the evolution.`,
      }],
    };
  }

  log(`✅ Loaded ${chain.length} entries in chain.`);

  // Render the timeline
  const timelineLines: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    const date = e.updatedAt ? new Date(e.updatedAt).toISOString().slice(0, 10) : "—";
    const marker = e.key === startKey ? " ← you are here" : "";
    timelineLines.push(`### [${i + 1}/${chain.length}] ${date}${marker}`);
    timelineLines.push(`**${e.title}**`);
    timelineLines.push(`\`${e.key}\``);
    timelineLines.push("");
    timelineLines.push(e.tldr);
    timelineLines.push("");
    if (i < chain.length - 1) {
      timelineLines.push("⬇ *continues into*");
      timelineLines.push("");
    }
  }

  // Optional LLM synthesis
  let netEvolution = "";
  if (synthesize && chain.length >= 2) {
    log(`✍️  Synthesizing net evolution across ${chain.length} stops...`);
    netEvolution = await synthesizeNetEvolution(chain);
  }

  const header = [
    `🧬 **Research Chain** — ${chain.length} reports across the timeline`,
    `📍 You are at: \`${startKey}\``,
    chain[0].updatedAt && chain[chain.length - 1].updatedAt
      ? `🗓 Spans ${new Date(chain[0].updatedAt!).toISOString().slice(0, 10)} → ${new Date(chain[chain.length - 1].updatedAt!).toISOString().slice(0, 10)}`
      : "",
    ``,
    `<details><summary>📋 Process log</summary>`,
    ``,
    progress.map((p) => `- ${p}`).join("\n"),
    ``,
    `</details>`,
    ``,
  ].filter(Boolean).join("\n");

  const evolutionBlock = netEvolution
    ? `\n## 🌱 Net Evolution\n\n${netEvolution.trim()}\n`
    : "";

  const text = [
    header,
    `## Timeline`,
    ``,
    timelineLines.join("\n"),
    evolutionBlock,
  ].join("\n");

  return { content: [{ type: "text", text }] };
}
