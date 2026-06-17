import { createClient } from "npm:@supabase/supabase-js@2";
import { ethers } from "npm:ethers@6";

// ─── CORS ─────────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Wallet-Address, X-Wallet-Signature, X-Wallet-Timestamp",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\-\/]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function computeDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const result: string[] = [];
  let added = 0;
  let removed = 0;
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === undefined) {
      result.push(`+ ${n}`);
      added++;
    } else if (n === undefined) {
      result.push(`- ${o}`);
      removed++;
    } else if (o !== n) {
      result.push(`- ${o}`);
      result.push(`+ ${n}`);
      removed++;
      added++;
    } else {
      result.push(`  ${o}`);
    }
  }

  const header = `@@ +${added} -${removed} lines @@`;
  const body = result.slice(0, 500).join("\n");
  const truncated = result.length > 500 ? `\n... (${result.length - 500} lines omitted)` : "";
  return `${header}\n${body}${truncated}`;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function resolveAuth(
  request: Request,
  toolName: string,
): Promise<{ userId: string } | Response> {
  // 1. API key - long-lived, safe for CI/CD secrets
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer noel_")) {
    const raw = authHeader.slice(7);
    const hash = await sha256hex(raw);
    const db = getSupabase();
    const { data } = await db
      .from("api_keys")
      .select("wallet, user_id, revoked_at")
      .eq("key_hash", hash)
      .maybeSingle();
    if (!data) return json({ error: "Invalid API key" }, 401);
    if (data.revoked_at) return json({ error: "API key revoked" }, 401);
    db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("key_hash", hash);
    // email user (user_id) takes priority over legacy wallet address
    return { userId: data.user_id ?? data.wallet };
  }

  // 2. Wallet signature - interactive use (browser / one-time setup)
  const walletAddress = request.headers.get("X-Wallet-Address");
  const walletSignature = request.headers.get("X-Wallet-Signature");
  const walletTimestamp = request.headers.get("X-Wallet-Timestamp");

  if (walletAddress && walletSignature && walletTimestamp) {
    try {
      const ts = parseInt(walletTimestamp, 10);
      if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000) {
        return json({ error: "Timestamp expired" }, 401);
      }
      const message = `noelclaw:${toolName}:${walletTimestamp}`;
      const recovered = ethers.verifyMessage(message, walletSignature);
      if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
        return json({ error: "Signature mismatch" }, 401);
      }
      return { userId: walletAddress.toLowerCase() };
    } catch (err: any) {
      return json({ error: `Verification error: ${err.message}` }, 401);
    }
  }

  return json({ error: "Authentication required - use Bearer API key or wallet signature headers" }, 401);
}

// ─── Key management ───────────────────────────────────────────────────────────

async function handleKeyGenerate(request: Request): Promise<Response> {
  // Requires one-time wallet signature to issue a long-lived key
  const auth = await resolveAuth(request, "vault_key_generate");
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const body = await request.json().catch(() => ({})) as any;
  const label = body?.label ?? null;

  // Generate: noel_ + 64 random hex chars
  const rand = new Uint8Array(32);
  crypto.getRandomValues(rand);
  const rawKey = "noel_" + Array.from(rand).map(b => b.toString(16).padStart(2, "0")).join("");
  const keyHash = await sha256hex(rawKey);

  const { error } = await getSupabase()
    .from("api_keys")
    .insert({ wallet: userId, key_hash: keyHash, label });

  if (error) return json({ error: error.message }, 500);
  return json({
    key: rawKey,
    wallet: userId,
    label,
    message: "Save this key - it will not be shown again.",
  });
}

async function handleKeyRevoke(request: Request): Promise<Response> {
  const auth = await resolveAuth(request, "vault_key_revoke");
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const body = await request.json().catch(() => ({})) as any;
  if (!body?.keyId) return json({ error: "keyId required" }, 400);

  const { error } = await getSupabase()
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", body.keyId)
    .eq("wallet", userId);

  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
}

async function handleKeyList(request: Request): Promise<Response> {
  const auth = await resolveAuth(request, "vault_key_list");
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const { data, error } = await getSupabase()
    .from("api_keys")
    .select("id, label, created_at, last_used_at, revoked_at")
    .eq("wallet", userId)
    .order("created_at", { ascending: false });

  if (error) return json({ error: error.message }, 500);
  return json({ keys: data ?? [] });
}

// ─── Supabase client ──────────────────────────────────────────────────────────

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleSave(request: Request): Promise<Response> {
  let body: any = {};
  try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const auth = await resolveAuth(request, "vault_save");
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const { key: rawKey, type, title, content, contentType, agentId, swarmId, tags, commitMsg, metadata } = body;
  if (!type || !title || !content) return json({ error: "type, title, content required" }, 400);

  const db = getSupabase();
  const now = Date.now();
  const key = rawKey ? slugify(rawKey) : slugify(`${type}/${title}-${now}`);
  const size = content.length;

  try {
    // Check if entry exists
    const { data: existing } = await db
      .from("vault_entries")
      .select("*")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();

    if (existing) {
      // No change
      if (existing.content === content && existing.title === title) {
        return json({ key, version: existing.version, changed: false });
      }

      const newVersion = existing.version + 1;

      // Find latest saved version for parent_version_id
      const { data: prevVersion } = await db
        .from("vault_versions")
        .select("id")
        .eq("entry_id", existing.id)
        .eq("version", existing.version)
        .maybeSingle();

      // Snapshot old content into vault_versions
      await db.from("vault_versions").insert({
        entry_id: existing.id,
        user_id: userId,
        version: existing.version,
        title: existing.title,
        content: existing.content,
        commit_msg: commitMsg ?? `v${existing.version} snapshot`,
        agent_id: agentId ?? null,
        parent_version_id: prevVersion?.id ?? null,
        size: existing.size ?? existing.content.length,
        created_at: now,
      });

      // Update entry
      await db.from("vault_entries").update({
        title,
        content,
        content_type: contentType ?? existing.content_type,
        agent_id: agentId ?? existing.agent_id,
        swarm_id: swarmId ?? existing.swarm_id,
        tags: tags ?? existing.tags,
        version: newVersion,
        size,
        metadata: metadata ?? existing.metadata,
        updated_at: now,
      }).eq("id", existing.id);

      return json({ key, version: newVersion, changed: true });
    }

    // New entry
    const { data: newEntry, error: insertErr } = await db
      .from("vault_entries")
      .insert({
        user_id: userId,
        key,
        type,
        title,
        content,
        content_type: contentType ?? null,
        agent_id: agentId ?? null,
        swarm_id: swarmId ?? null,
        tags: tags ?? null,
        version: 1,
        is_pinned: false,
        is_archived: false,
        size,
        metadata: metadata ?? null,
        updated_at: now,
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    return json({ key, version: 1, changed: true });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

async function handleCommit(request: Request): Promise<Response> {
  let body: any = {};
  try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const auth = await resolveAuth(request, "vault_commit");
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const { key, commitMsg, tags } = body;
  if (!key || !commitMsg) return json({ error: "key and commitMsg required" }, 400);

  const db = getSupabase();
  try {
    const { data: entry } = await db
      .from("vault_entries")
      .select("*")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();

    if (!entry) return json({ error: "Entry not found" }, 404);

    // Tag latest version with commit message
    await db
      .from("vault_versions")
      .update({ commit_msg: commitMsg })
      .eq("entry_id", entry.id)
      .eq("version", entry.version);

    if (tags) {
      await db
        .from("vault_entries")
        .update({ tags, updated_at: Date.now() })
        .eq("id", entry.id);
    }

    return json({ key: entry.key, version: entry.version, commitMsg });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

async function handleLink(request: Request): Promise<Response> {
  let body: any = {};
  try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const auth = await resolveAuth(request, "vault_link");
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const { fromKey, toKey, relation } = body;
  if (!fromKey || !toKey || !relation) return json({ error: "fromKey, toKey, relation required" }, 400);

  const db = getSupabase();
  try {
    const [{ data: fromEntry }, { data: toEntry }] = await Promise.all([
      db.from("vault_entries").select("id, key").eq("user_id", userId).eq("key", fromKey).maybeSingle(),
      db.from("vault_entries").select("id, key").eq("user_id", userId).eq("key", toKey).maybeSingle(),
    ]);

    if (!fromEntry) return json({ error: `Entry not found: ${fromKey}` }, 404);
    if (!toEntry) return json({ error: `Entry not found: ${toKey}` }, 404);

    const now = Date.now();

    // Check for existing link (unique constraint on from+to)
    const { data: existing } = await db
      .from("vault_links")
      .select("id")
      .eq("from_entry_id", fromEntry.id)
      .eq("to_entry_id", toEntry.id)
      .maybeSingle();

    if (existing) {
      await db
        .from("vault_links")
        .update({ relation, created_at: now })
        .eq("id", existing.id);
      return json({ relation, updated: true });
    }

    await db.from("vault_links").insert({
      user_id: userId,
      from_entry_id: fromEntry.id,
      to_entry_id: toEntry.id,
      relation,
      created_at: now,
    });

    return json({ relation, updated: false });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

async function handlePin(request: Request): Promise<Response> {
  let body: any = {};
  try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const auth = await resolveAuth(request, "vault_pin");
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const { key, pinned } = body;
  if (!key) return json({ error: "key required" }, 400);

  const db = getSupabase();
  try {
    const { data: entry } = await db
      .from("vault_entries")
      .select("id, key")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();

    if (!entry) return json({ error: "Entry not found" }, 404);

    const isPinned = pinned !== false;
    await db
      .from("vault_entries")
      .update({ is_pinned: isPinned, updated_at: Date.now() })
      .eq("id", entry.id);

    return json({ key: entry.key, isPinned });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

async function handleArchive(request: Request): Promise<Response> {
  let body: any = {};
  try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const auth = await resolveAuth(request, "vault_archive");
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const { key, archived } = body;
  if (!key) return json({ error: "key required" }, 400);

  const db = getSupabase();
  try {
    const { data: entry } = await db
      .from("vault_entries")
      .select("id, key")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();

    if (!entry) return json({ error: "Entry not found" }, 404);

    const isArchived = archived !== false;
    await db
      .from("vault_entries")
      .update({ is_archived: isArchived, updated_at: Date.now() })
      .eq("id", entry.id);

    return json({ key: entry.key, isArchived });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

async function handleDelete(request: Request): Promise<Response> {
  let body: any = {};
  try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const auth = await resolveAuth(request, "vault_delete");
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const { key } = body;
  if (!key) return json({ error: "key required" }, 400);

  const db = getSupabase();
  try {
    const { data: entry } = await db
      .from("vault_entries")
      .select("id")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();

    if (!entry) return json({ error: "Entry not found" }, 404);

    // Cascade delete handled by FK constraints (on delete cascade)
    await db.from("vault_entries").delete().eq("id", entry.id);

    return json({ deleted: true, key });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

async function handleList(request: Request): Promise<Response> {
  const auth = await resolveAuth(request, "vault_list");
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const params = new URL(request.url).searchParams;
  const type = params.get("type") ?? undefined;
  const agentId = params.get("agentId") ?? undefined;
  const pinnedParam = params.get("pinned");
  const pinned = pinnedParam === "true" ? true : pinnedParam === "false" ? false : undefined;
  const includeArchived = params.get("archived") === "true";
  const limit = params.get("limit") ? parseInt(params.get("limit")!, 10) : 50;

  const db = getSupabase();
  try {
    let q = db
      .from("vault_entries")
      .select("key, type, title, version, size, tags, is_pinned, is_archived, agent_id, updated_at, content")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (type) q = q.eq("type", type);
    if (agentId) q = q.eq("agent_id", agentId);
    if (!includeArchived) q = q.eq("is_archived", false);
    if (pinned !== undefined) q = q.eq("is_pinned", pinned);

    const { data: rows, error } = await q;
    if (error) throw error;

    const entries = (rows ?? []).map((e: any) => ({
      key: e.key,
      type: e.type,
      title: e.title,
      version: e.version,
      size: e.size,
      tags: e.tags,
      isPinned: e.is_pinned,
      isArchived: e.is_archived,
      agentId: e.agent_id,
      updatedAt: e.updated_at,
      preview: (e.content as string).slice(0, 200),
    }));

    return json({ entries, total: entries.length });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

async function handleEntry(request: Request): Promise<Response> {
  const auth = await resolveAuth(request, "vault_read");
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const key = new URL(request.url).searchParams.get("key");
  if (!key) return json({ error: "key required" }, 400);

  const db = getSupabase();
  try {
    const { data: entry, error } = await db
      .from("vault_entries")
      .select("*")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();

    if (error) throw error;
    if (!entry) return json({ error: "Not found" }, 404);

    // Fetch links and resolve target keys
    const { data: links } = await db
      .from("vault_links")
      .select("relation, to_entry_id")
      .eq("from_entry_id", entry.id);

    const linkedKeys: string[] = [];
    if (links && links.length > 0) {
      const toIds = links.map((l: any) => l.to_entry_id);
      const { data: targets } = await db
        .from("vault_entries")
        .select("id, key")
        .in("id", toIds);

      const targetMap = new Map((targets ?? []).map((t: any) => [t.id, t.key]));
      for (const link of links) {
        const targetKey = targetMap.get(link.to_entry_id);
        if (targetKey) linkedKeys.push(`${link.relation}: ${targetKey}`);
      }
    }

    return json({
      key: entry.key,
      type: entry.type,
      title: entry.title,
      content: entry.content,
      contentType: entry.content_type,
      agentId: entry.agent_id,
      swarmId: entry.swarm_id,
      tags: entry.tags,
      version: entry.version,
      isPinned: entry.is_pinned,
      isArchived: entry.is_archived,
      size: entry.size,
      metadata: entry.metadata,
      updatedAt: entry.updated_at,
      linkedKeys,
    });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

async function handleSearch(request: Request): Promise<Response> {
  const auth = await resolveAuth(request, "vault_search");
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const params = new URL(request.url).searchParams;
  const q = params.get("q");
  if (!q) return json({ error: "q required" }, 400);
  const type = params.get("type") ?? undefined;
  const limit = params.get("limit") ? parseInt(params.get("limit")!, 10) : 20;

  const db = getSupabase();
  try {
    // Full-text search using tsvector
    const tsQuery = q.trim().split(/\s+/).join(" & ");
    let ftQuery = db
      .from("vault_entries")
      .select("key, type, title, version, tags, updated_at, content")
      .eq("user_id", userId)
      .eq("is_archived", false)
      .textSearch("search_vector", tsQuery, { type: "websearch" })
      .limit(limit);

    if (type) ftQuery = ftQuery.eq("type", type);

    const { data: ftResults } = await ftQuery;

    // Fallback ilike search on title + key + tags
    const likePattern = `%${q}%`;
    let fallbackQuery = db
      .from("vault_entries")
      .select("key, type, title, version, tags, updated_at, content")
      .eq("user_id", userId)
      .eq("is_archived", false)
      .or(`title.ilike.${likePattern},key.ilike.${likePattern}`)
      .limit(limit);

    if (type) fallbackQuery = fallbackQuery.eq("type", type);

    const { data: fallbackResults } = await fallbackQuery;

    // Merge and deduplicate - ft results first
    const seen = new Set<string>();
    const merged = [...(ftResults ?? []), ...(fallbackResults ?? [])].filter((e) => {
      if (seen.has(e.key)) return false;
      seen.add(e.key);
      return true;
    }).slice(0, limit);

    const results = merged.map((e: any) => ({
      key: e.key,
      type: e.type,
      title: e.title,
      version: e.version,
      tags: e.tags,
      updatedAt: e.updated_at,
      preview: (e.content as string).slice(0, 300),
    }));

    return json({ results, total: results.length });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

async function handleHistory(request: Request): Promise<Response> {
  const auth = await resolveAuth(request, "vault_history");
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const key = new URL(request.url).searchParams.get("key");
  if (!key) return json({ error: "key required" }, 400);

  const db = getSupabase();
  try {
    const { data: entry } = await db
      .from("vault_entries")
      .select("id, key, title, version")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();

    if (!entry) return json({ error: "Not found" }, 404);

    const { data: versions, error } = await db
      .from("vault_versions")
      .select("version, title, commit_msg, agent_id, size, created_at, content")
      .eq("entry_id", entry.id)
      .order("version", { ascending: false })
      .limit(50);

    if (error) throw error;

    return json({
      key: entry.key,
      title: entry.title,
      currentVersion: entry.version,
      history: (versions ?? []).map((v: any) => ({
        version: v.version,
        title: v.title,
        commitMsg: v.commit_msg,
        agentId: v.agent_id,
        size: v.size,
        createdAt: v.created_at,
        preview: (v.content as string).slice(0, 150),
      })),
    });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

async function handleDiff(request: Request): Promise<Response> {
  const auth = await resolveAuth(request, "vault_diff");
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const params = new URL(request.url).searchParams;
  const key = params.get("key");
  const from = params.get("from");
  const to = params.get("to");
  if (!key || !from || !to) return json({ error: "key, from, to required" }, 400);

  const fromVersion = parseInt(from, 10);
  const toVersion = parseInt(to, 10);

  const db = getSupabase();
  try {
    const { data: entry } = await db
      .from("vault_entries")
      .select("id, key, version, title, content")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();

    if (!entry) return json({ error: "Entry not found" }, 404);

    const getVersion = async (ver: number): Promise<{ content: string; title: string } | null> => {
      if (ver === entry.version) return { content: entry.content, title: entry.title };
      const { data: v } = await db
        .from("vault_versions")
        .select("content, title")
        .eq("entry_id", entry.id)
        .eq("version", ver)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return v ? { content: v.content, title: v.title } : null;
    };

    const [fromV, toV] = await Promise.all([getVersion(fromVersion), getVersion(toVersion)]);

    if (!fromV) return json({ error: `Version ${fromVersion} not found` }, 404);
    if (!toV) return json({ error: `Version ${toVersion} not found` }, 404);

    return json({
      key: entry.key,
      fromVersion,
      toVersion,
      diff: computeDiff(fromV.content, toV.content),
    });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

async function handleExport(request: Request): Promise<Response> {
  const auth = await resolveAuth(request, "vault_export");
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const type = new URL(request.url).searchParams.get("type") ?? undefined;

  const db = getSupabase();
  try {
    let q = db
      .from("vault_entries")
      .select("key, type, title, content, content_type, version, tags, agent_id, metadata, updated_at")
      .eq("user_id", userId)
      .eq("is_archived", false);

    if (type) q = q.eq("type", type);

    const { data: entries, error } = await q;
    if (error) throw error;

    return json({
      exportedAt: Date.now(),
      userId,
      totalEntries: (entries ?? []).length,
      entries: (entries ?? []).map((e: any) => ({
        key: e.key,
        type: e.type,
        title: e.title,
        content: e.content,
        contentType: e.content_type,
        version: e.version,
        tags: e.tags,
        agentId: e.agent_id,
        metadata: e.metadata,
        updatedAt: e.updated_at,
      })),
    });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

Deno.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^.*\/vault/, "") || "/";
  const method = request.method;

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // POST routes
  if (method === "POST") {
    if (path === "/save") return handleSave(request);
    if (path === "/commit") return handleCommit(request);
    if (path === "/link") return handleLink(request);
    if (path === "/pin") return handlePin(request);
    if (path === "/archive") return handleArchive(request);
    if (path === "/delete") return handleDelete(request);
    if (path === "/keys/generate") return handleKeyGenerate(request);
    if (path === "/keys/revoke") return handleKeyRevoke(request);
  }

  // GET routes
  if (method === "GET") {
    if (path === "/list") return handleList(request);
    if (path === "/entry") return handleEntry(request);
    if (path === "/search") return handleSearch(request);
    if (path === "/history") return handleHistory(request);
    if (path === "/diff") return handleDiff(request);
    if (path === "/export") return handleExport(request);
    if (path === "/keys") return handleKeyList(request);
  }

  return json({ error: "Not found" }, 404);
});
