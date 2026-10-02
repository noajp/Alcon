// integration-test — checks that a Space's external service answers with the
// stored credential (ADR 0027). Settings › Integrations calls it from the
// 「接続テスト」 button.
//
// Request (POST JSON, Authorization: Bearer <the person's Supabase JWT>):
//   { integrationId }
// Response:
//   { last_test: { ok, at, detail, tools?, tool_count?, status? } }
//     mcp   initialize + tools/list; tool_count and up to 20 tools
//           ({ name, readOnly }).
//     http  GET on the base URL. Any response below 500 other than 401 / 403
//           counts as reachable; status is the HTTP status.
//
// Who may test: a Space owner. The integration must be visible to the caller
// (RLS: Space member) and the caller must hold the owner role in that Space —
// both checked with the caller's JWT. Only then does the service role read the
// secret from Vault (get_integration_secret) and write last_test back. The
// secret goes only into the outgoing request's header; it is never returned,
// logged, or put in last_test.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { McpSession, callHttp, isSafeEndpoint, type IntegrationRow } from "../_shared/integrationClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_LISTED_TOOLS = 20;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

interface LastTest {
  ok: boolean;
  at: string;
  detail: string;
  tools?: { name: string; readOnly: boolean }[];
  tool_count?: number;
  status?: number;
}

/** Strips anything that looks like the secret from an error before it is stored. */
function scrub(message: string, secret: string | null): string {
  const text = message.slice(0, 300);
  return secret && secret.length >= 4 ? text.split(secret).join("•••") : text;
}

async function runTest(row: IntegrationRow, secret: string | null): Promise<LastTest> {
  const at = new Date().toISOString();
  if (!isSafeEndpoint(row.endpoint)) {
    return { ok: false, at, detail: "接続先は https の公開ホストに限られます。" };
  }
  try {
    if (row.kind === "mcp") {
      const session = new McpSession(row, secret);
      await session.initialize();
      const tools = await session.listTools();
      return {
        ok: true,
        at,
        detail: `${tools.length} 個のツールを取得しました。`,
        tool_count: tools.length,
        tools: tools.slice(0, MAX_LISTED_TOOLS).map((t) => ({ name: t.name, readOnly: t.readOnly })),
      };
    }
    const res = await callHttp(row, secret, { method: "GET", path: "" });
    const status = Number(res.text.match(/^HTTP (\d{3})/)?.[1] ?? 0);
    if (status === 401 || status === 403) return { ok: false, at, status, detail: `認証に失敗しました（HTTP ${status}）。` };
    if (!status || status >= 500) return { ok: false, at, status, detail: `接続先がエラーを返しました（HTTP ${status || "?"}）。` };
    return { ok: true, at, status, detail: `接続できました（HTTP ${status}）。` };
  } catch (e) {
    const message = e instanceof Error ? (e.name === "AbortError" ? "応答がありませんでした（タイムアウト）。" : e.message) : String(e);
    return { ok: false, at, detail: scrub(message, secret) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "server env not configured" }, 500);

  let body: { integrationId?: unknown };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const integrationId = typeof body.integrationId === "string" ? body.integrationId : "";
  if (!integrationId) return json({ error: "integrationId is required" }, 400);

  const jwt = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!jwt || jwt === anonKey) return json({ error: "sign-in required" }, 401);

  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authErr } = await userDb.auth.getUser(jwt);
  if (authErr || !user) return json({ error: "session expired or invalid" }, 401);

  // Visible to the caller (RLS: Space member)…
  const { data: visible, error: readErr } = await userDb
    .from("integrations")
    .select("id, activity_space_id, kind, name, description, endpoint, auth_type, auth_header, delegation")
    .eq("id", integrationId)
    .maybeSingle();
  if (readErr) return json({ error: "could not read the integration" }, 500);
  if (!visible) return json({ error: "integration not found" }, 404);

  // …and the caller owns that Space.
  const { data: membership } = await userDb
    .from("activity_space_members")
    .select("role")
    .eq("activity_space_id", visible.activity_space_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership?.role !== "owner") return json({ error: "Space のオーナーだけが接続テストを実行できます。" }, 403);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: secretData, error: secretErr } = await admin.rpc("get_integration_secret", { p_integration_id: integrationId });
  if (secretErr) return json({ error: "could not read the credential" }, 500);
  const secret = typeof secretData === "string" && secretData.length > 0 ? secretData : null;

  const row = visible as IntegrationRow & { activity_space_id: string };
  const lastTest = await runTest(row, secret);

  const { error: writeErr } = await admin.from("integrations").update({ last_test: lastTest }).eq("id", integrationId);
  if (writeErr) return json({ error: "could not save the result", last_test: lastTest }, 500);

  return json({ last_test: lastTest });
});
