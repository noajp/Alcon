// Runner sign-in (secure-login PR3): the server half of pc_sign_in.
//
// The model calls pc_sign_in with no secret arguments — at most an
// origin it believes it is on. Everything that decides whether a
// stored password moves is here and in the run driver, in code the
// model cannot reach:
//
//   - the page's origin is the RUNNER's report of its own browser
//     (the probe result's URL), canonicalized by the same
//     normalizeSiteOrigin the capture creators use — never model text;
//   - a credential is released only when triple origin equality
//     holds: the stored row's origin = the runner-reported origin =
//     the model's claimed origin, when it claims one (design §3.5);
//   - a refusal is audited (release_refused) and shown on the run's
//     record; a value never appears in a step, a result, or an audit
//     row — the pair exists in this process only between the Vault
//     read and the staged delivery to the runner (migration
//     20261203090000), and in the runner's memory only for the fill.
//
// D6 lives here too, as a pure decision: in the ask approval mode, a
// run's first-ever sign-in with a stored site credential waits for a
// person's card — once per credential, remembered by the audit trail
// (the 'used' rows below), not by a rule. A use-once stash never
// asks: the person's one-time act of typing it for this need is the
// consent itself (D3's logic, one step stronger).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ToolCall } from "./agentLoop.ts";
import type { ApprovalDisplay } from "./integrationTools.ts";
import type { ApprovalMode } from "./approvalPolicy.ts";
import { annotateCredentialOnceUse, normalizeSiteOrigin } from "./credentialRequests.ts";

export const SIGN_IN_TOOL = "pc_sign_in";

/** The pair a fill needs, as it travels as one value through one read. */
export interface SitePair { username: string; password: string }

/** Pure. A stored pair read back (get_site_credential returns the JSON
 *  text the write RPCs stored). Anything that is not a JSON object
 *  with a non-empty username and password is not a pair. */
export function parseSitePair(text: unknown): SitePair | null {
  if (typeof text !== "string" || !text) return null;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const { username, password } = v as { username?: unknown; password?: unknown };
  if (typeof username !== "string" || !username) return null;
  if (typeof password !== "string" || !password) return null;
  return { username, password };
}

/** Pure. The one row a use-once take returns, read as a site pair:
 *  the stash stored the pair shape for the site class, and the take
 *  hands back its two fields separately. */
export function pairFromTakeRow(row: unknown): SitePair | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const { username, value } = row as { username?: unknown; value?: unknown };
  if (typeof username !== "string" || !username) return null;
  if (typeof value !== "string" || !value) return null;
  return { username, password: value };
}

/** A Space's site_credentials row for one origin, secret or not. */
export interface SiteCredentialRow { id: string; username: string; secret_id: string | null }

/**
 * Where a sign-in would land, resolved from server-side facts: the
 * runner's own report of its page, the Space's stored row for that
 * origin, and any one-time stash waiting for it.
 */
export interface SignInTarget {
  /** The runner-reported current page origin, canonicalized. */
  origin: string;
  /** The page URL the runner reported (display data for messages). */
  pageUrl: string;
  /** The model's claimed origin did not equal the page's — release
   *  is refused on this leg alone, whatever else is true. */
  claimMismatch: boolean;
  /** The stored credential for this origin (a row whose secret
   *  stands), or null. */
  stored: { id: string; username: string } | null;
  /** The stored row's username even when its secret is gone — the
   *  capture hint for the wall ask. */
  storedUsername: string | null;
  /** A use-once request whose stash waits for this origin. */
  onceRequestId: string | null;
  /** The probe page itself presents a login form. */
  wall: boolean;
}

/** Pure. The model's claimed origin in a pc_sign_in call, read
 *  strictly: an absent claim is no claim; a present one must
 *  canonicalize, or it counts as a mismatch, never as silence. */
export function claimOf(input: Record<string, unknown>): { claim: string | null; invalid: boolean } {
  const raw = input.origin;
  if (typeof raw !== "string" || !raw.trim()) return { claim: null, invalid: false };
  const claim = normalizeSiteOrigin(raw);
  return claim ? { claim, invalid: false } : { claim: null, invalid: true };
}

/** Pure. Assemble the target from the probe and the two lookups. */
export function signInTarget(args: {
  probeUrl: string;
  probeWall: boolean;
  input: Record<string, unknown>;
  row: SiteCredentialRow | null;
  onceRequestId: string | null;
}): SignInTarget | null {
  const origin = normalizeSiteOrigin(args.probeUrl);
  if (!origin) return null;
  const { claim, invalid } = claimOf(args.input);
  return {
    origin,
    pageUrl: args.probeUrl,
    claimMismatch: invalid || (claim !== null && claim !== origin),
    stored: args.row?.secret_id ? { id: args.row.id, username: args.row.username } : null,
    storedUsername: args.row?.username ?? null,
    onceRequestId: args.onceRequestId,
    wall: args.probeWall,
  };
}

/**
 * Pure. The D6 decision: does this sign-in wait for a person? Only
 * the ask mode holds a sign-in at all, only a stored credential can
 * be held (a stash is its own consent), only when every origin leg
 * agrees (a mismatch is a refusal, not an ask), and only the first
 * time — a credential with a 'used' row in the audit has been signed
 * in with before, and the trail is the memory.
 */
export function signInNeedsAsk(args: { mode: ApprovalMode; target: SignInTarget | null; usedBefore: boolean }): boolean {
  if (args.mode !== "ask") return false;
  if (!args.target || args.target.claimMismatch || !args.target.stored) return false;
  return !args.usedBefore;
}

/** Pure. The D6 card: the action as one line — 「{origin} にサインイン」 —
 *  and exactly the fields the decision turns on: where, and as whom.
 *  The destination is the origin itself (the card's lock), and
 *  nothing here is rememberable: the audit trail, not a standing
 *  rule, is what makes the next sign-in free. */
export function signInDisplayFor(call: ToolCall, args: { origin: string; username: string; runnerName: string }): ApprovalDisplay {
  return {
    id: call.id, integration: args.runnerName, operation: "sign_in",
    destination: args.origin, detail: null, effect: "write", critical: null, rememberable: false,
    title: `${args.origin} にサインイン`,
    fields: [
      { label: "Origin", value: args.origin },
      { label: "Username", value: args.username },
    ],
    preview: null, askReason: null,
  };
}

/** The sign-in call kind's step title: the origin, and nothing else —
 *  no field names, no values (design §3.5, closing the pc_type leak
 *  for this path). */
export function signInStepTitle(origin: string): string {
  return `PC: サインイン ${origin}`;
}

/** What the runner's sign-in answer says happened, in codes the
 *  server words itself — the runner's free text never reaches the
 *  run record or the model on this path. */
export type SignInOutcomeCode = "signed_in" | "still_walled" | "page_moved" | "no_form" | "no_pair" | "error";

const OUTCOME_CODES: readonly string[] = ["still_walled", "page_moved", "no_form", "no_pair", "error"];

/** Pure. A runner result read as a sign-in outcome. A result that
 *  does not carry the sign-in shape at all is an error outcome. */
export function signInOutcomeOf(result: unknown): { ok: boolean; code: SignInOutcomeCode } {
  const r = result && typeof result === "object" ? result as { signed_in?: unknown; reason?: unknown } : {};
  if (r.signed_in === true) return { ok: true, code: "signed_in" };
  if (r.signed_in === false && typeof r.reason === "string" && OUTCOME_CODES.includes(r.reason)) {
    return { ok: false, code: r.reason as SignInOutcomeCode };
  }
  return { ok: false, code: "error" };
}

/** Pure. Whether a runner page result reports a login form standing
 *  on it, and on which origin — the runner's own detection, carried
 *  in its snapshot. */
export function loginWallOf(result: unknown): string | null {
  const r = result && typeof result === "object" ? result as { login_wall?: unknown } : {};
  if (typeof r.login_wall !== "string" || !r.login_wall) return null;
  return normalizeSiteOrigin(r.login_wall);
}

// ── The record: lookups and audit the driver composes ────────────────

/** The Space's site_credentials row for one origin (any state). */
export async function siteCredentialRowForOrigin(
  admin: SupabaseClient, spaceId: string, origin: string,
): Promise<SiteCredentialRow | null> {
  const { data } = await admin.from("site_credentials")
    .select("id, username, secret_id")
    .eq("activity_space_id", spaceId).eq("origin", origin)
    .limit(1);
  return ((data ?? [])[0] as SiteCredentialRow | undefined) ?? null;
}

/** The newest use-once site request whose stash waits for an origin. */
export async function onceRequestForOrigin(
  admin: SupabaseClient, spaceId: string, origin: string,
): Promise<string | null> {
  const { data } = await admin.from("credential_requests")
    .select("id")
    .eq("activity_space_id", spaceId).eq("kind", "site_login").eq("origin", origin).eq("status", "used_once")
    .order("decided_at", { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as { id: string } | undefined)?.id ?? null;
}

/** Whether a stored credential has ever been signed in with — the
 *  audit trail is D6's memory, so this reads credential_uses and
 *  nothing else. */
export async function hasSignInUse(admin: SupabaseClient, siteCredentialId: string): Promise<boolean> {
  const { data } = await admin.from("credential_uses")
    .select("id")
    .eq("credential_kind", "site").eq("site_credential_id", siteCredentialId).eq("event", "used")
    .limit(1);
  return (data ?? []).length > 0;
}

export type SignInAuditEvent = "used" | "release_refused" | "test_failed";

/**
 * One audit row for a sign-in spend, a refused release, or a
 * credential the wall refused (test_failed, the audit's share of
 * the §3.6 reauth fact). The writers are this function and the take
 * RPC; every field is an id, an origin, or a fixed code — no code
 * path here can write a value, because none is ever passed in.
 */
export async function recordSignInUse(
  admin: SupabaseClient,
  args: {
    spaceId: string; runId: string; event: SignInAuditEvent; origin: string; detail: string;
    credential: { kind: "site"; id: string } | { kind: "once" } | null;
  },
): Promise<void> {
  await admin.from("credential_uses").insert({
    activity_space_id: args.spaceId,
    credential_kind: args.credential?.kind ?? "once",
    site_credential_id: args.credential?.kind === "site" ? args.credential.id : null,
    event: args.event,
    run_id: args.runId,
    origin: args.origin,
    detail: args.detail,
  });
}

/**
 * The take RPC writes the once credential's 'used' row itself (it is
 * the moment of the spend) but cannot know the run; annotate that
 * row with the run that spent it. The annotation itself lives with
 * the take helpers (credentialRequests.ts) — this name is the
 * sign-in path's handle on it.
 */
export async function annotateOnceUseRun(
  admin: SupabaseClient, requestId: string, runId: string,
): Promise<void> {
  await annotateCredentialOnceUse(admin, requestId, runId);
}

/** A sign-in's verdict on the credential, in the last_test shape the
 *  needs computation already reads for connections: a rejected
 *  password is 'auth_failed', which is what makes the credential a
 *  reauth need (§3.6). */
export async function setSiteCredentialLastTest(
  admin: SupabaseClient, siteCredentialId: string, lastTest: Record<string, unknown>,
): Promise<void> {
  await admin.from("site_credentials").update({ last_test: lastTest }).eq("id", siteCredentialId);
}

/**
 * A wall that turned out to be passed (the sign-in succeeded) takes
 * its pending asks with it: a capture card still offering a form for
 * a site the run is now inside would ask for a secret the work no
 * longer needs. The asks lapse as superseded — answered by events,
 * not by a person.
 */
export async function supersedePendingSiteRequests(
  admin: SupabaseClient, spaceId: string, origin: string,
): Promise<void> {
  await admin.from("credential_requests")
    .update({ status: "superseded" })
    .eq("activity_space_id", spaceId).eq("kind", "site_login").eq("origin", origin).eq("status", "pending");
}
