import { callConvex, callConvexRaw } from "./convex.js";

// MCP Resources surface for noelclaw.
//
// Exposes the user's vault entries as MCP Resources so the LLM can pull
// them directly via the standard Resource read flow - no Tool call, no
// per-read schema overhead. URI shape:
//
//   noelclaw://vault/<entry-key>
//
// Pagination via MCP cursors lets clients walk past the first page when a
// user has thousands of entries - earlier versions silently truncated at 50.
// MIME type is derived from the entry's contentType (json/code/markdown/text).

const PAGE_SIZE = 50;
const URI_PREFIX = "noelclaw://vault/";

type VaultListEntry = {
  key: string;
  title?: string;
  type?: string;
  version?: number;
  size?: number;
  originalSize?: number;
  updatedAt?: number;
  contentType?: "markdown" | "json" | "text" | "code";
};

function mimeForContentType(ct?: string): string {
  switch (ct) {
    case "json": return "application/json";
    case "code": return "text/x-source";
    case "text": return "text/plain";
    case "markdown":
    default: return "text/markdown";
  }
}

// Opaque cursor encoding - current spec just wraps a numeric offset, but
// keep it base64 so we can extend later (e.g. encode a key for keyset
// pagination) without breaking already-issued cursors.
function encodeCursor(offset: number): string {
  return Buffer.from(`v1:${offset}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const m = decoded.match(/^v1:(\d+)$/);
    if (!m) return 0;
    const offset = parseInt(m[1], 10);
    return Number.isFinite(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

export async function listVaultResources(cursor?: string): Promise<{
  resources: Array<{
    uri: string;
    name: string;
    title?: string;
    description?: string;
    mimeType: string;
    size?: number;
  }>;
  nextCursor?: string;
}> {
  try {
    const offset = decodeCursor(cursor);
    // Over-fetch by 1 so we can tell if there's another page without a count call.
    const data = await callConvex(
      `/vault/list?limit=${PAGE_SIZE + 1}&offset=${offset}`,
      "GET",
      undefined,
      "list_resources",
    ) as { entries?: VaultListEntry[]; results?: VaultListEntry[] };

    const allEntries = data.entries ?? data.results ?? [];
    const hasMore = allEntries.length > PAGE_SIZE;
    const entries = hasMore ? allEntries.slice(0, PAGE_SIZE) : allEntries;

    const resources = entries.map((e) => ({
      uri: `${URI_PREFIX}${encodeURIComponent(e.key)}`,
      name: e.key,
      title: e.title ?? e.key,
      description: e.type ? `${e.type} entry · v${e.version ?? 1}` : undefined,
      mimeType: mimeForContentType(e.contentType),
      size: e.originalSize ?? e.size,
    }));

    return hasMore
      ? { resources, nextCursor: encodeCursor(offset + PAGE_SIZE) }
      : { resources };
  } catch {
    // Resource listing must never throw - return empty rather than
    // breaking the handshake.
    return { resources: [] };
  }
}

export async function readVaultResource(uri: string): Promise<{
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}> {
  if (!uri.startsWith(URI_PREFIX)) {
    throw new Error(`Unknown resource URI: ${uri}`);
  }

  const key = decodeURIComponent(uri.slice(URI_PREFIX.length));

  const data = await callConvex(
    `/vault/entry?key=${encodeURIComponent(key)}`,
    "GET",
    undefined,
    "read_resource",
  ) as {
    title?: string;
    type?: string;
    version?: number;
    content?: string;
    contentFileId?: string;
    contentType?: "markdown" | "json" | "text" | "code";
    error?: string;
  };

  if (data.error) {
    throw new Error(`Vault entry not found: ${key}`);
  }

  // Blob-backed entry - preview lives in `content`, real payload streams
  // from /vault/blob. Same flow vault_read uses internally.
  let body = data.content ?? "";
  if (data.contentFileId) {
    try {
      body = await callConvexRaw(
        `/vault/blob?id=${encodeURIComponent(data.contentFileId)}`,
        "read_resource",
      );
    } catch (err: any) {
      body = (data.content ?? "") + `\n\n_(could not load full blob: ${err.message})_`;
    }
  }

  const mime = mimeForContentType(data.contentType);
  // Only prepend a friendly header for markdown (the default) - JSON/code
  // payloads must remain valid in their own grammar so consuming tools can
  // parse them. The version/type info is already exposed via the resource
  // listing's description field.
  const text = mime === "text/markdown"
    ? [
        `# ${data.title ?? key}`,
        `Type: ${data.type ?? "memory"} · Version: ${data.version ?? 1}`,
        "",
        "---",
        "",
      ].join("\n") + body
    : body;

  return {
    contents: [{
      uri,
      mimeType: mime,
      text,
    }],
  };
}
