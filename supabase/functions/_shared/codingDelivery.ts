// Tree delivery — the I/O half of the coding loop (coding capability
// PR2; design §6 inbound). The server resolves the run's target
// repository and base branch to a base SHA through the Space's GitHub
// connection, fetches a tree snapshot at that SHA, and delivers it
// into the run's workspace as a run-scoped artifact the runner
// unpacks. codingLoop.ts holds the pure decisions (the target law,
// the delivery command, the result's reading); this file performs
// them, through seams the tests can drive without a network or a
// live provider:
//
//   - the GitHub reads go through github.ts' token plumbing (the
//     Space's GitHub integrations, then anonymous — a public repo
//     reads without one);
//   - the snapshot rests, briefly, as one object in the files bucket
//     under a run-scoped path, and reaches the box only as a signed
//     URL with the snapshot's lifetime. The object is deleted the
//     moment the unpack settles, whichever way it settles;
//   - the box work itself is the caller's `runShell` — run-agent's
//     asset_calls queue to the run's bound machine. This module
//     never learns how a call reaches a runner.
//
// No GitHub credential enters the box at any point: the token goes
// only into this function's own outgoing Authorization header, and
// the delivery command carries the signed URL and nothing else. The
// box receives a tree and a base to diff against — no history (§6).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GithubError, githubTokens, withGithubToken } from "./github.ts";
import { deliveryCommand, parseDeliveryResult, type CodingTarget } from "./codingLoop.ts";

const API = "https://api.github.com";
const BUCKET = "element-files";
/** The snapshot object's lifetime: long enough for the runner to
 *  fetch it once, short enough that a leaked URL is a dead one. */
const SNAPSHOT_URL_TTL_S = 600;

/** A shell call into the run's workspace, as the driver performs it. */
export type RunShell = (command: string) => Promise<{ ok: boolean; exitCode: number | null; stdout: string; stderr: string }>;

async function ghBytes(path: string, token: string | null): Promise<Uint8Array> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "alcon-coding",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 200);
    throw new GithubError(`GitHub ${res.status}${text ? `: ${text}` : ""}`, res.status);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function ghJson(path: string, token: string | null): Promise<Record<string, unknown>> {
  const bytes = await ghBytes(path, token);
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

/** The base branch's current commit SHA, through the connection. */
export async function fetchBaseSha(tokens: (string | null)[], target: CodingTarget): Promise<string> {
  const raw = await withGithubToken(tokens, (t) => ghJson(`/repos/${target.repo}/commits/${encodeURIComponent(target.baseBranch)}`, t));
  const sha = raw.sha;
  if (typeof sha !== "string" || !sha) throw new GithubError("GitHub returned no commit for the base branch", 502);
  return sha;
}

/** A tree snapshot (tarball) of the repository at one SHA. */
export async function fetchTreeTarball(tokens: (string | null)[], target: CodingTarget, sha: string): Promise<Uint8Array> {
  return await withGithubToken(tokens, (t) => ghBytes(`/repos/${target.repo}/tarball/${sha}`, t));
}

/** One file of the tree at one SHA, for the publish composition
 *  (PR3): its text and its blob SHA (the delete call names the file
 *  it removes by it). A read through the same token plumbing as the
 *  delivery — the publish's WRITES travel the manifest; what the
 *  patch is applied against is read the way the tree was delivered.
 *  "binary" and "too_large" are outcomes, not errors: the caller
 *  words them as the publish's honest refusals. */
export type BaseFileOutcome =
  | { ok: true; content: string; blobSha: string }
  | { ok: false; code: "missing" | "binary" | "too_large" };

export async function fetchRepoFileAtSha(
  tokens: (string | null)[],
  target: CodingTarget,
  path: string,
  sha: string,
): Promise<BaseFileOutcome> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  let raw: Record<string, unknown>;
  try {
    raw = await withGithubToken(tokens, (t) => ghJson(`/repos/${target.repo}/contents/${encoded}?ref=${encodeURIComponent(sha)}`, t));
  } catch (e) {
    if (e instanceof GithubError && e.status === 404) return { ok: false, code: "missing" };
    if (e instanceof GithubError && e.status === 422) return { ok: false, code: "too_large" };
    throw e;
  }
  if (typeof raw.content !== "string" || typeof raw.sha !== "string") return { ok: false, code: "missing" };
  const bytes = Uint8Array.from(atob(raw.content.replace(/\s/g, "")), (c) => c.charCodeAt(0));
  // Binary is judged on the bytes, not the decoded text: a lossy
  // decode would hide the very bytes that make it binary.
  if (bytes.subarray(0, 8192).includes(0)) return { ok: false, code: "binary" };
  return { ok: true, content: new TextDecoder().decode(bytes), blobSha: raw.sha };
}

export type DeliveryOutcome =
  | { ok: true; baseSha: string; files: number | null }
  | { ok: false; code: "github_failed" | "store_failed" | "unpack_failed"; detail: string };

/**
 * Deliver the target's tree at its base SHA into the workspace.
 * Every failure is an outcome, not a throw: the caller words it for
 * the person and the run goes on without a tree (its finish gate
 * then refuses a "completed" — the honest shape of a coding run
 * that never received its code).
 */
export async function deliverTreeToWorkspace(input: {
  admin: SupabaseClient;
  runId: string;
  spaceId: string | null;
  target: CodingTarget;
  runShell: RunShell;
}): Promise<DeliveryOutcome> {
  const tokens = await githubTokens(input.admin, input.spaceId).catch(() => [null]);
  let baseSha: string;
  let tarball: Uint8Array;
  try {
    baseSha = await fetchBaseSha(tokens, input.target);
    tarball = await fetchTreeTarball(tokens, input.target, baseSha);
  } catch (e) {
    return { ok: false, code: "github_failed", detail: e instanceof Error ? e.message.slice(0, 300) : "GitHub からツリーを取得できませんでした" };
  }

  const path = `run-tree/${input.runId}.tar.gz`;
  const up = await input.admin.storage.from(BUCKET).upload(path, tarball, { contentType: "application/gzip", upsert: true });
  if (up.error) return { ok: false, code: "store_failed", detail: up.error.message.slice(0, 300) };
  try {
    const signed = await input.admin.storage.from(BUCKET).createSignedUrl(path, SNAPSHOT_URL_TTL_S);
    if (signed.error || !signed.data?.signedUrl) {
      return { ok: false, code: "store_failed", detail: (signed.error?.message ?? "署名付き URL を作れませんでした").slice(0, 300) };
    }
    const res = await input.runShell(deliveryCommand({ url: signed.data.signedUrl, target: input.target, baseSha }));
    if (!res.ok || res.exitCode !== 0) {
      return { ok: false, code: "unpack_failed", detail: (res.stderr || res.stdout || "展開に失敗しました").slice(0, 300) };
    }
    return { ok: true, baseSha, files: parseDeliveryResult(res.stdout)?.files ?? null };
  } finally {
    // The snapshot has served its one purpose; it does not linger.
    await input.admin.storage.from(BUCKET).remove([path]).catch(() => {});
  }
}
