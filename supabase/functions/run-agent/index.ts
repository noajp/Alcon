// run-agent — Alcon's agent engine (ADR 0027).
//
// Executes an Element's task on behalf of the person who started it: plans,
// works through the board and the Space's integrations, stops for that
// person's approval before external writes, and ends with a report on the
// Element. The task may be to produce something (save_artifact) or to do
// something (reply to 100 emails); either way the report and the action log
// are the evidence.
//
// Requests (POST JSON, Authorization: Bearer <the person's Supabase JWT>):
//   { runId }                                   start a queued run
//   { runId, resume: true }                     resume a paused run
//   { runId, decision: { actionId, approve, inputHash, note? } }
//                                               decide on a pending approval
//   { runId, continue: true }                   internal: the next slice of a
//                                               long run (self-invoked)
//   { ping: true }                              runtime check
//
// Every board / artifact / integration-listing call runs with the person's
// JWT, so RLS decides what the agent may touch. The service role is used
// only for the run's own bookkeeping (status, transcript, usage, steps,
// actions) and to read integration secrets from Vault — never to reach data
// the person could not reach. The JWT is never stored: a long run forwards it
// to its own continuation in memory, and a run that outlives the session
// pauses until the person opens it again.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.110.0";
import { runBoardTool, errorMessage, type BoardActor, type ToolDef } from "../_shared/boardTools.ts";
import { runStrategyTool } from "../_shared/strategyTools.ts";
import { AGENT_MODELS, DEFAULT_AGENT_MODEL, costAt, type ModelUsage } from "../_shared/aiPricing.ts";
import {
  McpSession, callHttp, httpIsRead, HTTP_REQUEST_SCHEMA, isSafeEndpoint, pointsAtAlcon, resolveCredential, type IntegrationRow, type RemoteTool,
} from "../_shared/integrationClient.ts";
import { isGoogleDriveRow } from "../_shared/googleOAuth.ts";
import { fetchPull, pullUrlsIn, upsertCodeChange, withGithubToken } from "../_shared/github.ts";
import { DRIVE_TOOLS, driveOperationLabel, runDriveTool } from "../_shared/googleDrive.ts";
import { approvalSummary, baseAgentTools, baseKindOf, integrationPrefix, isStrategyTool, INTEGRATION_SEPARATOR, webSteps, webTools } from "./agentTools.ts";
import { systemPrompt, taskMessage, type TaskContext } from "./context.ts";
import { resolveAgentConfig, type DomainConfigRow, type WorkerConfigRow } from "./agentConfig.ts";
import { readVerdict, VERDICT_SCHEMA, VERIFY_SYSTEM, verifyPrompt } from "./verify.ts";
import { delegationOf, readyDownstream, type AdvanceCandidate } from "./advance.ts";
import {
  runLoop, appendDecisionResults, canonicalCalls,
  type LoopState, type ToolCall, type ToolKind, type ToolResult, type PendingApproval, type FinishPayload, type Msg,
} from "./loop.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_TURNS_PER_SLICE = 14;
const SLICE_MS = 110_000;          // stay well inside the platform's wall clock
const MAX_CONTINUATIONS = 30;
const MAX_TOOLS = 120;
/** A person's own monthly budget for runs on Elements outside any Space. */
const USER_MONTHLY_BUDGET_USD = 20;
/** No single run may spend more than this, whatever the budget left. */
const MAX_RUN_COST_USD = 5;
/** A run that has written no step for this long is stuck; its starter may resume it. */
const STALE_MS = 10 * 60_000;
const SESSION_PAUSE = "セッションの期限が切れたため一時停止しました。Element を開くと続きから再開します。";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}


type SavedPending = PendingApproval & { approved?: boolean; results?: ToolResult[] };
type Transcript = {
  messages: Msg[]; turns: number; nudges: number;
  /** Times the verifier sent a finish back. */
  revisions?: number;
  /** Turns the run may take in all; grows when its starter resumes it. */
  turnBudget?: number;
  /** The tool definitions frozen at the first slice, so later slices send the same prefix. */
  tools?: { name: string; description: string; input_schema: Record<string, unknown> }[];
  pending?: SavedPending;
};
type Run = {
  id: string; element_id: string; domain_id: string | null; worker_id: string | null; status: string;
  mode: string; prompt: string | null; reply_to: string | null; triggered_by: string | null;
  transcript: Transcript | null; step_count: number;
  input_tokens: number; output_tokens: number; cost_usd: number; activity_space_id: string | null;
  continuation_count: number; continuation_token: string | null;
};

/**
 * One integration tool the agent sees. `remote` describes an MCP tool or a
 * typed Drive tool (its readOnly decides read vs write); null is the generic
 * http_request. `drive` marks the Google Drive tools, which run through
 * runDriveTool with `secret` as the access token.
 */
interface IntegrationTool { integration: IntegrationRow; remote: RemoteTool | null; secret: string | null; session: McpSession | null; drive?: boolean }

/** The operation an integration call shows on the approval card and in the log. */
function operationOf(it: IntegrationTool | undefined, input: Record<string, unknown>): string {
  if (it?.drive && it.remote) return driveOperationLabel(it.remote.name, input);
  if (it?.remote) return it.remote.name;
  return `${input.method ?? ""} ${input.path ?? ""}`.trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "server env not configured" }, 500);

  let body: { runId?: string; ping?: boolean; resume?: boolean; continue?: boolean; token?: string; decision?: { actionId?: string; approve?: boolean; inputHash?: string; note?: string } };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }

  if (body.ping) {
    return json({ ok: !!anthropicKey, key_configured: !!anthropicKey, model_default: DEFAULT_AGENT_MODEL, allowed_models: Object.keys(AGENT_MODELS) });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!jwt || jwt === anonKey) return json({ error: "sign-in required" }, 401);
  const runId = body.runId;
  if (!runId) return json({ error: "runId is required" }, 400);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await userDb.auth.getUser(jwt);
  if (!user) {
    // A slice whose session expired pauses the run — only with that slice's
    // own continuation token, so nobody else can pause someone's run.
    if (body.continue && body.token) {
      await admin.from("agent_runs").update({ status: "paused", error: SESSION_PAUSE, continuation_token: null })
        .eq("id", runId).eq("status", "running").eq("continuation_token", body.token);
    }
    return json({ error: "session expired or invalid" }, 401);
  }

  // The run is visible only through its Element (RLS answers that).
  const { data: visibleRun } = await userDb.from("agent_runs").select("id").eq("id", runId).maybeSingle();
  if (!visibleRun) return json({ error: "run not found" }, 404);
  const { data: runRow } = await admin.from("agent_runs").select("*").eq("id", runId).single();
  const run = runRow as Run;
  // The agent acts as the person who started it; only they may drive it.
  if (run.triggered_by !== user.id) return json({ error: "この実行を動かせるのは、実行を始めた人だけです。" }, 403);

  // A decision is checked before the run is touched: a stale or mismatched
  // decision is refused and the run keeps waiting for the right one.
  if (body.decision) {
    const d = body.decision;
    const { data: action } = await admin.from("agent_actions").select("id, status, input_hash").eq("id", d.actionId ?? "").eq("run_id", runId).maybeSingle();
    if (!action || action.status !== "pending" || !run.transcript?.pending) return json({ error: "この承認依頼はもう処理されています。" }, 409);
    if (d.inputHash !== action.input_hash) return json({ error: "承認の内容が提示したものと一致しません。画面を更新してやり直してください。" }, 409);
  }

  // Claim the run atomically for the transition this request makes.
  let claim = admin.from("agent_runs").update({ status: "running", error: null, continuation_token: null }).eq("id", runId);
  if (body.decision) claim = claim.eq("status", "awaiting_approval");
  else if (body.continue) claim = claim.eq("status", "running").eq("continuation_token", body.token ?? "\u0000");
  else if (body.resume) {
    if (run.status === "running") {
      // A stuck run (the platform cut a slice off) may be resumed by its starter.
      const { data: last } = await admin.from("agent_run_steps").select("created_at").eq("run_id", runId).order("idx", { ascending: false }).limit(1).maybeSingle();
      const quietFor = Date.now() - new Date(last?.created_at ?? 0).getTime();
      if (quietFor < STALE_MS) return json({ error: "実行中です。" }, 409);
      claim = claim.eq("status", "running").eq("step_count", run.step_count);
    } else claim = claim.eq("status", "paused");
  } else claim = admin.from("agent_runs").update({ status: "running", error: null, started_at: new Date().toISOString() }).eq("id", runId).eq("status", "queued");
  const { data: claimed } = await claim.select("id").maybeSingle();
  if (!claimed) return json({ error: `この実行は今その操作を受け付けません（${run.status}）。` }, 409);

  const work = execute({ req, run, user: { id: user.id, email: user.email ?? null }, jwt, admin, userDb, anthropicKey: anthropicKey ?? null, body, supabaseUrl })
    .catch(async (e) => {
      console.error("run-agent error", e);
      await pauseOnError(admin, run, errorMessage(e));
    });
  // Answer now; the run continues in the background.
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work); else await work;
  return json({ status: "running" }, 202);
});

/** Terminal failure: the run cannot go on (a refusal). */
async function failRun(admin: SupabaseClient, run: Run, message: string) {
  await addStep(admin, run.id, "error", "実行に失敗しました", message);
  await admin.from("agent_runs").update({ status: "failed", error: message, finished_at: new Date().toISOString() }).eq("id", run.id).eq("status", "running");
  if (run.triggered_by) {
    await admin.from("notifications").insert({
      recipient_id: run.triggered_by, actor_name: "Alcon Agent", kind: "status_change", element_id: run.element_id,
      title: "エージェントの実行が失敗しました", body: message.slice(0, 200),
    }).then(() => {}, () => {});
  }
}

/** An error mid-run pauses it: the transcript saved so far stays, and its starter can resume. */
async function pauseOnError(admin: SupabaseClient, run: Run, message: string) {
  await addStep(admin, run.id, "error", "エラーで一時停止しました", message);
  await admin.from("agent_runs").update({ status: "paused", error: `エラーで一時停止しました: ${message.slice(0, 300)}`, continuation_token: null })
    .eq("id", run.id).eq("status", "running");
  if (run.triggered_by) {
    await admin.from("notifications").insert({
      recipient_id: run.triggered_by, actor_name: "Alcon Agent", kind: "status_change", element_id: run.element_id,
      title: "エージェントがエラーで一時停止しました", body: message.slice(0, 200),
    }).then(() => {}, () => {});
  }
}

/** Pure. A valid tool name (≤64 chars, [a-zA-Z0-9_-]) not already taken. */
/** A GitHub integration: the preset, or a custom connection to GitHub's MCP server or API. */
function isGithubRow(row: IntegrationRow): boolean {
  return row.preset === "github" || /^https:\/\/(api\.)?github(copilot)?\.com\//.test(row.endpoint);
}

function uniqueToolName(raw: string, taken: Map<string, unknown>): string {
  const base = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 64 - String(n).length - 1)}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// Step numbers are read from the table once per invocation and counted here
// after: the tools of a turn run at the same time, and each step used to cost
// a read before its write.
const stepBase = new Map<string, Promise<number>>();
const stepNext = new Map<string, number>();

async function nextStepIdx(admin: SupabaseClient, runId: string): Promise<number> {
  if (!stepBase.has(runId)) {
    stepBase.set(runId, Promise.resolve(admin.from("agent_run_steps").select("idx").eq("run_id", runId).order("idx", { ascending: false }).limit(1).maybeSingle())
      .then(({ data }) => ((data as { idx?: number } | null)?.idx ?? -1) + 1));
  }
  const base = await stepBase.get(runId)!;
  const idx = stepNext.get(runId) ?? base;
  stepNext.set(runId, idx + 1);
  return idx;
}

async function addStep(admin: SupabaseClient, runId: string, type: string, title: string, detail?: string | null) {
  const idx = await nextStepIdx(admin, runId);
  await admin.from("agent_run_steps").insert({ run_id: runId, idx, type, title: title.slice(0, 300), detail: detail ? String(detail).slice(0, 8000) : null });
  await admin.from("agent_runs").update({ step_count: idx + 1 }).eq("id", runId);
}

interface ExecArgs {
  req: Request; run: Run; user: { id: string; email: string | null }; jwt: string;
  admin: SupabaseClient; userDb: SupabaseClient; anthropicKey: string | null; supabaseUrl: string;
  body: { continue?: boolean; resume?: boolean; token?: string; decision?: { actionId?: string; approve?: boolean; inputHash?: string; note?: string } };
}

async function execute(a: ExecArgs): Promise<void> {
  // Another invocation may have written steps since this isolate last ran.
  stepBase.delete(a.run.id);
  stepNext.delete(a.run.id);
  const { run, admin, userDb, user } = a;

  // ── Agent profile ───────────────────────────────────────────────────────
  // An AI Worker's profile (its instructions above all) loads only when that
  // Worker is assignable to this Element for the person running it — the
  // Space boundary. Anything else runs as the default agent.
  const assignable = async (id: string) => {
    const { data } = await userDb.rpc("worker_assignable", { p_worker: id, p_element: run.element_id });
    return data === true;
  };
  let workerId = run.worker_id && (await assignable(run.worker_id)) ? run.worker_id : null;
  if (!workerId) {
    // The AI Worker assigned to the Element, if any, is the one who works it.
    const { data: assigned } = await userDb.from("element_assignees").select("worker:workers(id, type)").eq("element_id", run.element_id);
    const workers = ((assigned ?? []) as unknown as { worker: { id: string; type: string } | { id: string; type: string }[] | null }[])
      .flatMap((r) => (Array.isArray(r.worker) ? r.worker : r.worker ? [r.worker] : []));
    for (const w of workers) {
      if (w.type === "ai_agent" && await assignable(w.id)) { workerId = w.id; break; }
    }
  }
  let worker: WorkerConfigRow | null = null;
  if (workerId) {
    const { data: w } = await userDb.from("workers").select("name, ai_config, ai_model").eq("id", workerId).maybeSingle();
    worker = (w as WorkerConfigRow | null) ?? null;
  }
  // The Domain's settings frame every run on its Elements. They are read
  // from the Element's own Domain (not the run's client-supplied domain_id)
  // with the service role, so a switch-off holds whatever the starter's
  // role lets them read.
  let domain: DomainConfigRow | null = null;
  {
    const { data: el } = await admin.from("elements").select("object_id").eq("id", run.element_id).maybeSingle();
    if (el?.object_id) {
      const { data: obj } = await admin.from("objects").select("domain_id").eq("id", el.object_id).maybeSingle();
      if (obj?.domain_id) {
        const { data: d } = await admin.from("domains").select("name, ai_config").eq("id", obj.domain_id).maybeSingle();
        domain = (d as DomainConfigRow | null) ?? null;
      }
    }
  }
  const config = resolveAgentConfig(worker, domain);
  const { agentName, model, maxTotalTurns, instructions, domainInstructions } = config;
  const refuse = async (reason: string) => {
    await admin.from("element_comments").insert({
      element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
      content: `**実行できません** — ${reason}`,
    });
    await failRun(admin, run, reason);
  };
  if (config.disabledReason) { await refuse(config.disabledReason); return; }

  // ── Model provider ──────────────────────────────────────────────────────
  // Anthropic with the server's key, or the Worker's model integration in
  // this run's Space with that integration's own key from Vault. The row is
  // read with the starter's JWT, so it must be one they can see.
  let modelClient: Anthropic;
  const external = !!config.providerId;
  if (config.providerId) {
    const { data: p } = run.activity_space_id
      ? await userDb.from("integrations").select("id, name, endpoint, enabled")
        .eq("id", config.providerId).eq("activity_space_id", run.activity_space_id).eq("kind", "model").maybeSingle()
      : { data: null };
    const provider = p as { id: string; name: string; endpoint: string; enabled: boolean } | null;
    if (!provider) { await refuse(`${agentName} の接続先が、この Space の AI モデルの接続に見つかりません。チーム設定で接続先を選び直してください。`); return; }
    if (!provider.enabled) { await refuse(`接続先「${provider.name}」は無効になっています。設定 › 連携で有効にすると実行できます。`); return; }
    if (!isSafeEndpoint(provider.endpoint)) { await refuse(`接続先「${provider.name}」のアドレスは使えません（https の公開ホストだけが使えます）。`); return; }
    const { data: key } = await admin.rpc("get_integration_secret", { p_integration_id: provider.id });
    if (!key) { await refuse(`接続先「${provider.name}」の API キーが設定されていません。設定 › 連携で入力すると実行できます。`); return; }
    // Providers differ in which header carries the key; both carry it.
    modelClient = new Anthropic({ apiKey: key as string, authToken: key as string, baseURL: provider.endpoint.replace(/\/+$/, "") });
  } else {
    if (!a.anthropicKey) { await refuse("ANTHROPIC_API_KEY が設定されていません。"); return; }
    modelClient = new Anthropic({ apiKey: a.anthropicKey });
  }
  await admin.from("agent_runs").update({ model, worker_id: workerId }).eq("id", run.id);
  const actor: BoardActor = { agent: `${agentName}（AI）`, userId: user.id };

  // ── Budget ──────────────────────────────────────────────────────────────
  // The Space's monthly budget; for an Element outside any Space, its
  // starter's own monthly budget. Every run is also capped on its own.
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  let budget = USER_MONTHLY_BUDGET_USD;
  let spentQuery = admin.from("agent_runs").select("cost_usd").gte("created_at", monthStart.toISOString()).neq("id", run.id);
  if (run.activity_space_id) {
    const { data: space } = await admin.from("activity_spaces").select("ai_monthly_budget_usd").eq("id", run.activity_space_id).maybeSingle();
    budget = Number(space?.ai_monthly_budget_usd ?? 20);
    spentQuery = spentQuery.eq("activity_space_id", run.activity_space_id);
  } else {
    spentQuery = spentQuery.is("activity_space_id", null).eq("triggered_by", user.id);
  }
  const { data: spent } = await spentQuery;
  const spentBefore = (spent ?? []).reduce((s: number, r: { cost_usd: number | string }) => s + Number(r.cost_usd || 0), 0);
  let usage = { input: run.input_tokens, output: run.output_tokens, cost: Number(run.cost_usd || 0) };

  // ── Integrations (the person must be a member of the Space to list them) ─
  const integrationTools = new Map<string, IntegrationTool>();
  const integrationDefs: ToolDef[] = [];
  const integrationSummary: TaskContext["integrations"] = [];
  if (run.activity_space_id) {
    const { data: rows } = await userDb.from("integrations")
      .select("id, preset, kind, name, description, endpoint, auth_type, auth_header, delegation, enabled")
      .eq("activity_space_id", run.activity_space_id).eq("enabled", true).in("kind", ["mcp", "http"]).order("created_at");
    for (const row of (rows ?? []) as (IntegrationRow & { enabled: boolean })[]) {
      if (!isSafeEndpoint(row.endpoint)) continue;
      // Never Alcon itself: the board tools already act as the starter, and a
      // stored token would act outside this run.
      if (pointsAtAlcon(row.endpoint, Deno.env.get("SUPABASE_URL"))) {
        await addStep(admin, run.id, "error", `連携「${row.name}」は Alcon 自身を指しているため使いません`, "Alcon のデータの操作はエージェントの標準の道具で行います。");
        continue;
      }
      // OAuth is Google Drive's sign-in; any other OAuth row has no way to authenticate.
      if (row.auth_type === "oauth" && !isGoogleDriveRow(row)) continue;
      const { data: raw } = await admin.rpc("get_integration_secret", { p_integration_id: row.id });
      const prefix = integrationPrefix(row.name, row.id);
      try {
        // An OAuth token set becomes a current access token here (refreshed
        // when due); other credentials pass through as stored.
        const secret = await resolveCredential(admin, row, (raw as string | null) ?? null);
        if (isGoogleDriveRow(row)) {
          if (!secret) {
            await addStep(admin, run.id, "error", `連携「${row.name}」は Google への接続が必要です`, "Settings › Integrations で Google にサインインし直すと使えます。");
            continue;
          }
          for (const t of DRIVE_TOOLS) {
            if (integrationDefs.length >= MAX_TOOLS) break;
            const name = uniqueToolName(`${prefix}${INTEGRATION_SEPARATOR}${t.name}`, integrationTools);
            integrationTools.set(name, {
              integration: row, secret, session: null, drive: true,
              remote: { name: t.name, description: t.description, inputSchema: t.input_schema, readOnly: t.readOnly },
            });
            integrationDefs.push({ name, description: `[${row.name}] ${t.description}`.slice(0, 1024), input_schema: t.input_schema });
          }
          integrationSummary.push({ name: row.name, kind: "Google Drive", delegation: row.delegation, tools: DRIVE_TOOLS.length });
        } else if (row.kind === "mcp") {
          const session = new McpSession(row, secret);
          await session.initialize();
          const tools = await session.listTools();
          for (const t of tools) {
            if (integrationDefs.length >= MAX_TOOLS) break;
            const name = uniqueToolName(`${prefix}${INTEGRATION_SEPARATOR}${t.name}`, integrationTools);
            integrationTools.set(name, { integration: row, remote: t, secret, session });
            integrationDefs.push({ name, description: `[${row.name}] ${t.description}`.slice(0, 1024), input_schema: t.inputSchema });
          }
          integrationSummary.push({ name: row.name, kind: "MCP", delegation: row.delegation, tools: tools.length });
        } else {
          const name = `${prefix}${INTEGRATION_SEPARATOR}http_request`;
          integrationTools.set(name, { integration: row, remote: null, secret, session: null });
          integrationDefs.push({
            name,
            description: `[${row.name}] ${row.description ?? ""} の API（base: ${row.endpoint}）に HTTP リクエストを送る。GET / HEAD は読み取り、それ以外は書き込み。`.slice(0, 1024),
            input_schema: HTTP_REQUEST_SCHEMA as unknown as Record<string, unknown>,
          });
          integrationSummary.push({ name: row.name, kind: "API", delegation: row.delegation, tools: 1 });
        }
      } catch (e) {
        await addStep(admin, run.id, "error", `連携「${row.name}」に接続できませんでした`, errorMessage(e));
      }
    }
  }

  // The tool list is frozen at the first slice: later slices send the same
  // definitions (thinking blocks are bound to that prefix). A tool whose
  // integration went away since answers with an error instead.
  const liveTools: ToolDef[] = [...baseAgentTools(), ...integrationDefs];
  const tools: ToolDef[] = run.transcript?.tools?.length ? run.transcript.tools : liveTools;
  const kindOf = (name: string): ToolKind => {
    const base = baseKindOf(name);
    if (base) return base;
    return "write"; // decided per call below
  };
  const isRead = (call: ToolCall): boolean => {
    const it = integrationTools.get(call.name);
    if (!it) return false;
    return it.remote ? it.remote.readOnly : httpIsRead(call.input);
  };

  // ── Executors ───────────────────────────────────────────────────────────
  // The Sub-elements of this Element (Elements whose parent it is): the only
  // ones complete_subelement may close.
  const subelementIds = new Set<string>();
  {
    const { data: subs } = await userDb.from("elements").select("id").eq("parent_id", run.element_id);
    for (const s of subs ?? []) subelementIds.add(s.id as string);
  }

  const callIntegration = async (call: ToolCall): Promise<{ content: string; is_error?: boolean }> => {
    const it = integrationTools.get(call.name);
    if (!it) return { content: "Unknown tool.", is_error: true };
    const r = it.drive && it.remote
      ? await runDriveTool(it.remote.name, call.input, it.secret ?? "")
      : it.remote && it.session
        ? await it.session.callTool(it.remote.name, call.input)
        : await callHttp(it.integration, it.secret, call.input);
    if (!r.isError && isGithubRow(it.integration) && it.remote && /^(create|update)_pull_request$/i.test(it.remote.name)) {
      await linkOpenedPulls(r.text, it.secret);
    }
    return { content: r.text, ...(r.isError ? { is_error: true } : {}) };
  };

  // A pull request the agent opened (or updated) through GitHub becomes one of
  // the Element's code changes, so the team can read its diff against the
  // intent. A failure here never fails the call that opened it.
  const linkedPulls = new Set<string>();
  const linkOpenedPulls = async (text: string, token: string | null) => {
    for (const ref of pullUrlsIn(text).slice(0, 3)) {
      const key = `${ref.repo}#${ref.number}`;
      if (linkedPulls.has(key)) continue;
      linkedPulls.add(key);
      try {
        const pull = await withGithubToken([token, null], (t) => fetchPull(ref, t));
        await upsertCodeChange(admin, run.element_id, ref, pull, { linkedBy: user.id, via: "agent", runId: run.id });
        await addStep(admin, run.id, "artifact", `コード変更を紐付けました: ${key}`, pull.title);
      } catch (e) {
        await addStep(admin, run.id, "error", `PR ${key} を Element に紐付けられませんでした`, errorMessage(e));
      }
    }
  };

  const executeCall = async (call: ToolCall): Promise<{ content: string; is_error?: boolean; finish?: FinishPayload }> => {
    const input = call.input;
    switch (call.name) {
      case "record_plan": {
        const steps = Array.isArray(input.steps) ? (input.steps as unknown[]).map(String) : [];
        await addStep(admin, run.id, "plan", "実行計画", steps.map((s, i) => `${i + 1}. ${s}`).join("\n") || "(計画なし)");
        return { content: "計画を記録しました。" };
      }
      case "log_progress":
        await addStep(admin, run.id, "thought", String(input.title ?? "進捗"), input.detail ? String(input.detail) : null);
        return { content: "記録しました。" };
      case "complete_subelement": {
        const sid = String(input.subelement_id ?? "");
        if (!subelementIds.has(sid)) return { content: "この Element のサブ要素ではありません。", is_error: true };
        const r = await runBoardTool(userDb, "toggleSubelementComplete", { id: sid, isCompleted: true }, actor);
        if (!r.ok) return { content: r.error, is_error: true };
        await addStep(admin, run.id, "subelement", "サブ要素を完了", input.note ? String(input.note) : null);
        return { content: "完了にしました。" };
      }
      case "save_artifact": {
        const title = String(input.title ?? "").trim().slice(0, 200);
        const content = String(input.content ?? "");
        if (!title) return { content: "title が必要です。", is_error: true };
        const format = ["markdown", "text", "csv", "json"].includes(String(input.format)) ? String(input.format) : "markdown";
        const { data: existing } = await userDb.from("agent_artifacts").select("id").eq("element_id", run.element_id).eq("title", title).maybeSingle();
        const res = existing
          ? await userDb.from("agent_artifacts").update({ content, format, run_id: run.id, updated_at: new Date().toISOString() }).eq("id", existing.id).select("id").single()
          : await userDb.from("agent_artifacts").insert({ element_id: run.element_id, run_id: run.id, title, content, format, author_name: agentName }).select("id").single();
        if (res.error) return { content: res.error.message, is_error: true };
        await addStep(admin, run.id, "artifact", `成果物を保存: ${title}`, `${content.length} 文字`);
        return { content: `成果物「${title}」を保存しました。` };
      }
      case "finish": {
        const outcome = ["completed", "partial", "blocked"].includes(String(input.outcome)) ? String(input.outcome) as FinishPayload["outcome"] : "completed";
        const finish: FinishPayload = { outcome, summary: String(input.summary ?? "").trim().slice(0, 300) || "完了", message: String(input.message ?? "").trim() };
        return { content: "完了報告を受け取りました。", finish };
      }
    }
    if (baseKindOf(call.name) === "board") {
      const r = isStrategyTool(call.name) ? await runStrategyTool(userDb, call.name, input) : await runBoardTool(userDb, call.name, input, actor);
      await addStep(admin, run.id, "action", `Alcon: ${call.name}`, r.ok ? null : r.error);
      return r.ok ? { content: JSON.stringify(r.data).slice(0, 20_000) } : { content: r.error, is_error: true };
    }
    const it = integrationTools.get(call.name);
    if (it) {
      const r = await callIntegration(call);
      await addStep(admin, run.id, "action", `${it.integration.name}: ${operationOf(it, call.input)}`, r.is_error ? r.content.slice(0, 500) : null);
      return r;
    }
    return { content: "Unknown tool.", is_error: true };
  };

  // ── State ───────────────────────────────────────────────────────────────
  const deadline = Date.now() + SLICE_MS;
  let state: LoopState;
  let turnBudget: number;
  let pending: SavedPending | undefined = run.transcript?.pending;
  if (run.transcript?.messages?.length) {
    state = { messages: run.transcript.messages, turns: run.transcript.turns ?? 0, nudges: run.transcript.nudges ?? 0, revisions: run.transcript.revisions ?? 0 };
    turnBudget = run.transcript.turnBudget ?? maxTotalTurns;
    // Resuming grants a fresh allowance on top of the turns already taken.
    if (a.body.resume) turnBudget = state.turns + maxTotalTurns;
  } else {
    state = { messages: [{ role: "user", content: taskMessage(await loadContext(userDb, run, integrationSummary)) }], turns: 0, nudges: 0 };
    turnBudget = maxTotalTurns;
    await addStep(admin, run.id, "status", run.mode === "reply" ? "依頼を受けて実行を開始" : "任務の実行を開始", `${agentName} / ${config.modelLabel}`);
  }

  const saveTranscript = async (p?: SavedPending) => {
    const transcript: Transcript = {
      messages: state.messages, turns: state.turns, nudges: state.nudges, revisions: state.revisions ?? 0, turnBudget, tools,
      ...(p ? { pending: p } : {}),
    };
    // jsonb refuses NUL; tool output can carry it.
    const clean = JSON.parse(JSON.stringify(transcript).replace(/\\u0000/g, ""));
    const { error } = await admin.from("agent_runs").update({ transcript: clean }).eq("id", run.id);
    if (error) throw new Error(`経過を保存できませんでした: ${error.message}`);
  };

  const scheduleContinuation = async () => {
    if (!a.body.resume && run.continuation_count + 1 > MAX_CONTINUATIONS) {
      await finishRun(a, run, agentName, { outcome: "partial", summary: "実行の上限に達しました", message: "作業量が多いため、実行の上限で区切りました。続きは「続きを実行」から再開できます。" }, "paused");
      return;
    }
    const token = crypto.randomUUID();
    const { data: armed } = await admin.from("agent_runs")
      .update({ continuation_count: (a.body.resume ? 0 : run.continuation_count) + 1, continuation_token: token })
      .eq("id", run.id).eq("status", "running").select("id").maybeSingle();
    if (!armed) return; // cancelled meanwhile
    await addStep(admin, run.id, "status", "区切りました — 続きを実行します");
    // The next slice, with the same person's session, in a fresh invocation.
    await fetch(`${a.supabaseUrl}/functions/v1/run-agent`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${a.jwt}` },
      body: JSON.stringify({ runId: run.id, continue: true, token }),
    }).catch(async (e) => {
      await admin.from("agent_runs").update({ status: "paused", error: `続きを開始できませんでした: ${errorMessage(e)}`, continuation_token: null }).eq("id", run.id).eq("status", "running");
    });
  };

  // A run resumed while a proposal is still unanswered (a stale decision, a
  // slice cut off before it stopped) goes back to waiting for it — sending
  // the transcript on with an unanswered tool_use would fail every time.
  if (pending && !pending.approved && !a.body.decision) {
    const { data: open } = await admin.from("agent_actions").select("id").eq("run_id", run.id).eq("status", "pending").maybeSingle();
    if (!open) {
      const display = pending.calls.map((c) => ({ id: c.id, integration: c.name.split(INTEGRATION_SEPARATOR)[0], operation: c.name.split(INTEGRATION_SEPARATOR).slice(1).join(INTEGRATION_SEPARATOR) || c.name }));
      await admin.from("agent_actions").insert({
        run_id: run.id, element_id: run.element_id, tool_use_id: pending.calls[0].id, tool: pending.calls.length === 1 ? pending.calls[0].name : "batch",
        input: { calls: pending.calls, display }, input_hash: await sha256(canonicalCalls(pending.calls)), summary: approvalSummary(display),
      });
    }
    await admin.from("agent_runs").update({ status: "awaiting_approval" }).eq("id", run.id).eq("status", "running");
    await addStep(admin, run.id, "approval", "承認待ちに戻しました");
    return;
  }

  // ── A decision answers the paused turn first ────────────────────────────
  if (a.body.decision && pending) {
    const d = a.body.decision;
    const { data: action } = await admin.from("agent_actions").select("*").eq("id", d.actionId ?? "").eq("run_id", run.id).maybeSingle();
    if (!action || action.status !== "pending") throw new Error("この承認依頼はもう処理されています。");
    if (d.approve) {
      await admin.from("agent_actions").update({ status: "approved", decided_by: user.id, decided_at: new Date().toISOString(), decision_note: d.note ?? null }).eq("id", action.id);
      await addStep(admin, run.id, "approval", "承認されました", d.note ?? null);
      pending = { ...pending, approved: true, results: [] };
      await saveTranscript(pending);
    } else {
      await admin.from("agent_actions").update({ status: "rejected", decided_by: user.id, decided_at: new Date().toISOString(), decision_note: d.note ?? null }).eq("id", action.id);
      await addStep(admin, run.id, "approval", "却下されました", d.note ?? null);
      const rejected: ToolResult[] = pending.calls.map((call) => ({
        type: "tool_result", tool_use_id: call.id, is_error: true,
        content: `実行を始めた人が却下しました。${d.note ? `理由・指示: ${d.note}` : ""} 実行していません。指示に沿って案を直すか、finish してください。`,
      }));
      appendDecisionResults(state, pending, rejected);
      pending = undefined;
      await saveTranscript();
    }
  }

  // An approved batch runs to the end, its progress saved as it goes; if the
  // slice runs out of time mid-batch, the next slice picks up where it left.
  if (pending?.approved) {
    const results = pending.results ?? [];
    const done = new Set(results.map((r) => r.tool_use_id));
    for (const call of pending.calls) {
      if (done.has(call.id)) continue;
      if (Date.now() >= deadline) {
        await saveTranscript({ ...pending, results });
        await scheduleContinuation();
        return;
      }
      let r: { content: string; is_error?: boolean };
      try { r = await executeCall(call); } catch (e) { r = { content: `Error: ${errorMessage(e)}`, is_error: true }; }
      results.push({ type: "tool_result", tool_use_id: call.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) });
      await saveTranscript({ ...pending, results });
    }
    const failed = results.filter((r) => r.is_error).length;
    await admin.from("agent_actions").update({ status: failed === pending.calls.length ? "failed" : "executed", result: { failed, total: pending.calls.length } })
      .eq("run_id", run.id).eq("status", "approved");
    appendDecisionResults(state, pending, results);
    pending = undefined;
    await saveTranscript();
  }

  // ── Model ───────────────────────────────────────────────────────────────
  // Another provider gets the plain Messages API: no betas, no cache marks.
  const cache = external ? {} : { cache_control: { type: "ephemeral" as const } };
  const system = [{ type: "text" as const, text: systemPrompt({ name: agentName, instructions, domainInstructions }), ...cache }];
  const toolParams = tools.map((t, i) => ({
    name: t.name, description: t.description, input_schema: t.input_schema,
    ...(i === tools.length - 1 ? cache : {}),
  }));

  const recordUsage = async (u: ModelUsage) => {
    usage = {
      input: usage.input + (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      output: usage.output + (u.output_tokens ?? 0),
      cost: Math.round((usage.cost + costAt(config.price, u)) * 1_000_000) / 1_000_000,
    };
    await admin.from("agent_runs").update({ input_tokens: usage.input, output_tokens: usage.output, cost_usd: usage.cost }).eq("id", run.id);
  };

  // The verifier reads the task, the Strategy's success conditions and this
  // run's outputs fresh, in its own context, on the run's model at low effort.
  // Any failure to answer lets the finish stand rather than trap the run.
  const verifyFinish = async (finish: FinishPayload) => {
    try {
      const [{ data: el }, { data: arts }] = await Promise.all([
        userDb.from("elements").select("title, description, object_id").eq("id", run.element_id).maybeSingle(),
        admin.from("agent_artifacts").select("title, content").eq("run_id", run.id),
      ]);
      if (!el) return null;
      const intents: string[] = [];
      if (el.object_id) {
        const { data: links } = await userDb.from("strategy_objects").select("strategy_id").eq("object_id", el.object_id).limit(2);
        for (const l of (links ?? []) as { strategy_id: string }[]) {
          const r = await runStrategyTool(userDb, "getInitiative", { id: l.strategy_id });
          if (!r.ok) continue;
          const d = r.data as { name: string; description: string | null; intents?: { kind: string | null; title: string }[] };
          intents.push(`${d.name}${d.description ? `：${d.description}` : ""}`);
          for (const i of d.intents ?? []) if (i.kind === "measure") intents.push(`成功条件: ${i.title}`);
        }
      }
      const usedWeb = state.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "server_tool_use"));
      // deno-lint-ignore no-explicit-any
      const res: any = await modelClient.messages.create({
        model,
        max_tokens: 4000,
        system: VERIFY_SYSTEM,
        messages: [{ role: "user", content: verifyPrompt({ element: el, intents, finish, artifacts: (arts ?? []) as { title: string; content: string }[], usedWeb }) }],
        output_config: { effort: "low", format: { type: "json_schema", schema: VERDICT_SCHEMA } },
      // deno-lint-ignore no-explicit-any
      } as any);
      await recordUsage(res.usage ?? {});
      const text = (res.content ?? []).find((b: { type: string }) => b.type === "text")?.text ?? "";
      const verdict = readVerdict(text);
      if (verdict) await addStep(admin, run.id, "thought", verdict.pass ? "検証: 合格" : `検証: 不足 ${verdict.gaps.length} 点`, verdict.gaps.join("\n") || null);
      return verdict;
    } catch (e) {
      console.error("run-agent: verify failed", errorMessage(e));
      return null;
    }
  };

  const outcome = await runLoop(state, {
    callModel: async (messages) => {
      if (external) {
        // deno-lint-ignore no-explicit-any
        const res: any = await modelClient.messages.create({
          model,
          max_tokens: 8192,
          system,
          // deno-lint-ignore no-explicit-any
          tools: toolParams as any,
          // deno-lint-ignore no-explicit-any
          messages: messages as any,
        });
        return { content: res.content, stop_reason: res.stop_reason, usage: res.usage };
      }
      // deno-lint-ignore no-explicit-any
      const res: any = await modelClient.beta.messages.create({
        model,
        max_tokens: 16000,
        system,
        // deno-lint-ignore no-explicit-any
        // The web tools go first so the cache mark stays on the last of ours.
        // deno-lint-ignore no-explicit-any
        tools: [...webTools(model), ...toolParams] as any,
        // deno-lint-ignore no-explicit-any
        messages: messages as any,
        // Medium thinking: these are working steps, not hard reasoning, and
        // the default (high on Sonnet) made every turn slow.
        output_config: { effort: "medium" },
        betas: ["context-management-2025-06-27"],
        context_management: { edits: [{ type: "clear_tool_uses_20250919" }] },
      // deno-lint-ignore no-explicit-any
      } as any);
      for (const line of webSteps(res.content ?? [])) await addStep(admin, run.id, "action", line);
      return { content: res.content, stop_reason: res.stop_reason, usage: res.usage };
    },
    kindOf,
    needsApproval: (call) => {
      if (kindOf(call.name) !== "write") return false;
      if (isRead(call)) return false;
      const it = integrationTools.get(call.name);
      return !it || it.integration.delegation !== "full_delegation";
    },
    execute: (call) => executeCall(call),
    onUsage: recordUsage,
    verify: run.mode === "reply" || external ? undefined : verifyFinish,
    afterTurn: () => saveTranscript(),
    budgetExceeded: () => spentBefore + usage.cost >= budget || usage.cost >= MAX_RUN_COST_USD,
    cancelled: async () => {
      const { data } = await admin.from("agent_runs").select("status").eq("id", run.id).maybeSingle();
      return data?.status === "cancelled";
    },
  }, { maxTurnsThisCall: MAX_TURNS_PER_SLICE, maxTotalTurns: turnBudget, deadline });

  // ── Outcome ─────────────────────────────────────────────────────────────
  switch (outcome.kind) {
    case "finished":
      await saveTranscript();
      await finishRun(a, run, agentName, outcome.finish);
      return;

    case "approval": {
      await saveTranscript(outcome.pending);
      const calls = outcome.pending.calls;
      const display = calls.map((c) => {
        const it = integrationTools.get(c.name);
        return { id: c.id, integration: it?.integration.name ?? c.name, operation: operationOf(it, c.input) };
      });
      const summary = approvalSummary(display);
      const inputHash = await sha256(canonicalCalls(calls));
      const { data: waiting } = await admin.from("agent_runs").update({ status: "awaiting_approval" }).eq("id", run.id).eq("status", "running").select("id").maybeSingle();
      if (!waiting) return; // cancelled meanwhile
      await admin.from("agent_actions").insert({
        run_id: run.id, element_id: run.element_id, tool_use_id: calls[0].id, tool: calls.length === 1 ? calls[0].name : "batch",
        input: { calls, display }, input_hash: inputHash, summary, integration_id: integrationTools.get(calls[0].name)?.integration.id ?? null,
      });
      await addStep(admin, run.id, "approval", `承認待ち: ${summary}`);
      // One line on the thread; the details live in the approval card.
      await admin.from("element_comments").insert({
        element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
        content: `**承認待ち** — ${summary}。内容を確認して、承認するか指示を返してください。`,
      });
      if (run.triggered_by) {
        await admin.from("notifications").insert({
          recipient_id: run.triggered_by, actor_name: agentName, kind: "approval_requested", element_id: run.element_id,
          title: `${agentName} が承認を求めています`, body: summary,
        }).then(() => {}, () => {});
      }
      return;
    }

    case "yield":
      await saveTranscript();
      await scheduleContinuation();
      return;

    case "limit":
      await saveTranscript();
      await finishRun(a, run, agentName, { outcome: "partial", summary: "ターン数の上限に達しました", message: "設定されたターン数の上限に達したため、ここで区切りました。続きは「続きを実行」から再開できます。" }, "paused");
      return;

    case "budget": {
      await saveTranscript();
      const why = usage.cost >= MAX_RUN_COST_USD
        ? `1 回の実行の上限（$${MAX_RUN_COST_USD}）に達したため一時停止しました。`
        : run.activity_space_id ? "この Space の今月の AI 予算の上限に達したため一時停止しました。" : "今月の AI 予算（個人）の上限に達したため一時停止しました。";
      await admin.from("agent_runs").update({ status: "paused", error: why }).eq("id", run.id).eq("status", "running");
      await addStep(admin, run.id, "error", "予算の上限に達しました", why);
      return;
    }

    case "cancelled":
      await saveTranscript();
      await addStep(admin, run.id, "status", "停止しました");
      return;

    case "refusal":
      await saveTranscript();
      await failRun(admin, run, `モデルがこの依頼を断りました: ${outcome.detail.slice(0, 300)}`);
      return;
  }
}

async function finishRun(a: ExecArgs, run: Run, agentName: string, finish: FinishPayload, status?: "paused") {
  const { admin, userDb, user } = a;
  // A run stopped meanwhile stays stopped, and says nothing.
  const { data: live } = await admin.from("agent_runs").select("status").eq("id", run.id).maybeSingle();
  if (live?.status !== "running") return;

  // Under a Strategy that lets its AI work go on ('auto'), work that passed
  // the verifier is done and unblocks the next; otherwise it waits for review.
  const auto = run.mode !== "reply" && status !== "paused" && finish.outcome === "completed"
    && (await elementDelegation(userDb, run.element_id)) === "auto";

  // In execute mode the Element moves on first — done work waits for a
  // person's review (or is done, under 'auto'), blocked work says so — so
  // that when the run reads as finished, the Element already shows where it
  // went. A reply leaves the status alone.
  if (run.mode !== "reply" && status !== "paused") {
    const { data: el } = await userDb.from("elements").select("status").eq("id", run.element_id).maybeSingle();
    const next = finish.outcome === "completed" ? (auto ? "done" : "review") : finish.outcome === "blocked" ? "blocked" : null;
    if (el && next && !["done", "cancelled"].includes(el.status ?? "") && el.status !== next) {
      await runBoardTool(userDb, "updateElement", { id: run.element_id, status: next }, { agent: `${agentName}（AI）`, userId: user.id });
      await addStep(admin, run.id, "status", next === "review" ? "Element をレビュー待ちに移動" : next === "done" ? "Element を完了に移動（自動で進める設定）" : "Element をブロック中に移動");
    }
  }

  const runStatus = status ?? (finish.outcome === "completed" && run.mode !== "reply" && !auto ? "awaiting_review" : "completed");
  const { data: closed } = await admin.from("agent_runs").update({
    status: runStatus, summary: finish.summary, result: finish.message, finished_at: status ? null : new Date().toISOString(),
    error: status === "paused" ? finish.summary : null, continuation_token: null,
  }).eq("id", run.id).eq("status", "running").select("id").maybeSingle();
  if (!closed) return;

  const label = finish.outcome === "blocked" ? "対応が必要です"
    : run.mode === "reply" ? "返信"
    : finish.outcome === "completed" ? "完了報告" : "途中報告";
  const content = `**${label}** — ${finish.summary}\n\n${finish.message || finish.summary}`;
  // A reply hangs under the comment that asked — only if it is this Element's.
  let parentId: string | null = null;
  if (run.reply_to) {
    const { data: parent } = await userDb.from("element_comments").select("id").eq("id", run.reply_to).eq("element_id", run.element_id).maybeSingle();
    parentId = parent?.id ?? null;
  }
  await admin.from("element_comments").insert({
    element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
    content, ...(parentId ? { parent_id: parentId } : {}),
  });
  await addStep(admin, run.id, "result", finish.summary, finish.message);

  if (run.triggered_by) {
    await admin.from("notifications").insert({
      recipient_id: run.triggered_by, actor_name: agentName, kind: "status_change", element_id: run.element_id,
      title: `${agentName}: ${label}`, body: finish.summary,
    }).then(() => {}, () => {});
  }

  if (auto) {
    try {
      const started = await advanceFrom(a, run.element_id);
      if (started.length) await addStep(admin, run.id, "status", `次の作業を ${started.length} 件開始しました`);
    } catch (e) {
      console.error("run-agent: advance failed", errorMessage(e));
    }
  }
}

/** The delegation of the Strategies an Element's Object serves. */
async function elementDelegation(userDb: SupabaseClient, elementId: string): Promise<"manual" | "auto"> {
  const { data: el } = await userDb.from("elements").select("object_id").eq("id", elementId).maybeSingle();
  if (!el?.object_id) return "manual";
  const { data: links } = await userDb.from("strategy_objects").select("strategy_id").eq("object_id", el.object_id);
  const ids = ((links ?? []) as { strategy_id: string }[]).map((l) => l.strategy_id);
  if (ids.length === 0) return "manual";
  const { data: strategies } = await userDb.from("strategies").select("delegation").in("id", ids);
  return delegationOf((strategies ?? []) as { delegation: string | null }[]);
}

const OPEN_RUN = ["queued", "running", "awaiting_approval", "paused"];

/**
 * Starts the AI Elements that `doneId` unblocks, as the same person, each as
 * its own run. Everything is read with that person's JWT, so the chain only
 * reaches what they could start by hand. A JWT that has expired meanwhile
 * fails the start; the Elements stay ready on the Execution tab.
 */
async function advanceFrom(a: ExecArgs, doneId: string): Promise<string[]> {
  const { admin, userDb, user } = a;
  const { data: out } = await userDb.from("element_edges").select("from_element, to_element").eq("from_element", doneId).eq("edge_type", "depends_on");
  const downIds = [...new Set(((out ?? []) as { to_element: string }[]).map((e) => e.to_element))];
  if (downIds.length === 0) return [];
  const [{ data: inEdges }, { data: els }, { data: assignees }, { data: open }] = await Promise.all([
    userDb.from("element_edges").select("from_element, to_element").in("to_element", downIds).eq("edge_type", "depends_on"),
    userDb.from("elements").select("id, status, object_id, objects(domain_id)").in("id", downIds),
    userDb.from("element_assignees").select("element_id, role, workers(type, ai_config)").in("element_id", downIds),
    admin.from("agent_runs").select("element_id").in("element_id", downIds).in("status", OPEN_RUN),
  ]);
  const edges = (inEdges ?? []) as { from_element: string; to_element: string }[];
  const prereqIds = [...new Set(edges.map((e) => e.from_element))];
  const { data: prereqs } = prereqIds.length ? await userDb.from("elements").select("id, status").in("id", prereqIds) : { data: [] };
  const statusOf = new Map(((prereqs ?? []) as { id: string; status: string | null }[]).map((p) => [p.id, p.status]));
  type AssigneeRow = { element_id: string; role: string | null; workers: { type: string; ai_config: unknown } | null };
  const isAi = (id: string) => ((assignees ?? []) as unknown as AssigneeRow[]).some((r) => r.element_id === id && r.role !== "reviewer"
    && r.workers?.type === "ai_agent"
    && !(r.workers.ai_config && typeof r.workers.ai_config === "object" && (r.workers.ai_config as Record<string, unknown>).runner === "claude-code"));
  const busy = new Set(((open ?? []) as { element_id: string }[]).map((r) => r.element_id));
  type ElementRow = { id: string; status: string | null; objects: { domain_id: string | null } | null };
  const rows = (els ?? []) as unknown as ElementRow[];
  const candidates: AdvanceCandidate[] = rows.map((e) => ({ id: e.id, status: e.status, ai: isAi(e.id), openRun: busy.has(e.id) }));
  const ready = readyDownstream({ doneId, edges: [...((out ?? []) as { from_element: string; to_element: string }[]), ...edges], candidates, statusOf });

  const started: string[] = [];
  for (const id of ready) {
    const domainId = rows.find((e) => e.id === id)?.objects?.domain_id ?? null;
    const { data: next, error } = await userDb.from("agent_runs").insert({
      element_id: id, domain_id: domainId, triggered_from: "board", triggered_by: user.id, status: "queued", mode: "execute",
    }).select("id").single();
    if (error || !next) continue; // another start won the race
    const res = await fetch(`${a.supabaseUrl}/functions/v1/run-agent`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${a.jwt}` },
      body: JSON.stringify({ runId: next.id }),
    }).catch(() => null);
    if (res && res.ok) started.push(id);
    else await admin.from("agent_runs").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", next.id).eq("status", "queued");
  }
  return started;
}

/** What the Elements this one waits on left behind: their latest report, their
 *  outputs and what people said on them — the hand-off from the earlier step.
 *  Read with the starter's JWT; capped so a long chain cannot flood the prompt. */
async function loadUpstream(userDb: SupabaseClient, ids: string[]): Promise<TaskContext["upstream"]> {
  if (ids.length === 0) return [];
  const [els, runs, arts, comments] = await Promise.all([
    userDb.from("elements").select("id, display_id, title, status").in("id", ids),
    userDb.from("agent_runs").select("element_id, result, created_at").in("element_id", ids).not("result", "is", null).order("created_at", { ascending: false }),
    userDb.from("agent_artifacts").select("element_id, title, content, updated_at").in("element_id", ids).order("updated_at", { ascending: false }),
    userDb.from("element_comments").select("element_id, author_name, author_kind, content, created_at").in("element_id", ids).eq("author_kind", "human").order("created_at", { ascending: false }).limit(30),
  ]);
  let room = 24_000;
  const take = (text: string, max: number) => {
    const t = text.slice(0, Math.min(max, Math.max(0, room)));
    room -= t.length;
    return t.length < text.length ? `${t}…（以下略）` : t;
  };
  return ((els.data ?? []) as { id: string; display_id: string | null; title: string; status: string | null }[]).map((e) => {
    const report = ((runs.data ?? []) as { element_id: string; result: unknown }[]).find((r) => r.element_id === e.id)?.result;
    const reportText = typeof report === "string" ? report : report ? JSON.stringify(report) : "";
    return {
      display_id: e.display_id, title: e.title, status: e.status,
      report: reportText ? take(reportText, 3_000) : null,
      artifacts: ((arts.data ?? []) as { element_id: string; title: string; content: string | null }[])
        .filter((a) => a.element_id === e.id).slice(0, 2)
        .map((a) => ({ title: a.title, content: take(a.content ?? "", 8_000) })),
      comments: ((comments.data ?? []) as { element_id: string; author_name: string | null; content: string | null }[])
        .filter((c) => c.element_id === e.id).slice(0, 3).reverse()
        .map((c) => ({ author: c.author_name ?? "不明", content: take(c.content ?? "", 1_200) })),
    };
  });
}

async function loadContext(userDb: SupabaseClient, run: Run, integrations: TaskContext["integrations"]): Promise<TaskContext> {
  const { data: el } = await userDb.from("elements")
    .select("id, display_id, title, description, status, priority, due_date, labels, object_id").eq("id", run.element_id).single();
  if (!el) throw new Error("対象の Element が見つかりません。");
  const [subs, comments, runs, artifacts, obj, links, edges] = await Promise.all([
    userDb.from("elements").select("id, title, status").eq("parent_id", run.element_id).order("order_index").order("seq_number"),
    userDb.from("element_comments").select("author_name, author_kind, content, created_at").eq("element_id", run.element_id).order("created_at", { ascending: false }).limit(15),
    userDb.from("agent_runs").select("created_at, status, summary").eq("element_id", run.element_id).neq("id", run.id).order("created_at", { ascending: false }).limit(3),
    userDb.from("agent_artifacts").select("title").eq("element_id", run.element_id).order("created_at"),
    el?.object_id ? userDb.from("objects").select("name").eq("id", el.object_id).maybeSingle() : Promise.resolve({ data: null }),
    el?.object_id ? userDb.from("strategy_objects").select("strategy_id").eq("object_id", el.object_id) : Promise.resolve({ data: [] }),
    userDb.from("element_edges").select("from_element").eq("to_element", run.element_id).eq("edge_type", "depends_on").limit(6),
  ]);
  const upstream = await loadUpstream(userDb, ((edges.data ?? []) as { from_element: string }[]).map((e) => e.from_element));
  const initiatives: TaskContext["initiatives"] = [];
  for (const l of ((links.data ?? []) as { strategy_id: string }[]).slice(0, 3)) {
    const r = await runStrategyTool(userDb, "getInitiative", { id: l.strategy_id });
    if (r.ok) {
      const d = r.data as { name: string; description: string | null; intents: { kind: string | null; title: string; status: string | null }[] };
      initiatives.push({ name: d.name, description: d.description, intents: (d.intents ?? []).slice(0, 12) });
    }
  }
  return {
    mode: run.mode === "reply" ? "reply" : "execute",
    prompt: run.prompt,
    element: {
      id: el.id, display_id: el.display_id, title: el.title, description: el.description, status: el.status,
      priority: el.priority, due_date: el.due_date, labels: Array.isArray(el.labels) ? el.labels : [],
    },
    objectName: (obj.data as { name?: string } | null)?.name ?? null,
    subElements: (subs.data ?? []).map((s: { id: string; title: string; status: string | null }) => ({ id: s.id, title: s.title, done: s.status === "done" })),
    initiatives,
    comments: ((comments.data ?? []) as { author_name: string | null; author_kind: string; content: string; created_at: string }[]).reverse()
      .map((c) => ({ author: c.author_name ?? "不明", kind: c.author_kind, content: c.content ?? "", at: c.created_at.slice(0, 16).replace("T", " ") })),
    previousRuns: ((runs.data ?? []) as { created_at: string; status: string; summary: string | null }[])
      .map((r) => ({ at: r.created_at.slice(0, 16).replace("T", " "), status: r.status, summary: r.summary })),
    artifacts: ((artifacts.data ?? []) as { title: string }[]).map((x) => x.title),
    upstream,
    integrations,
    today: new Date().toISOString().slice(0, 10),
  };
}
