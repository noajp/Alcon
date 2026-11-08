// The credential audit's server writers for connection credentials
// (secure-login PR4, design §3.8): the rows credential_uses gains
// when a connection's credential is spent or proven bad. The table's
// other writers are the storage RPCs (stored / replaced / deleted),
// the decline RPC, the once-take RPC and the runner's sign-in path
// (signIn.ts) — this module is the integration class's share.
//
// Every row is ids and fixed codes only: no caller passes a value,
// a value's length, or text a value passed through, because none is
// ever in scope here. And every write is best-effort by contract:
// an audit failure must never fail the call the credential served,
// so these functions swallow their own errors — the trail is a
// record of the work, never a gate on it.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * One 'used' row for a connection whose binding resolved with a
 * real credential in hand. Written once per binding (the design's
 * granularity: a binding is per-request lazy, so the log stays at
 * run granularity and off the per-call hot path) and once per eager
 * session a driver opens with the credential at assembly. A binding
 * that resolved empty — no credential stored, auth_type none —
 * spent nothing and writes nothing; a binding that spent a
 * use-once stash writes nothing either, because the take RPC
 * already wrote that spend's row (kind 'once') in the taking.
 */
export async function recordIntegrationUse(
  admin: SupabaseClient,
  args: { spaceId: string; integrationId: string; runId: string | null },
): Promise<void> {
  try {
    await admin.from("credential_uses").insert({
      activity_space_id: args.spaceId,
      credential_kind: "integration",
      integration_id: args.integrationId,
      event: "used",
      run_id: args.runId,
    });
  } catch { /* the audit never fails the work */ }
}

/**
 * One 'test_failed' row for a connection whose credential was
 * refused — the audit twin of the last_test write each caller
 * already makes at the same moment (integration-test's verdict, a
 * run's assembly or call refusal). detail carries the fixed code
 * only: 'auth_failed'. This is the stream the heartbeat's repeated
 * -auth-failure signal counts, and the row the audit surface shows
 * beside the connection's honest state.
 */
export async function recordIntegrationAuthFailure(
  admin: SupabaseClient,
  args: { spaceId: string; integrationId: string },
): Promise<void> {
  try {
    await admin.from("credential_uses").insert({
      activity_space_id: args.spaceId,
      credential_kind: "integration",
      integration_id: args.integrationId,
      event: "test_failed",
      detail: "auth_failed",
    });
  } catch { /* the audit never fails the work */ }
}
