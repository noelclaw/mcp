import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import { ToolResult } from "../types.js";

const VAULT_TYPES = ["research", "execution", "workflow", "prompt", "file", "memory"] as const;
const LINK_RELATIONS = ["references", "derived_from", "supersedes", "related", "continues"] as const;

export const VAULT_TOOLS: Tool[] = [
  {
    name: "vault_save",
    description:
      "Save or update an artifact in Noel-Vault — the persistent memory layer for agents. " +
      "Use this to store research outputs, execution logs, workflows, versioned prompts, " +
      "generated files, or long-term memory. Each save creates a new version automatically. " +
      "Same key = update existing (git-style). Types: research | execution | workflow | prompt | file | memory.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...VAULT_TYPES], description: "Entry type" },
        title: { type: "string", description: "Human-readable title" },
        content: { type: "string", description: "Main content — markdown, JSON, code, or plain text" },
        key: { type: "string", description: "Optional slug key e.g. 'research/btc-dominance-analysis'. Auto-generated if omitted." },
        contentType: { type: "string", enum: ["markdown", "json", "text", "code"], description: "Content format hint" },
        agentId: { type: "string", description: "Agent ID writing this entry" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for filtering and search" },
        commitMsg: { type: "string", description: "Commit message for this version, e.g. 'initial research', 'refined with on-chain data'" },
        metadata: { type: "string", description: "Optional JSON string for extra structured fields" },
      },
      required: ["type", "title", "content"],
    },
  },
  {
    name: "vault_read",
    description:
      "Read a Noel-Vault entry by its key. Returns full content, version, tags, and any linked entries.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Entry key e.g. 'research/btc-dominance-analysis'" },
      },
      required: ["key"],
    },
  },
  {
    name: "vault_list",
    description:
      "List Noel-Vault entries. Filter by type, agent, or pinned status. Returns previews, not full content.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...VAULT_TYPES], description: "Filter by type" },
        agentId: { type: "string", description: "Filter by agent that wrote the entries" },
        pinned: { type: "boolean", description: "Show only pinned entries" },
        limit: { type: "number", description: "Max entries to return (default 50)" },
      },
      required: [],
    },
  },
  {
    name: "vault_search",
    description:
      "Full-text search across Noel-Vault. Searches content, titles, and tags. " +
      "Optionally filter by type. Returns ranked results with previews.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        type: { type: "string", enum: [...VAULT_TYPES], description: "Narrow search to a specific type" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "vault_history",
    description:
      "Get the full version history of a Noel-Vault entry — like git log. " +
      "Shows each version with its commit message, author agent, size, and timestamp.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Entry key" },
      },
      required: ["key"],
    },
  },
  {
    name: "vault_diff",
    description:
      "Compare two versions of a Noel-Vault entry — like git diff. " +
      "Shows lines added (+) and removed (-) between fromVersion and toVersion.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Entry key" },
        fromVersion: { type: "number", description: "Older version number" },
        toVersion: { type: "number", description: "Newer version number" },
      },
      required: ["key", "fromVersion", "toVersion"],
    },
  },
  {
    name: "vault_export",
    description:
      "Export your entire Noel-Vault or a specific type as a structured bundle. " +
      "Useful for archiving, syncing to Gitlawb, or passing context to another agent.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...VAULT_TYPES], description: "Export only this type (omit for full export)" },
      },
      required: [],
    },
  },
];

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const SaveSchema = z.object({
  type: z.enum(VAULT_TYPES),
  title: z.string().min(1),
  content: z.string().min(1),
  key: z.string().optional(),
  contentType: z.enum(["markdown", "json", "text", "code"]).optional(),
  agentId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  commitMsg: z.string().optional(),
  metadata: z.string().optional(),
});

const ReadSchema = z.object({ key: z.string().min(1) });
const ListSchema = z.object({
  type: z.enum(VAULT_TYPES).optional(),
  agentId: z.string().optional(),
  pinned: z.boolean().optional(),
  limit: z.number().optional(),
});
const SearchSchema = z.object({
  query: z.string().min(1),
  type: z.enum(VAULT_TYPES).optional(),
  limit: z.number().optional(),
});
const HistorySchema = z.object({ key: z.string().min(1) });
const DiffSchema = z.object({ key: z.string().min(1), fromVersion: z.number(), toVersion: z.number() });
const ExportSchema = z.object({ type: z.enum(VAULT_TYPES).optional() });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(n: number | undefined): string {
  if (!n) return "—";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

function formatDate(ts: number): string {
  return new Date(ts).toUTCString();
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleVaultTool(name: string, args: unknown): Promise<ToolResult | null> {
  switch (name) {
    case "vault_save": {
      const parsed = SaveSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const data = await callConvex("/vault/save", "POST", parsed.data, "vault_save");
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };
      const { key, version, changed } = data;
      const lines = [
        `📦 **Vault ${changed ? (version === 1 ? "Created" : "Updated") : "Unchanged"}**`,
        `Key: \`${key}\``,
        `Version: v${version}`,
        changed && version > 1 ? `Previous version auto-snapshotted.` : "",
        ``,
        `Use \`vault_read\` to retrieve, \`vault_history\` to see all versions.`,
      ].filter(Boolean);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "vault_read": {
      const parsed = ReadSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const data = await callConvex(`/vault/entry?key=${encodeURIComponent(parsed.data.key)}`, "GET", undefined, "vault_read");
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      const lines = [
        `📂 **${data.title}**`,
        `Key: \`${data.key}\`  ·  Type: ${data.type}  ·  v${data.version}  ·  ${formatBytes(data.size)}`,
        data.tags?.length ? `Tags: ${data.tags.join(", ")}` : "",
        data.isPinned ? "📌 Pinned" : "",
        data.agentId ? `Agent: ${data.agentId}` : "",
        `Updated: ${formatDate(data.updatedAt)}`,
        data.linkedKeys?.length ? `\nLinks:\n${data.linkedKeys.map((l: string) => `  → ${l}`).join("\n")}` : "",
        ``,
        `---`,
        ``,
        data.content,
      ].filter((l) => l !== "");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "vault_list": {
      const parsed = ListSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const params = new URLSearchParams();
      if (parsed.data.type) params.set("type", parsed.data.type);
      if (parsed.data.agentId) params.set("agentId", parsed.data.agentId);
      if (parsed.data.pinned !== undefined) params.set("pinned", String(parsed.data.pinned));
      if (parsed.data.limit) params.set("limit", String(parsed.data.limit));
      const data = await callConvex(`/vault/list?${params}`, "GET", undefined, "vault_list");
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      const entries: any[] = data.entries ?? [];
      if (!entries.length) return { content: [{ type: "text", text: `No vault entries found${parsed.data.type ? ` of type '${parsed.data.type}'` : ""}.` }] };

      const header = `📚 **Noel-Vault** (${entries.length} entries)`;
      const rows = entries.map((e) =>
        `${e.isPinned ? "📌 " : ""}[\`${e.key}\`] ${e.title} — v${e.version} · ${e.type} · ${formatBytes(e.size)} · ${formatDate(e.updatedAt)}`
      );
      return { content: [{ type: "text", text: [header, "", ...rows].join("\n") }] };
    }

    case "vault_search": {
      const parsed = SearchSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const params = new URLSearchParams({ q: parsed.data.query });
      if (parsed.data.type) params.set("type", parsed.data.type);
      if (parsed.data.limit) params.set("limit", String(parsed.data.limit));
      const data = await callConvex(`/vault/search?${params}`, "GET", undefined, "vault_search");
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      const results: any[] = data.results ?? [];
      if (!results.length) return { content: [{ type: "text", text: `No vault entries found for: "${parsed.data.query}"` }] };

      const header = `🔍 **Vault Search**: "${parsed.data.query}" — ${results.length} result(s)`;
      const rows = results.map((r, i) => [
        `${i + 1}. [\`${r.key}\`] **${r.title}**  (${r.type} · v${r.version})`,
        `   ${r.preview}`,
      ].join("\n"));
      return { content: [{ type: "text", text: [header, "", ...rows].join("\n") }] };
    }

    case "vault_history": {
      const parsed = HistorySchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const data = await callConvex(`/vault/history?key=${encodeURIComponent(parsed.data.key)}`, "GET", undefined, "vault_history");
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      const { key, title, currentVersion, history } = data;
      const header = [
        `📜 **History**: ${title}`,
        `Key: \`${key}\`  ·  Current: v${currentVersion}`,
        ``,
        `| Version | Commit | Agent | Size | Date |`,
        `|---------|--------|-------|------|------|`,
      ];
      const rows = (history as any[]).map((v) =>
        `| v${v.version} | ${v.commitMsg ?? "—"} | ${v.agentId ?? "—"} | ${formatBytes(v.size)} | ${formatDate(v.createdAt)} |`
      );
      return { content: [{ type: "text", text: [...header, ...rows].join("\n") }] };
    }

    case "vault_diff": {
      const parsed = DiffSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { key, fromVersion, toVersion } = parsed.data;
      const data = await callConvex(
        `/vault/diff?key=${encodeURIComponent(key)}&from=${fromVersion}&to=${toVersion}`,
        "GET", undefined, "vault_diff"
      );
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      const lines = [
        `📝 **Diff**: \`${data.key}\` — v${fromVersion} → v${toVersion}`,
        ``,
        "```diff",
        data.diff,
        "```",
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "vault_export": {
      const parsed = ExportSchema.safeParse(args ?? {});
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const params = parsed.data.type ? `?type=${parsed.data.type}` : "";
      const data = await callConvex(`/vault/export${params}`, "GET", undefined, "vault_export");
      if (data.error) return { content: [{ type: "text", text: `Error: ${data.error}` }], isError: true };

      const { exportedAt, totalEntries, entries } = data;
      const header = [
        `📤 **Vault Export**`,
        `Exported: ${formatDate(exportedAt)}  ·  ${totalEntries} entries${parsed.data.type ? ` (type: ${parsed.data.type})` : ""}`,
        ``,
      ];
      const rows = (entries as any[]).map((e) =>
        `**[\`${e.key}\`]** ${e.title} (${e.type} · v${e.version})\n${e.content.slice(0, 500)}${e.content.length > 500 ? "\n…" : ""}`
      );
      return { content: [{ type: "text", text: [...header, ...rows.join("\n\n---\n\n").split("\n")].join("\n") }] };
    }

    default:
      return null;
  }
}
