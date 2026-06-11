import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";
import { callLLM } from "../llm.js";
import { callConvex } from "../convex.js";

// ─── Tool schema ──────────────────────────────────────────────────────────────

export const RESEARCH_COMPARE_TOOLS: Tool[] = [
  {
    name: "research_compare",
    description:
      "Compare two research reports from your vault and generate a structured diff " +
      "showing what changed: new findings, updated positions, weakened claims, and " +
      "the net direction. Auto-saves the comparison to vault as type:research and " +
      "auto-links to both source reports. " +
      "Use cases: see how your understanding of a market/company/topic evolved over " +
      "time, compare your research against a publicly available report, diff a " +
      "deep_research run before/after a major event (earnings, launch, news). " +
      "This is what 'cumulative research' looks like in practice — your knowledge " +
      "base doesn't just grow, it gets queryable across time. " +
      "Cost: 1 LLM call + 2 vault reads. Takes 30-60s.",
    inputSchema: {
      type: "object",
      properties: {
        keyA: {
          type: "string",
          description: "Vault key of the FIRST (older / baseline) report. Format: 'research/...' — use vault_list type:research to find candidates.",
        },
        keyB: {
          type: "string",
          description: "Vault key of the SECOND (newer / current) report to compare against keyA.",
        },
        focus: {
          type: "string",
          description: "Optional aspect to focus the comparison on: 'numbers', 'sentiment', 'sources', 'predictions', 'consensus'. Default: all.",
        },
        saveToVault: { type: "boolean", description: "Auto-save comparison to vault (default true)" },
      },
      required: ["keyA", "keyB"],
    },
  },
];

const InputSchema = z.object({
  keyA: z.string().min(3).max(200),
  keyB: z.string().min(3).max(200),
  focus: z.string().max(80).optional(),
  saveToVault: z.boolean().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadVaultEntry(key: string): Promise<{ key: string; title: string; content: string; updatedAt?: number } | null> {
  try {
    const entry = await callConvex(
      `/vault/entry?key=${encodeURIComponent(key)}`,
      "GET",
      undefined,
      "vault_read",
    ) as { key?: string; title?: string; content?: string; updatedAt?: number } | null;
    if (!entry?.content) return null;
    return {
      key: entry.key ?? key,
      title: entry.title ?? key,
      content: entry.content,
      updatedAt: entry.updatedAt,
    };
  } catch {
    return null;
  }
}

function slugifyKey(key: string): string {
  return key.replace(/^research\//, "").replace(/[^a-z0-9\-]/gi, "-").slice(0, 50);
}

// ─── Synthesis prompt ─────────────────────────────────────────────────────────

async function synthesizeComparison(
  a: { key: string; title: string; content: string; updatedAt?: number },
  b: { key: string; title: string; content: string; updatedAt?: number },
  focus?: string,
): Promise<string> {
  const dateA = a.updatedAt ? new Date(a.updatedAt).toISOString().slice(0, 10) : "earlier";
  const dateB = b.updatedAt ? new Date(b.updatedAt).toISOString().slice(0, 10) : "later";
  const focusNote = focus
    ? `\n\nFOCUS THE COMPARISON ON: ${focus}. Down-weight other aspects.`
    : "";

  const sys = `You are a senior analyst writing a structured comparison report between two research documents. The user wants to see what changed in their understanding — not a side-by-side rehash of both reports.

OUTPUT FORMAT (strict Markdown sections, in this order):

# {topic} — Evolution from {dateA} to {dateB}

## TL;DR
2-3 sentences capturing what changed. Lead with the most important shift. No filler.

## Net Direction
One-line assessment: **STRENGTHENED** / **WEAKENED** / **PIVOTED** / **REFINED** — then 1-2 sentences explaining why.

## At a Glance
A Markdown table with these EXACT columns:
| Dimension | ${dateA} (A) | ${dateB} (B) | Change |
|---|---|---|---|

Fill 5-8 rows with the most important quantitative or qualitative shifts. Use ↑/↓/→/⚡/❓ symbols in the Change column.

## 🆕 New in B (not in A)
- 3-6 bullets — findings, entities, data points, or angles that appear in B but were absent from A.

## 🔄 Updated (changed since A)
- 3-6 bullets — claims that exist in both reports but with different positions, numbers, sentiment, or confidence.
- Format: "{Claim}: was {A's position}, now {B's position}"

## ⚠️ Weakened or Removed
- 2-4 bullets — claims from A that B no longer makes, contradicts, or has lower confidence on.
- These are the "what we got wrong" or "what the data revised" moments. Don't skip — flagging weakened claims is honest reporting.

## Confidence Shift
Brief paragraph: did the overall confidence go up or down? Are the sources stronger now? Are the predictions more grounded?

## What to Watch Next
3-4 forward-looking questions that emerged from this comparison — things to revisit in the next iteration.

RULES:
- Be specific. Quote actual numbers/names from both reports when relevant.
- No hedging filler ("it is important to note", "in conclusion").
- If B is clearly better-sourced or more current, say so. If A was actually right, say so.
- Don't manufacture differences where there aren't any — if a dimension is unchanged, note that briefly and move on.
- Don't write a Sources section — that gets appended automatically.${focusNote}`;

  const user = `REPORT A (${dateA}) — vault key: \`${a.key}\` — title: ${a.title}

\`\`\`
${a.content.slice(0, 6000)}
\`\`\`

REPORT B (${dateB}) — vault key: \`${b.key}\` — title: ${b.title}

\`\`\`
${b.content.slice(0, 6000)}
\`\`\`

Write the comparison now. Markdown only — no preamble, no postamble.`;

  return await callLLM(sys, user, 3500, [], 90_000);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleResearchCompare(name: string, args: unknown): Promise<ToolResult | null> {
  if (name !== "research_compare") return null;

  const parsed = InputSchema.safeParse(args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
  }

  const { keyA, keyB, focus } = parsed.data;
  const saveToVault = parsed.data.saveToVault ?? true;

  if (keyA === keyB) {
    return { content: [{ type: "text", text: "keyA and keyB are the same — comparison needs two different reports." }], isError: true };
  }

  // Load both reports in parallel
  const progress: string[] = [];
  const log = (line: string) => progress.push(line);

  log(`📂 Loading report A: \`${keyA}\``);
  log(`📂 Loading report B: \`${keyB}\``);
  const [reportA, reportB] = await Promise.all([loadVaultEntry(keyA), loadVaultEntry(keyB)]);

  if (!reportA) {
    return { content: [{ type: "text", text: `Could not load report A (\`${keyA}\`). Check the vault key is correct and you're authenticated. Use vault_list type:research to find candidates.` }], isError: true };
  }
  if (!reportB) {
    return { content: [{ type: "text", text: `Could not load report B (\`${keyB}\`). Check the vault key is correct.` }], isError: true };
  }

  log(`✅ Loaded A (${reportA.content.length} chars) and B (${reportB.content.length} chars).`);

  // Synthesize comparison
  log(`🔍 Synthesizing structured comparison${focus ? ` (focus: ${focus})` : ""}...`);
  let comparison: string;
  try {
    comparison = await synthesizeComparison(reportA, reportB, focus);
  } catch (err: any) {
    return { content: [{ type: "text", text: `Comparison synthesis failed: ${err.message ?? err}` }], isError: true };
  }

  // Save to vault
  let compareKey: string | null = null;
  if (saveToVault) {
    try {
      const titleA = reportA.title.replace(/^Deep Research(?:\s*\(cont\.\))?:\s*/i, "").slice(0, 30);
      const titleB = reportB.title.replace(/^Deep Research(?:\s*\(cont\.\))?:\s*/i, "").slice(0, 30);
      const r = (await callConvex("/vault/save", "POST", {
        type: "research",
        title: `Compare: ${titleA} vs ${titleB}`,
        content: comparison,
        tags: ["research-compare", "comparison", ...(focus ? [`focus:${focus}`] : [])],
        agentId: "research",
        commitMsg: `compare ${slugifyKey(keyA)} vs ${slugifyKey(keyB)}`,
      }, "vault_save")) as { key?: string } | null;
      compareKey = r?.key ?? null;
      log(`💾 Saved comparison to vault: \`${compareKey}\``);
    } catch {
      log(`⚠️ Vault save skipped (not authenticated).`);
    }
  }

  // Auto-link to both source reports
  if (compareKey) {
    for (const target of [keyA, keyB]) {
      try {
        await callConvex("/vault/link", "POST", {
          fromKey: compareKey,
          toKey: target,
          relation: "references",
        }, "vault_link");
      } catch { /* silent */ }
    }
    log(`🔗 Linked comparison → ${keyA} (references)`);
    log(`🔗 Linked comparison → ${keyB} (references)`);
  }

  const header = [
    `📊 **Research Compare** — \`${reportA.key}\` ⇄ \`${reportB.key}\``,
    compareKey ? `💾 Saved to vault: \`${compareKey}\`` : "",
    `🧬 Demonstrates cumulative research — your knowledge base is now queryable across time.`,
    ``,
    `<details><summary>📋 Process log</summary>`,
    ``,
    progress.map((p) => `- ${p}`).join("\n"),
    ``,
    `</details>`,
    ``,
  ].filter(Boolean).join("\n");

  return { content: [{ type: "text", text: `${header}\n${comparison.trim()}` }] };
}
