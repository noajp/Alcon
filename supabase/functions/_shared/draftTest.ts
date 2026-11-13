// The draft test (G4 §4.4): materialise the candidate as a disabled
// integration row — a fresh row, or a clone of the live row an update
// draft targets — then run every command against it. Reads run for
// real through the same requestFor + callHttp path a live call takes;
// writes are NEVER executed, only assembled. Auth gets a negative
// control: a read that also succeeds without the credential proves
// nothing, so the round settles as auth_unverified and the owner
// decides. A round that passes freezes the tested content and its
// hashes on the draft; activation later compares against exactly that.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseManifest, requestFor, type Manifest } from "./connectorManifest.ts";
import { callHttp, isSafeEndpoint, resolvesToPublic, type IntegrationRow } from "./integrationClient.ts";
import {
  classifyCommandOutcome, draftContentHash, draftContentOf, draftPermissionHash, draftReviewExpiresAt,
  draftStructureHash, primaryFailureClass, withLimitFloor, MAX_DRAFT_TEST_ROUNDS,
  type DraftFailureClass,
} from "./connectorDraft.ts";
import { deleteStagedRow, loadDraft, transitionDraft, type DraftRow } from "./integrationDrafts.ts";

export interface DraftCommandResult {
  command: string;
  effect: "read" | "write";
  executed: boolean;
  status: number | null;
  failure: string | null;
  detail: string;
  limitedBy: string | null;
}

export interface DraftTestRound {
  at: string;
  outcome: "passed" | "failed" | "unverifiable" | "auth_unverified";
  authVerified: boolean;
  control: string | null;
  results: DraftCommandResult[];
}

interface StagedRow extends IntegrationRow {
  activity_space_id: string;
  secret_id: string | null;
  last_test: unknown;
}

const STAGED_COLUMNS =
  "id, activity_space_id, preset, kind, name, description, endpoint, auth_type, auth_header, secret_id, delegation, enabled, manifest, guide, last_test";

async function loadStagedRow(admin: SupabaseClient, rowId: string): Promise<StagedRow | null> {
  const { data } = await admin.from("integrations").select(STAGED_COLUMNS).eq("id", rowId).maybeSingle();
  return (data as StagedRow | null) ?? null;
}

/** Strips anything that looks like the secret from a stored detail. */
function scrub(message: string, secret: string | null): string {
  const text = String(message).slice(0, 300);
  return secret && secret.length >= 4 ? text.split(secret).join("•••") : text;
}

/**
 * The staged row for a draft: created (or refreshed to the current
 * candidate) on demand. An update draft's staging is a clone of the
 * live row — the original is never the test surface — and the clone
 * receives the original's credential through the service-role-only
 * copy RPC, so the test authenticates as the real connection would.
 */
export async function materializeDraft(
  admin: SupabaseClient, draft: DraftRow,
): Promise<{ row: StagedRow } | { error: string }> {
  if (!draft.endpoint || !draft.manifest) return { error: "候補がまだありません" };
  const fields = {
    name: draft.name,
    endpoint: draft.endpoint,
    auth_type: draft.auth_type ?? "none",
    auth_header: draft.auth_header,
    manifest: draft.manifest,
    guide: draft.guide,
  };
  if (draft.materialized_integration_id) {
    const existing = await loadStagedRow(admin, draft.materialized_integration_id);
    if (existing) {
      await admin.from("integrations").update({ ...fields, enabled: false, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      return { row: (await loadStagedRow(admin, existing.id)) ?? existing };
    }
  }
  let base: Record<string, unknown> = {
    activity_space_id: draft.activity_space_id,
    preset: "ai-drafted",
    kind: "http",
    description: null,
    delegation: "approve_each",
    created_by: draft.created_by,
  };
  if (draft.target_integration_id) {
    const { data: target } = await admin.from("integrations")
      .select("kind, description, icon, delegation").eq("id", draft.target_integration_id).maybeSingle();
    if (target) {
      base = {
        ...base,
        kind: (target as { kind: string }).kind,
        description: (target as { description: string | null }).description,
        icon: (target as { icon: string | null }).icon,
        delegation: (target as { delegation: string }).delegation,
      };
    }
  }
  const { data: created, error } = await admin.from("integrations")
    .insert({ ...base, ...fields, enabled: false })
    .select(STAGED_COLUMNS).single();
  if (error || !created) return { error: `素材化できませんでした: ${error?.message ?? "unknown"}` };
  const row = created as unknown as StagedRow;
  if (draft.target_integration_id) {
    // Best-effort: no secret on the original simply means the clone has
    // none either (the RPC answers false, not an error).
    await admin.rpc("copy_integration_secret", {
      p_from_id: draft.target_integration_id, p_to_id: row.id,
    }).then(() => {}, () => {});
  }
  await admin.from("integration_drafts")
    .update({ materialized_integration_id: row.id, updated_at: new Date().toISOString() })
    .eq("id", draft.id);
  draft.materialized_integration_id = row.id;
  const fresh = await loadStagedRow(admin, row.id);
  return { row: fresh ?? row };
}

/** The stored rounds so far (the draft's evidence; malformed reads as none). */
export function draftRounds(draft: DraftRow): DraftTestRound[] {
  return Array.isArray(draft.test_results) ? draft.test_results as DraftTestRound[] : [];
}

/** A round in the drafter's words, for the revision loop and the dialog. */
export function summarizeRound(round: DraftTestRound): string {
  const lines = round.results.map((r) => {
    if (!r.executed) return `- ${r.command}（書き込み）: 実行せず組み立てのみ検証${r.failure ? ` — ${r.failure}: ${r.detail}` : " — 問題なし"}`;
    return `- ${r.command}: ${r.failure ? `${r.failure}（HTTP ${r.status ?? "—"}） ${r.detail}` : `成功（HTTP ${r.status ?? "—"}）`}`;
  });
  const head = round.outcome === "passed" ? "テストは通りました。"
    : round.outcome === "auth_unverified" ? "読み取りは成功しましたが、認証なしでも同じ応答が返り、認証を確認できませんでした。"
    : round.outcome === "unverifiable" ? "実行できる読み取りが無く、認証も疎通も確かめられませんでした。"
    : "テストで落ちました。";
  return `${head}\n${lines.join("\n")}${round.control ? `\n認証の対照確認: ${round.control}` : ""}`;
}

async function runOne(
  row: StagedRow, secret: string | null, manifest: Manifest,
  commandName: string, testInputs: Record<string, Record<string, unknown>>,
): Promise<{ result: DraftCommandResult; body: string | null }> {
  const command = manifest.commands.find((c) => c.name === commandName)!;
  const provided = testInputs[commandName] ?? {};
  if (command.effect === "write") {
    // Assembled, never sent — the invariant of §4.4. The assembly proves
    // the path resolves and the required inputs can be satisfied.
    const req = requestFor(command, provided);
    if ("error" in req) {
      const missing = /が必要です/.test(req.error);
      return {
        result: {
          command: commandName, effect: "write", executed: false, status: null,
          failure: missing ? "schema_mismatch" : "manifest_invalid",
          detail: scrub(req.error, secret), limitedBy: null,
        },
        body: null,
      };
    }
    return {
      result: { command: commandName, effect: "write", executed: false, status: null, failure: null, detail: "組み立てのみ検証しました", limitedBy: null },
      body: null,
    };
  }
  const { input, limitedBy } = withLimitFloor(command.input as Record<string, unknown>, provided);
  const req = requestFor(command, input);
  if ("error" in req) {
    return {
      result: {
        command: commandName, effect: "read", executed: false, status: null,
        failure: "schema_mismatch", detail: scrub(req.error, secret), limitedBy,
      },
      body: null,
    };
  }
  try {
    const res = await callHttp(row, secret, req as unknown as Record<string, unknown>);
    const status = Number(res.text.match(/^HTTP (\d{3})/)?.[1] ?? 0) || null;
    const body = res.text.replace(/^HTTP \d{3}\n/, "");
    const failure = classifyCommandOutcome({ status, error: null });
    return {
      result: {
        command: commandName, effect: "read", executed: true, status,
        failure, detail: failure ? scrub(body, secret) : "", limitedBy,
      },
      body,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      result: {
        command: commandName, effect: "read", executed: true, status: null,
        failure: classifyCommandOutcome({ status: null, error: message }) ?? "unreachable",
        detail: scrub(message, secret), limitedBy,
      },
      body: null,
    };
  }
}

/**
 * One test round against the staged row. The caller has already moved
 * the draft to `testing`. Settles the draft: passed → awaiting_review
 * (tested content frozen, owners notified); auth_unverified /
 * unverifiable → stays in testing for the owner's call; failed → back
 * to drafting, or to failed at the round cap.
 */
export async function runDraftTestRound(
  admin: SupabaseClient, draft: DraftRow,
): Promise<{ round: DraftTestRound } | { error: string }> {
  const staged = draft.materialized_integration_id ? await loadStagedRow(admin, draft.materialized_integration_id) : null;
  if (!staged) return { error: "素材化した行がありません" };
  const { manifest, errors } = parseManifest(draft.manifest);
  if (errors.length || !manifest.commands.length) {
    return { error: `manifest を読めません: ${errors.join(" / ") || "command がありません"}` };
  }
  const { data: secretData } = await admin.rpc("get_integration_secret", { p_integration_id: staged.id });
  const raw = typeof secretData === "string" && secretData.length > 0 ? secretData : null;
  const secret = staged.auth_type === "none" ? null : raw;

  const at = new Date().toISOString();
  const results: DraftCommandResult[] = [];
  const bodies = new Map<string, string | null>();

  // Endpoint guard first: a blocked address fails every command alike.
  let guardFailure: DraftFailureClass | null = null;
  if (!isSafeEndpoint(staged.endpoint)) guardFailure = "blocked";
  else if (!(await resolvesToPublic(staged.endpoint))) guardFailure = "blocked";

  for (const command of manifest.commands) {
    if (guardFailure) {
      results.push({
        command: command.name, effect: command.effect, executed: false, status: null,
        failure: guardFailure, detail: "endpoint がガードで拒否されました", limitedBy: null,
      });
      continue;
    }
    const { result, body } = await runOne(staged, secret, manifest, command.name, draft.test_inputs ?? {});
    results.push(result);
    bodies.set(command.name, body);
  }

  const reads = results.filter((r) => r.effect === "read");
  const failures = results.map((r) => r.failure as DraftFailureClass | null);
  const primary = primaryFailureClass(failures);
  const authNeeded = staged.auth_type !== "none";
  let authVerified = !authNeeded;
  let control: string | null = null;
  let outcome: DraftTestRound["outcome"];

  if (primary) {
    outcome = "failed";
  } else if (authNeeded && reads.length === 0) {
    outcome = "unverifiable";
    control = "実行できる読み取り command が無いため、認証を確かめられませんでした。";
  } else if (authNeeded) {
    // The negative control: the first read that succeeded with the
    // credential, once more without it. An unchanged answer means the
    // credential proved nothing (a public API), or the check itself
    // could not run — either way, unverified (fail-closed).
    const okRead = reads.find((r) => r.executed && !r.failure)!;
    const command = manifest.commands.find((c) => c.name === okRead.command)!;
    const { input } = withLimitFloor(command.input as Record<string, unknown>, (draft.test_inputs ?? {})[okRead.command] ?? {});
    const req = requestFor(command, input);
    if ("error" in req) {
      outcome = "auth_unverified";
      control = "対照確認の組み立てに失敗したため、認証を確認できませんでした。";
    } else {
      try {
        const res = await callHttp(staged, null, req as unknown as Record<string, unknown>);
        const status = Number(res.text.match(/^HTTP (\d{3})/)?.[1] ?? 0) || null;
        const body = res.text.replace(/^HTTP \d{3}\n/, "");
        if (status === okRead.status && body === (bodies.get(okRead.command) ?? null)) {
          outcome = "auth_unverified";
          control = `「${okRead.command}」は認証なしでも同じ応答（HTTP ${status ?? "—"}）を返しました。公開 API のため認証を確認できません。`;
        } else {
          authVerified = true;
          outcome = "passed";
          control = `「${okRead.command}」は認証なしでは応答が変わりました（HTTP ${status ?? "—"}）。認証が効いています。`;
        }
      } catch {
        outcome = "auth_unverified";
        control = "対照確認の呼び出し自体が失敗したため、認証を確認できませんでした。";
      }
    }
  } else {
    outcome = "passed";
  }

  const round: DraftTestRound = { at, outcome, authVerified, control, results };
  const rounds = [...draftRounds(draft), round];
  const lastTest = {
    ok: outcome === "passed", at,
    code: outcome === "passed" ? "connected"
      : primary === "auth_failed" || outcome === "auth_unverified" ? "auth_failed"
      : primary === "blocked" ? "blocked"
      : primary === "unreachable" ? "unreachable"
      : "http_error",
    detail: "",
  };
  await admin.from("integrations").update({ last_test: lastTest, updated_at: at }).eq("id", staged.id);

  if (outcome === "passed") {
    await settleDraftToReview(admin, draft, rounds);
  } else if (outcome === "failed") {
    const failureClass = primary ?? "server_error";
    if (rounds.length >= MAX_DRAFT_TEST_ROUNDS) {
      await transitionDraft(admin, draft, "failed", { test_results: rounds, failure_class: failureClass });
      await deleteStagedRow(admin, draft);
    } else {
      await transitionDraft(admin, draft, "drafting", { test_results: rounds, failure_class: failureClass });
    }
  } else {
    // auth_unverified / unverifiable: the evidence is in, the call is a
    // person's. The draft stays in testing and the round is recorded.
    await admin.from("integration_drafts").update({
      test_results: rounds, failure_class: outcome, updated_at: at,
    }).eq("id", draft.id).eq("status", "testing");
  }
  const fresh = await loadDraft(admin, draft.id);
  if (fresh) Object.assign(draft, fresh);
  return { round };
}

/**
 * Freeze what was tested and put the draft in front of the owners:
 * the tested content and its three hashes, the review deadline, and an
 * Inbox notification per owner (§4.9 — a review nobody hears about is
 * the Copilot-approval hole over again). Used by a passing round and by
 * the owner's "review it anyway" on an unverifiable round alike; the
 * round's outcome stays in the evidence either way.
 */
export async function settleDraftToReview(
  admin: SupabaseClient, draft: DraftRow, rounds?: DraftTestRound[],
): Promise<boolean> {
  const content = draftContentOf({
    name: draft.name, endpoint: draft.endpoint ?? "", auth_type: draft.auth_type ?? "none",
    auth_header: draft.auth_header, manifest: draft.manifest, guide: draft.guide,
  });
  const [testedHash, structureHash, permissionHash] = await Promise.all([
    draftContentHash(content), draftStructureHash(content), draftPermissionHash(content),
  ]);
  const ok = await transitionDraft(admin, draft, "awaiting_review", {
    test_results: rounds ?? draftRounds(draft),
    tested_content: content as unknown as Record<string, unknown>,
    tested_hash: testedHash,
    tested_structure_hash: structureHash,
    tested_permission_hash: permissionHash,
    failure_class: null,
    expires_at: draftReviewExpiresAt(new Date()),
  });
  if (!ok) return false;
  const { data: owners } = await admin.from("activity_space_members")
    .select("user_id").eq("activity_space_id", draft.activity_space_id).eq("role", "owner");
  for (const owner of (owners ?? []) as { user_id: string }[]) {
    await admin.from("notifications").insert({
      recipient_id: owner.user_id, actor_name: "Clayware Agent", kind: "approval_requested",
      integration_draft_id: draft.id,
      title: "接続の審査が待っています",
      body: `「${draft.name}」の接続ドラフトがテストを終えました。有効化する前に内容を確認してください。`,
    }).then(() => {}, () => {});
  }
  return true;
}
