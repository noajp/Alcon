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
import { AGENT_MODELS, DEFAULT_AGENT_MODEL, costOf, isAgentModel, type AgentModel, type ModelUsage } from "../_shared/aiPricing.ts";
import {
  McpSession, callHttp, httpIsRead, HTTP_REQUEST_SCHEMA, isSafeEndpoint, type IntegrationRow, type RemoteTool,
} from "../_shared/integrationClient.ts";
import { baseAgentTools, baseKindOf, integrationPrefix, isStrategyTool, INTEGRATION_SEPARATOR } from "./agentTools.ts";
import { systemPrompt, taskMessage, type TaskContext } from "./context.ts";
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
const DEFAULT_MAX_TOTAL_TURNS = 60;
const MAX_CONTINUATIONS = 30;
const MAX_TOOLS = 120;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}


type Run = {
  id: string; element_id: string; domain_id: string | null; worker_id: string | null; status: string;
  mode: string; prompt: string | null; reply_to: string | null; triggered_by: string | null;
  transcript: { messages: Msg[]; turns: number; nudges: number; pending?: PendingApproval } | null;
  input_tokens: number; output_tokens: number; cost_usd: number; activity_space_id: string | null;
  continuation_count: number;
};

interface IntegrationTool { integration: IntegrationRow; remote: RemoteTool | null; secret: string | null; session: McpSession | null }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "server env not configured" }, 500);

  let body: { runId?: string; ping?: boolean; resume?: boolean; continue?: boolean; decision?: { actionId?: string; approve?: boolean; inputHash?: string; note?: string } };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }

  if (body.ping) {
    return json({ ok: !!anthropicKey, key_configured: !!anthropicKey, model_default: DEFAULT_AGENT_MODEL, allowed_models: Object.keys(AGENT_MODELS) });
  }
  if (!anthropicKey) return json({ error: "ANTHROPIC_API_KEY が設定されていません。" }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!jwt || jwt === anonKey) return json({ error: "sign-in required" }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authErr } = await userDb.auth.getUser(jwt);

  const runId = body.runId;
  if (!runId) return json({ error: "runId is required" }, 400);
  const { data: runRow } = await admin.from("agent_runs").select("*").eq("id", runId).maybeSingle();
  if (!runRow) return json({ error: "run not found" }, 404);
  const run = runRow as Run;

  if (authErr || !user) {
    // The session that started a long run has expired: pause, don't fail —
    // the person resumes it with a fresh session when they next open it.
    if (body.continue) {
      await admin.from("agent_runs").update({ status: "paused", error: "セッションの期限が切れたため一時停止しました。Element を開くと続きから再開します。" }).eq("id", runId).eq("status", "running");
    }
    return json({ error: "session expired or invalid" }, 401);
  }

  // The person must be able to see the Element (RLS answers that).
  const { data: visible } = await userDb.from("elements").select("id").eq("id", run.element_id).maybeSingle();
  if (!visible) return json({ error: "Element not found" }, 404);

  // A decision is checked before the run is touched: a stale or mismatched
  // decision is refused and the run keeps waiting for the right one.
  if (body.decision) {
    const d = body.decision;
    const { data: action } = await admin.from("agent_actions").select("id, status, input_hash").eq("id", d.actionId ?? "").eq("run_id", runId).maybeSingle();
    if (!action || action.status !== "pending" || !run.transcript?.pending) return json({ error: "この承認依頼はもう処理されています。" }, 409);
    if (d.inputHash !== action.input_hash) return json({ error: "承認の内容が提示したものと一致しません。画面を更新してやり直してください。" }, 409);
  }

  // Claim the run atomically for the transition this request makes.
  const from = body.decision ? "awaiting_approval" : body.continue ? "running" : body.resume ? "paused" : "queued";
  if (from !== "running") {
    const { data: claimed } = await admin.from("agent_runs")
      .update({ status: "running", error: null, ...(from === "queued" ? { started_at: new Date().toISOString() } : {}) })
      .eq("id", runId).eq("status", from).select("id").maybeSingle();
    if (!claimed) return json({ error: `run is not ${from} (status: ${run.status})` }, 409);
  } else if (run.status !== "running") {
    return json({ status: run.status }, 200);
  }

  const work = execute({ req, run, user: { id: user.id, email: user.email ?? null }, jwt, admin, userDb, anthropicKey, body, supabaseUrl })
    .catch(async (e) => {
      console.error("run-agent error", e);
      await failRun(admin, run, errorMessage(e));
    });
  // Answer now; the run continues in the background.
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work); else await work;
  return json({ status: "running" }, 202);
});

async function failRun(admin: SupabaseClient, run: Run, message: string) {
  await addStep(admin, run.id, "error", "実行に失敗しました", message);
  await admin.from("agent_runs").update({ status: "failed", error: message, finished_at: new Date().toISOString() }).eq("id", run.id);
  if (run.triggered_by) {
    await admin.from("notifications").insert({
      recipient_id: run.triggered_by, actor_name: "Alcon Agent", kind: "status_change", element_id: run.element_id,
      title: "エージェントの実行が失敗しました", body: message.slice(0, 200),
    }).then(() => {}, () => {});
  }
}

async function addStep(admin: SupabaseClient, runId: string, type: string, title: string, detail?: string | null) {
  const { data: last } = await admin.from("agent_run_steps").select("idx").eq("run_id", runId).order("idx", { ascending: false }).limit(1).maybeSingle();
  const idx = (last?.idx ?? -1) + 1;
  await admin.from("agent_run_steps").insert({ run_id: runId, idx, type, title: title.slice(0, 300), detail: detail ? String(detail).slice(0, 8000) : null });
  await admin.from("agent_runs").update({ step_count: idx + 1 }).eq("id", runId);
}

interface ExecArgs {
  req: Request; run: Run; user: { id: string; email: string | null }; jwt: string;
  admin: SupabaseClient; userDb: SupabaseClient; anthropicKey: string; supabaseUrl: string;
  body: { continue?: boolean; resume?: boolean; decision?: { actionId?: string; approve?: boolean; inputHash?: string; note?: string } };
}

async function execute(a: ExecArgs): Promise<void> {
  const { run, admin, userDb, user } = a;

  // ── Agent profile ───────────────────────────────────────────────────────
  let agentName = "Alcon Agent";
  let instructions: string | null = null;
  let model: AgentModel = DEFAULT_AGENT_MODEL;
  let maxTotalTurns = DEFAULT_MAX_TOTAL_TURNS;
  let workerId = run.worker_id;
  if (!workerId) {
    // The AI Worker assigned to the Element, if any, is the one who works it.
    const { data: assigned } = await userDb.from("element_assignees").select("worker:workers(id, type)").eq("element_id", run.element_id);
    const workers = ((assigned ?? []) as unknown as { worker: { id: string; type: string } | { id: string; type: string }[] | null }[])
      .flatMap((r) => (Array.isArray(r.worker) ? r.worker : r.worker ? [r.worker] : []));
    const ai = workers.find((w) => w.type === "ai_agent");
    workerId = ai?.id ?? null;
  }
  if (workerId) {
    const { data: w } = await userDb.from("workers").select("name, ai_config, ai_model").eq("id", workerId).maybeSingle();
    if (w) {
      agentName = w.name || agentName;
      const cfg = (w.ai_config && typeof w.ai_config === "object" ? w.ai_config : {}) as Record<string, unknown>;
      if (typeof cfg.instructions === "string" && cfg.instructions.trim()) instructions = cfg.instructions.trim();
      if (isAgentModel(cfg.model)) model = cfg.model; else if (isAgentModel(w.ai_model)) model = w.ai_model;
      if (typeof cfg.max_turns === "number" && cfg.max_turns >= 5 && cfg.max_turns <= 200) maxTotalTurns = Math.floor(cfg.max_turns);
    }
  }
  await admin.from("agent_runs").update({ model, worker_id: workerId }).eq("id", run.id);
  const actor: BoardActor = { agent: `${agentName}（AI）`, userId: user.id };

  // ── Budget ──────────────────────────────────────────────────────────────
  let budget = Number.POSITIVE_INFINITY;
  let spentBefore = 0;
  if (run.activity_space_id) {
    const { data: space } = await admin.from("activity_spaces").select("ai_monthly_budget_usd").eq("id", run.activity_space_id).maybeSingle();
    budget = Number(space?.ai_monthly_budget_usd ?? 20);
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const { data: spent } = await admin.from("agent_runs").select("cost_usd").eq("activity_space_id", run.activity_space_id).gte("created_at", monthStart.toISOString()).neq("id", run.id);
    spentBefore = (spent ?? []).reduce((s: number, r: { cost_usd: number | string }) => s + Number(r.cost_usd || 0), 0);
  }
  let usage = { input: run.input_tokens, output: run.output_tokens, cost: Number(run.cost_usd || 0) };

  // ── Integrations (the person must be a member of the Space to list them) ─
  const integrationTools = new Map<string, IntegrationTool>();
  const integrationDefs: ToolDef[] = [];
  const integrationSummary: TaskContext["integrations"] = [];
  if (run.activity_space_id) {
    const { data: rows } = await userDb.from("integrations")
      .select("id, kind, name, description, endpoint, auth_type, auth_header, delegation, enabled")
      .eq("activity_space_id", run.activity_space_id).eq("enabled", true).order("created_at");
    for (const row of (rows ?? []) as (IntegrationRow & { enabled: boolean })[]) {
      if (!isSafeEndpoint(row.endpoint)) continue;
      const { data: secret } = await admin.rpc("get_integration_secret", { p_integration_id: row.id });
      const prefix = integrationPrefix(row.name, row.id);
      try {
        if (row.kind === "mcp") {
          const session = new McpSession(row, (secret as string | null) ?? null);
          await session.initialize();
          const tools = await session.listTools();
          for (const t of tools) {
            if (integrationDefs.length >= MAX_TOOLS) break;
            const name = `${prefix}${INTEGRATION_SEPARATOR}${t.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
            integrationTools.set(name, { integration: row, remote: t, secret: (secret as string | null) ?? null, session });
            integrationDefs.push({ name, description: `[${row.name}] ${t.description}`.slice(0, 1024), input_schema: t.inputSchema });
          }
          integrationSummary.push({ name: row.name, kind: "MCP", delegation: row.delegation, tools: tools.length });
        } else {
          const name = `${prefix}${INTEGRATION_SEPARATOR}http_request`;
          integrationTools.set(name, { integration: row, remote: null, secret: (secret as string | null) ?? null, session: null });
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

  const tools: ToolDef[] = [...baseAgentTools(), ...integrationDefs];
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
  const subelementIds = new Set<string>();
  {
    const { data: subs } = await userDb.from("subelements").select("id").eq("element_id", run.element_id);
    for (const s of subs ?? []) subelementIds.add(s.id as string);
  }

  const callIntegration = async (call: ToolCall): Promise<{ content: string; is_error?: boolean }> => {
    const it = integrationTools.get(call.name);
    if (!it) return { content: "Unknown tool.", is_error: true };
    const r = it.remote && it.session
      ? await it.session.callTool(it.remote.name, call.input)
      : await callHttp(it.integration, it.secret, call.input);
    return { content: r.text, ...(r.isError ? { is_error: true } : {}) };
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
      await addStep(admin, run.id, "action", `${it.integration.name}: ${it.remote?.name ?? `${call.input.method ?? ""} ${call.input.path ?? ""}`}`, r.is_error ? r.content.slice(0, 500) : null);
      return r;
    }
    return { content: "Unknown tool.", is_error: true };
  };

  // ── State ───────────────────────────────────────────────────────────────
  let state: LoopState;
  if (run.transcript?.messages?.length) {
    state = { messages: run.transcript.messages, turns: run.transcript.turns ?? 0, nudges: run.transcript.nudges ?? 0 };
  } else {
    state = { messages: [{ role: "user", content: taskMessage(await loadContext(userDb, run, integrationSummary)) }], turns: 0, nudges: 0 };
    await addStep(admin, run.id, "status", run.mode === "reply" ? "依頼を受けて実行を開始" : "任務の実行を開始", `${agentName} / ${AGENT_MODELS[model].label}`);
  }

  // A decision on a pending approval answers the paused turn first.
  if (a.body.decision) {
    const pending = run.transcript?.pending;
    const d = a.body.decision;
    const { data: action } = await admin.from("agent_actions").select("*").eq("id", d.actionId ?? "").eq("run_id", run.id).maybeSingle();
    if (!pending || !action || action.status !== "pending") throw new Error("この承認依頼はもう処理されています。");
    if (d.inputHash !== action.input_hash) throw new Error("承認の内容が提示したものと一致しません。画面を更新してやり直してください。");
    const writeResults: ToolResult[] = [];
    if (d.approve) {
      await admin.from("agent_actions").update({ status: "approved", decided_by: user.id, decided_at: new Date().toISOString(), decision_note: d.note ?? null }).eq("id", action.id);
      await addStep(admin, run.id, "approval", "承認されました", d.note ?? null);
      let failed = 0;
      for (const call of pending.calls) {
        try {
          const r = await executeCall(call);
          if (r.is_error) failed++;
          writeResults.push({ type: "tool_result", tool_use_id: call.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) });
        } catch (e) {
          failed++;
          writeResults.push({ type: "tool_result", tool_use_id: call.id, content: `Error: ${errorMessage(e)}`, is_error: true });
        }
      }
      await admin.from("agent_actions").update({ status: failed === pending.calls.length ? "failed" : "executed", result: { failed, total: pending.calls.length } }).eq("id", action.id);
    } else {
      await admin.from("agent_actions").update({ status: "rejected", decided_by: user.id, decided_at: new Date().toISOString(), decision_note: d.note ?? null }).eq("id", action.id);
      await addStep(admin, run.id, "approval", "却下されました", d.note ?? null);
      for (const call of pending.calls) {
        writeResults.push({ type: "tool_result", tool_use_id: call.id, content: `依頼した人が却下しました。${d.note ? `理由・指示: ${d.note}` : ""} 実行していません。指示に沿って案を直すか、finish してください。`, is_error: true });
      }
    }
    appendDecisionResults(state, pending, writeResults);
  }

  // ── Model ───────────────────────────────────────────────────────────────
  const client = new Anthropic({ apiKey: a.anthropicKey });
  const system = [{ type: "text" as const, text: systemPrompt({ name: agentName, instructions }), cache_control: { type: "ephemeral" as const } }];
  const toolParams = tools.map((t, i) => ({
    name: t.name, description: t.description, input_schema: t.input_schema,
    ...(i === tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));

  const outcome = await runLoop(state, {
    callModel: async (messages) => {
      // deno-lint-ignore no-explicit-any
      const res: any = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        system,
        // deno-lint-ignore no-explicit-any
        tools: toolParams as any,
        // deno-lint-ignore no-explicit-any
        messages: messages as any,
        betas: ["context-management-2025-06-27"],
        context_management: { edits: [{ type: "clear_tool_uses_20250919" }] },
      // deno-lint-ignore no-explicit-any
      } as any);
      return { content: res.content, stop_reason: res.stop_reason, usage: res.usage };
    },
    kindOf,
    needsApproval: (call) => {
      if (kindOf(call.name) !== "write") return false;
      if (isRead(call)) return false;
      const it = integrationTools.get(call.name);
      return !it || it.integration.delegation !== "full_delegation";
    },
    execute: async (call) => {
      // Integration reads run right away; an integration call reaching here
      // that is a write was fully delegated.
      return executeCall(call);
    },
    onUsage: async (u: ModelUsage) => {
      usage = {
        input: usage.input + (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        output: usage.output + (u.output_tokens ?? 0),
        cost: Math.round((usage.cost + costOf(model, u)) * 1_000_000) / 1_000_000,
      };
      await admin.from("agent_runs").update({ input_tokens: usage.input, output_tokens: usage.output, cost_usd: usage.cost }).eq("id", run.id);
    },
    budgetExceeded: () => spentBefore + usage.cost >= budget,
    cancelled: async () => {
      const { data } = await admin.from("agent_runs").select("status").eq("id", run.id).maybeSingle();
      return data?.status === "cancelled";
    },
  // Resuming a paused run grants a fresh allowance on top of the turns taken.
  }, { maxTurnsThisCall: MAX_TURNS_PER_SLICE, maxTotalTurns: maxTotalTurns + (a.body.resume ? state.turns : 0), deadline: Date.now() + SLICE_MS });

  const saveTranscript = async (pending?: PendingApproval) => {
    await admin.from("agent_runs").update({ transcript: { messages: state.messages, turns: state.turns, nudges: state.nudges, ...(pending ? { pending } : {}) } }).eq("id", run.id);
  };

  // ── Outcome ─────────────────────────────────────────────────────────────
  switch (outcome.kind) {
    case "finished":
      await saveTranscript();
      await finishRun(a, run, agentName, outcome.finish);
      return;

    case "approval": {
      await saveTranscript(outcome.pending);
      const calls = outcome.pending.calls;
      const lines = calls.map((c) => {
        const it = integrationTools.get(c.name);
        const what = it?.remote ? it.remote.name : `${c.input.method ?? ""} ${c.input.path ?? ""}`;
        return `- **${it?.integration.name ?? c.name}** ${what}\n\`\`\`json\n${JSON.stringify(c.input, null, 2).slice(0, 1500)}\n\`\`\``;
      });
      const summary = calls.length === 1 ? "外部への書き込み 1 件の承認待ち" : `外部への書き込み ${calls.length} 件の承認待ち`;
      const inputHash = await sha256(canonicalCalls(calls));
      const { data: action } = await admin.from("agent_actions").insert({
        run_id: run.id, element_id: run.element_id, tool_use_id: calls[0].id, tool: calls.length === 1 ? calls[0].name : "batch",
        input: { calls }, input_hash: inputHash, summary, integration_id: integrationTools.get(calls[0].name)?.integration.id ?? null,
      }).select("id").single();
      await addStep(admin, run.id, "approval", summary, lines.join("\n").slice(0, 8000));
      await admin.from("agent_runs").update({ status: "awaiting_approval" }).eq("id", run.id);
      await admin.from("element_comments").insert({
        element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
        content: `**承認をお願いします** — ${summary}\n\n${lines.join("\n").slice(0, 6000)}\n\nエージェントのパネルで承認・却下できます。`,
      });
      if (run.triggered_by) {
        await admin.from("notifications").insert({
          recipient_id: run.triggered_by, actor_name: agentName, kind: "approval_requested", element_id: run.element_id,
          title: `${agentName} が承認を求めています`, body: summary,
        }).then(() => {}, () => {});
      }
      void action;
      return;
    }

    case "yield": {
      await saveTranscript();
      if (!a.body.resume && run.continuation_count + 1 > MAX_CONTINUATIONS) {
        await finishRun(a, run, agentName, { outcome: "partial", summary: "実行の上限に達しました", message: "作業量が多いため、実行の上限で区切りました。続きは「続きを実行」から再開できます。" }, "paused");
        return;
      }
      await admin.from("agent_runs").update({ continuation_count: (a.body.resume ? 0 : run.continuation_count) + 1 }).eq("id", run.id);
      await addStep(admin, run.id, "status", "区切りました — 続きを実行します");
      // The next slice, with the same person's session, in a fresh invocation.
      await fetch(`${a.supabaseUrl}/functions/v1/run-agent`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${a.jwt}` },
        body: JSON.stringify({ runId: run.id, continue: true }),
      }).catch(async (e) => {
        await admin.from("agent_runs").update({ status: "paused", error: `続きを開始できませんでした: ${errorMessage(e)}` }).eq("id", run.id);
      });
      return;
    }

    case "limit":
      await saveTranscript();
      await finishRun(a, run, agentName, { outcome: "partial", summary: "ターン数の上限に達しました", message: "設定されたターン数の上限に達したため、ここで区切りました。続きは「続きを実行」から再開できます。" }, "paused");
      return;

    case "budget":
      await saveTranscript();
      await admin.from("agent_runs").update({ status: "paused", error: "この Space の今月の AI 予算の上限に達したため一時停止しました。" }).eq("id", run.id);
      await addStep(admin, run.id, "error", "予算の上限に達しました", `今月の使用額が上限 $${budget} に達しました。`);
      return;

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
  const label = finish.outcome === "completed" ? "完了報告" : finish.outcome === "partial" ? "途中報告" : "対応が必要です";
  const content = `**${label}** — ${finish.summary}\n\n${finish.message || finish.summary}`;
  await admin.from("element_comments").insert({
    element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
    content, ...(run.reply_to ? { parent_id: run.reply_to } : {}),
  });
  await addStep(admin, run.id, "result", finish.summary, finish.message);

  // In execute mode the Element moves on: done work waits for a person's
  // review, blocked work says so. A reply leaves the status alone.
  if (run.mode !== "reply" && status !== "paused") {
    const { data: el } = await userDb.from("elements").select("status").eq("id", run.element_id).maybeSingle();
    const next = finish.outcome === "completed" ? "review" : finish.outcome === "blocked" ? "blocked" : null;
    if (el && next && !["done", "cancelled"].includes(el.status ?? "") && el.status !== next) {
      await runBoardTool(userDb, "updateElement", { id: run.element_id, status: next }, { agent: `${agentName}（AI）`, userId: user.id });
      await addStep(admin, run.id, "status", next === "review" ? "Element をレビュー待ちに移動" : "Element をブロック中に移動");
    }
  }

  const runStatus = status ?? (finish.outcome === "completed" ? (run.mode === "reply" ? "completed" : "awaiting_review") : finish.outcome === "blocked" ? "completed" : "completed");
  await admin.from("agent_runs").update({
    status: runStatus, summary: finish.summary, result: finish.message, finished_at: status ? null : new Date().toISOString(),
    error: status === "paused" ? finish.summary : null,
  }).eq("id", run.id);
  if (run.triggered_by) {
    await admin.from("notifications").insert({
      recipient_id: run.triggered_by, actor_name: agentName, kind: "status_change", element_id: run.element_id,
      title: `${agentName}: ${label}`, body: finish.summary,
    }).then(() => {}, () => {});
  }
}

async function loadContext(userDb: SupabaseClient, run: Run, integrations: TaskContext["integrations"]): Promise<TaskContext> {
  const { data: el } = await userDb.from("elements")
    .select("id, display_id, title, description, status, priority, due_date, labels, object_id").eq("id", run.element_id).single();
  if (!el) throw new Error("対象の Element が見つかりません。");
  const [subs, comments, runs, artifacts, obj, links] = await Promise.all([
    userDb.from("subelements").select("id, title, is_completed").eq("element_id", run.element_id).order("order_index"),
    userDb.from("element_comments").select("author_name, author_kind, content, created_at").eq("element_id", run.element_id).order("created_at", { ascending: false }).limit(15),
    userDb.from("agent_runs").select("created_at, status, summary").eq("element_id", run.element_id).neq("id", run.id).order("created_at", { ascending: false }).limit(3),
    userDb.from("agent_artifacts").select("title").eq("element_id", run.element_id).order("created_at"),
    el?.object_id ? userDb.from("objects").select("name").eq("id", el.object_id).maybeSingle() : Promise.resolve({ data: null }),
    el?.object_id ? userDb.from("strategy_objects").select("strategy_id").eq("object_id", el.object_id) : Promise.resolve({ data: [] }),
  ]);
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
    subelements: (subs.data ?? []).map((s: { id: string; title: string; is_completed: boolean | null }) => ({ id: s.id, title: s.title, is_completed: !!s.is_completed })),
    initiatives,
    comments: ((comments.data ?? []) as { author_name: string | null; author_kind: string; content: string; created_at: string }[]).reverse()
      .map((c) => ({ author: c.author_name ?? "不明", kind: c.author_kind, content: c.content ?? "", at: c.created_at.slice(0, 16).replace("T", " ") })),
    previousRuns: ((runs.data ?? []) as { created_at: string; status: string; summary: string | null }[])
      .map((r) => ({ at: r.created_at.slice(0, 16).replace("T", " "), status: r.status, summary: r.summary })),
    artifacts: ((artifacts.data ?? []) as { title: string }[]).map((x) => x.title),
    integrations,
    today: new Date().toISOString().slice(0, 10),
  };
}
