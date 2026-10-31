import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Reading pull requests from GitHub for code_changes, with the credential of
// the Space's GitHub integration (the fine-grained token stored in Vault for
// the GitHub MCP preset works on the REST API too). Used by the
// code-changes Edge Function and by run-agent when an agent opens a PR.
//
// The token goes only into the outgoing Authorization header; it is never
// returned, logged or stored anywhere else.

const API = "https://api.github.com";
const MAX_FILES = 300;

export interface PullRef { repo: string; number: number }

const PULL_URL = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/g;

/** Pure. The pull request a URL names, or null. */
export function parsePullUrl(raw: string): PullRef | null {
  PULL_URL.lastIndex = 0;
  const m = PULL_URL.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[3]);
  return n > 0 ? { repo: `${m[1]}/${m[2]}`, number: n } : null;
}

/** Pure. Every distinct pull request URL in a text (a tool result). */
export function pullUrlsIn(text: string): PullRef[] {
  const seen = new Map<string, PullRef>();
  for (const m of text.matchAll(PULL_URL)) {
    const ref = { repo: `${m[1]}/${m[2]}`, number: Number(m[3]) };
    if (ref.number > 0) seen.set(`${ref.repo}#${ref.number}`, ref);
  }
  return [...seen.values()];
}

export interface GithubPull {
  title: string;
  body: string | null;
  state: "open" | "draft" | "merged" | "closed";
  url: string;
  base_ref: string | null;
  head_ref: string | null;
  head_sha: string | null;
  author_login: string | null;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
}

export interface GithubFile {
  filename: string;
  previous_filename: string | null;
  status: string;
  additions: number;
  deletions: number;
  /** Absent for binary files and for diffs GitHub considers too large. */
  patch: string | null;
}

export class GithubError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function gh(path: string, token: string | null): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "alcon-code-changes",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 200);
    throw new GithubError(`GitHub ${res.status}${text ? `: ${text}` : ""}`, res.status);
  }
  return await res.json();
}

function readPull(raw: Record<string, unknown>): GithubPull {
  const head = (raw.head ?? {}) as Record<string, unknown>;
  const base = (raw.base ?? {}) as Record<string, unknown>;
  const user = (raw.user ?? {}) as Record<string, unknown>;
  const state = raw.merged_at ? "merged" : raw.state === "closed" ? "closed" : raw.draft ? "draft" : "open";
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    title: String(raw.title ?? "").slice(0, 500),
    body: str(raw.body)?.slice(0, 20000) ?? null,
    state,
    url: String(raw.html_url ?? ""),
    base_ref: str(base.ref),
    head_ref: str(head.ref),
    head_sha: str(head.sha),
    author_login: str(user.login),
    additions: num(raw.additions),
    deletions: num(raw.deletions),
    changed_files: num(raw.changed_files),
  };
}

export async function fetchPull(ref: PullRef, token: string | null): Promise<GithubPull> {
  return readPull(await gh(`/repos/${ref.repo}/pulls/${ref.number}`, token) as Record<string, unknown>);
}

export async function fetchPullFiles(ref: PullRef, token: string | null): Promise<GithubFile[]> {
  const files: GithubFile[] = [];
  for (let page = 1; files.length < MAX_FILES; page++) {
    const batch = await gh(`/repos/${ref.repo}/pulls/${ref.number}/files?per_page=100&page=${page}`, token) as Record<string, unknown>[];
    for (const f of batch) {
      files.push({
        filename: String(f.filename ?? ""),
        previous_filename: typeof f.previous_filename === "string" ? f.previous_filename : null,
        status: String(f.status ?? "modified"),
        additions: Number(f.additions ?? 0),
        deletions: Number(f.deletions ?? 0),
        patch: typeof f.patch === "string" ? f.patch : null,
      });
    }
    if (batch.length < 100) break;
  }
  return files.slice(0, MAX_FILES);
}

/**
 * The tokens to try for a Space: each enabled GitHub integration's credential,
 * then none (a public repository reads without one). Reading the secret uses
 * the service role, so callers check the person's access first.
 */
export async function githubTokens(admin: SupabaseClient, spaceId: string | null): Promise<(string | null)[]> {
  const tokens: (string | null)[] = [];
  if (spaceId) {
    const { data: rows } = await admin.from("integrations")
      .select("id, preset, endpoint").eq("activity_space_id", spaceId).eq("enabled", true).order("created_at");
    for (const row of (rows ?? []) as { id: string; preset: string | null; endpoint: string }[]) {
      if (row.preset !== "github" && !/(^|\.)github(copilot)?\.com\//.test(row.endpoint.replace(/^https:\/\//, ""))) continue;
      const { data: secret } = await admin.rpc("get_integration_secret", { p_integration_id: row.id });
      if (typeof secret === "string" && secret) tokens.push(secret);
    }
  }
  tokens.push(null);
  return tokens;
}

/** Runs `fn` with each token until one is allowed; the last refusal is thrown. */
export async function withGithubToken<T>(tokens: (string | null)[], fn: (token: string | null) => Promise<T>): Promise<T> {
  let last: unknown = new GithubError("GitHub is not connected", 401);
  for (const token of tokens) {
    try {
      return await fn(token);
    } catch (e) {
      last = e;
      // Only "this token can't see it" moves on to the next token.
      if (!(e instanceof GithubError) || ![401, 403, 404].includes(e.status)) throw e;
    }
  }
  throw last;
}

/** The code_changes columns a pull request's metadata fills. */
export function pullColumns(pull: GithubPull): Record<string, unknown> {
  return {
    url: pull.url, title: pull.title, body: pull.body, state: pull.state, base_ref: pull.base_ref, head_ref: pull.head_ref,
    head_sha: pull.head_sha, author_login: pull.author_login, additions: pull.additions, deletions: pull.deletions,
    changed_files: pull.changed_files, synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

/**
 * Links a pull request to an Element (insert, or refresh the existing link).
 * `admin` is the service role: the caller has already checked that the person
 * can see the Element.
 */
export async function upsertCodeChange(
  admin: SupabaseClient,
  elementId: string,
  ref: PullRef,
  pull: GithubPull,
  link: { linkedBy: string | null; via: "manual" | "agent"; runId?: string | null },
): Promise<{ id: string } | null> {
  const { data: existing } = await admin.from("code_changes").select("id")
    .eq("element_id", elementId).eq("repo", ref.repo).eq("number", ref.number).maybeSingle();
  if (existing) {
    const { error } = await admin.from("code_changes").update(pullColumns(pull)).eq("id", existing.id);
    if (error) throw error;
    return { id: existing.id as string };
  }
  const { data, error } = await admin.from("code_changes").insert({
    element_id: elementId, repo: ref.repo, number: ref.number, linked_by: link.linkedBy, linked_via: link.via,
    run_id: link.runId ?? null, ...pullColumns(pull),
  }).select("id").single();
  if (error) throw error;
  return data as { id: string };
}
