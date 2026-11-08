// integration-draft-test — the command-level test of an AI-drafted
// connection (G4 §4.4), run from the draft's review screen after the
// owner enters the credential. The drafting driver runs the same round
// in-process when no credential is missing; this function is the path
// when a person had to act first (and the re-test path after that).
//
// Request (POST JSON, Authorization: Bearer <the person's Supabase JWT>):
//   { draftId }                  run one test round
//   { draftId, settle: "review" }  an unverifiable / auth-unverified
//                                draft goes to review on the owner's
//                                call, with the evidence as it stands
// Response: { status, round? }
//
// Who may test: a Space owner (checked with the caller's JWT, as in
// integration-test). Only then does the service role read the staged
// row's secret from Vault. Writes in the draft are never executed —
// the shared round (draftTest.ts) assembles them only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadDraft } from "../_shared/integrationDrafts.ts";
import { draftRounds, runDraftTestRound, settleDraftToReview } from "../_shared/draftTest.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "server env not configured" }, 500);

  let body: { draftId?: unknown; settle?: unknown };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const draftId = typeof body.draftId === "string" ? body.draftId : "";
  if (!draftId) return json({ error: "draftId is required" }, 400);

  const jwt = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!jwt || jwt === anonKey) return json({ error: "sign-in required" }, 401);

  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authErr } = await userDb.auth.getUser(jwt);
  if (authErr || !user) return json({ error: "session expired or invalid" }, 401);

  // Visible to the caller (RLS: Space member)…
  const { data: visible } = await userDb
    .from("integration_drafts").select("id, activity_space_id")
    .eq("id", draftId).maybeSingle();
  if (!visible) return json({ error: "draft not found" }, 404);

  // …and the caller owns that Space.
  const { data: membership } = await userDb
    .from("activity_space_members").select("role")
    .eq("activity_space_id", visible.activity_space_id)
    .eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") return json({ error: "only Space owners can test drafts", code: "not_owner" }, 403);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const draft = await loadDraft(admin, draftId);
  if (!draft) return json({ error: "draft not found" }, 404);
  if (draft.status !== "testing") {
    return json({ error: `このドラフトは今テストできません（状態: ${draft.status}）` }, 409);
  }

  if (body.settle === "review") {
    const rounds = draftRounds(draft);
    const last = rounds[rounds.length - 1];
    if (!last || (last.outcome !== "auth_unverified" && last.outcome !== "unverifiable")) {
      return json({ error: "審査へ進めるのは、認証を確認できなかったテストの後だけです" }, 409);
    }
    const ok = await settleDraftToReview(admin, draft, rounds);
    return ok ? json({ status: "awaiting_review" }) : json({ error: "could not settle the draft" }, 500);
  }

  const tested = await runDraftTestRound(admin, draft);
  if ("error" in tested) return json({ error: tested.error }, 500);
  const fresh = await loadDraft(admin, draftId);
  return json({ status: fresh?.status ?? draft.status, round: tested.round });
});
