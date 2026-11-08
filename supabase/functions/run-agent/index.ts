// run-agent — Athena, Alcon's one agent engine (ADR 0027).
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
//   { runId, decision: { actionId, approve, inputHash, note?, remember? } }
//                                               decide on a pending approval;
//                                               `remember` (input field names)
//                                               also lets the same command with
//                                               the same values run without
//                                               asking from now on
//   { runId, message }                          a conversation on a Strategy
//                                               (conversation.ts): the person's
//                                               next message; the run answers
//                                               and waits for the one after
//   { runId, message, context?, attachments? }  a Copilot chat (its run's
//                                               subject is the session): the
//                                               panel's send — the person's
//                                               words, where they are, and
//                                               any files; Athena's chat
//                                               driver answers on the run
//   { runId } / { runId, message }              a connection draft (G4; its
//                                               run's subject is the draft):
//                                               Athena drafts the manifest
//                                               from the official spec; a
//                                               message answers its question
//                                               or asks it to fix a test
//   { runId } / { runId, message }              a promotion draft (its run's
//                                               subject is the draft): Athena
//                                               drafts a standing harness
//                                               (a definition and its binding)
//                                               from one-off work's record; a
//                                               message answers its question
//                                               or asks it to fix a rehearsal
//   { runId, continue: true }                   internal: the next slice of a
//                                               long run (self-invoked)
//   { advance: elementId }                      a person finished an Element:
//                                               start the AI Elements it unblocks
//                                               (only under a Strategy set to 'auto')
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
import { resolveElementIdTraced, runBoardTool, updateElementById, errorMessage, type BoardActor, type ToolDef } from "../_shared/boardTools.ts";
import { runStrategyTool } from "../_shared/strategyTools.ts";
import { AGENT_MODELS, DEFAULT_AGENT_MODEL, costAt, costOf, type ModelUsage } from "../_shared/aiPricing.ts";
import {
  McpSession, HTTP_REQUEST_SCHEMA, isAuthFailure, isSafeEndpoint, pointsAtAlcon, resolveCredential, type IntegrationRow,
} from "../_shared/integrationClient.ts";
import { isGoogleDriveRow } from "../_shared/googleOAuth.ts";
import { fetchPull, pullUrlsIn, upsertCodeChange, withGithubToken } from "../_shared/github.ts";
import { DRIVE_TOOLS } from "../_shared/googleDrive.ts";
import { RECORD_TOOLS } from "./records.ts";
import { readRecords, saveRecords, strategyOfElement, strategyTableLines, type RecordScope } from "./recordStore.ts";
import { TOOL_SEARCH, needsToolSearch, toolParamsFor, withDeferral, type RunToolDef } from "../_shared/toolLoading.ts";
import { ROUND_TOOL, approvalSummary, baseAgentTools, baseKindOf, integrationPrefix, INTEGRATION_SEPARATOR, uniqueToolName, webSteps, webTools } from "./agentTools.ts";
import {
  adoptPlannedTools, approvalDisplayForCall, bindingOf, criticalOfTool, executeIntegrationTool, integrationApprovalFacts, integrationCallIsRead, lazyBinding, manifestDenyRefusal, operationOf, planManifestTools,
  type ApprovalDisplay, type IntegrationBinding, type IntegrationTool, type PlannedIntegrationTool,
} from "../_shared/integrationTools.ts";
import { loadToolPlans, planCacheState, planFingerprint, saveToolPlan } from "../_shared/integrationPlans.ts";
import { catalogDenyRefusal, catalogIndex, catalogOperation, catalogTool, decideCall, effectOfCall, isCatalogTool, mayNeedApproval, runCatalogTool } from "../_shared/catalog.ts";
import { systemPrompt, taskMessage, type TaskContext } from "./context.ts";
import { conversationKindOf, conversationOpening, conversationSystemPrompt, conversationTools, PLANNER_TOOL, START_TOOL, ANSWER_TOOL, CONNECT_TOOL, type ConversationContext } from "./conversation.ts";
import { CONNECTOR_PRESET_NAMES, foldConnectorName, missingConnectorNames } from "../_shared/connectorNeeds.ts";
import { CONNECTION_PROPOSED_REPLY, resolveConnectionProposal } from "../_shared/connectProposal.ts";
import { matchPendingCapabilities } from "../_shared/pendingCapability.ts";
import { resolveAgentConfig, type DomainConfigRow, type WorkerConfigRow } from "./agentConfig.ts";
import { readVerdict, VERDICT_SCHEMA, VERIFY_SYSTEM, verifyPrompt } from "./verify.ts";
import { delegationOf, readyDownstream, type AdvanceCandidate } from "./advance.ts";
import { resolveDefinition, type DefinitionCandidate } from "../_shared/definitionResolution.ts";
import { artifactFileName, saveArtifactFile } from "./artifactFile.ts";
import { isGithubOAuthRow } from "../_shared/githubOAuth.ts";
import { offeredCommands, parseManifest, requestFor, ruleFromCalls, withRule, type Manifest } from "../_shared/connectorManifest.ts";
import {
  applyMode, approvalModeOf, approvalVerdict, liftOf, type ApprovalFacts, type ApprovalMode, type ApprovalVerdict,
} from "../_shared/approvalPolicy.ts";
import { displaysUnderMode, recordPolicyApproval, settlePolicyApproval } from "../_shared/policyApproval.ts";
import { buildRunVerdict, parseRunVerdict, type RunVerdict, type VerdictInputs } from "../_shared/runVerdict.ts";
import { parseProposedReadings, readingsDecision, readingsSummaryLine, validateProposals, type BoundMeasure, type ProposedReading } from "../_shared/readingsGate.ts";
import { checkHarness, checkOutput, checksDue, definitionPrompt, loopStop, parseDefinition, type ParsedDefinition } from "../_shared/definition.ts";
import { isMachineTool, isRunnerTool, machineResultText, MACHINE_TOOLS, pickRunner, RUNNER_TOOLS, runnerOperation, runnerResultText, runnerStep, type RunnerRow } from "./runnerTools.ts";
import {
  runLoop, canonicalCalls,
  type Block, type LoopState, type ToolCall, type ToolKind, type FinishPayload, type Msg,
  type PendingApproval,
} from "../_shared/agentLoop.ts";
import { applyDecision, makeRememberApproval, restorePendingApproval, type SavedPending } from "./decision.ts";
import { buildCopilotTurn, foldCopilotContext, type CopilotContextLike, type CopilotTurn } from "../_shared/copilotTurn.ts";
import { COPILOT_AGENT_NAME, persistCopilotApproval, updateCopilotSessionMessages } from "../_shared/copilotAnchor.ts";
import {
  copilotApprovalExpiresAt, resumedAssistantMessage, seedMessagesFromPanel, withApprovalDecision,
  type PanelMessage, type PanelToolEvent,
} from "../_shared/copilotSession.ts";
import { claimFor, driverForRun, entryForBody, heartbeatEntryAllowed, messageAllowed } from "./dispatch.ts";
import { ASK_TOOL, FINISH_TOOL, PROPOSE_TOOL, draftKindOf, draftOpening, draftSystemPrompt, draftTools } from "./drafter.ts";
import {
  AI_DRAFTED_PRESET, DRAFT_OPEN_STATUSES, openDraftsForNames, reconcileDraft, unaccountedDrops, validateDraftCandidate,
  type DraftCandidate, type DraftDrop,
} from "../_shared/connectorDraft.ts";
import { applyCandidate, askDraft, loadDraft, transitionDraft, type DraftRow } from "../_shared/integrationDrafts.ts";
import { FINISH_PROMOTION_TOOL, PROMOTE_ASK_TOOL, PROPOSE_PACKAGE_TOOL, promotionKindOf, promotionOpening, promotionSystemPrompt, promotionTools } from "./promoter.ts";
import { cleanPromotionMaterial, promotionStructureHash, reconcilePromotionPackage, REHEARSAL_COST_CAP_USD, type PromotionPackage } from "../_shared/promotion.ts";
import {
  emptyRehearsalReport, readRehearsalReport, summarizeRehearsalReport, REHEARSAL_TASK_NOTICE,
  type RehearsalReport,
} from "../_shared/rehearsal.ts";
import {
  applyPromotionPackage, appendPromotionEvent, askPromotionDraft, draftPackageOf, loadPromotionDraft, transitionPromotionDraft,
  type PromotionDraftRow, type PromotionMaterialSource,
} from "../_shared/promotionDrafts.ts";
import { connectedConnectorNames, evaluatePromotionPackage, freezePromotionPackage, launchPromotionRehearsal, settlePromotionRehearsal } from "../_shared/promotionTest.ts";
import { draftRounds, materializeDraft, runDraftTestRound, summarizeRound } from "../_shared/draftTest.ts";
import { REGISTRY_URL, entriesOf } from "../_shared/connectorDirectory.ts";
import { draftDue } from "./draft.ts";
import {
  buildHeartbeatSnapshot, carryDigestFingerprints, digestTitleFor, fingerprintOf,
  HEARTBEAT_KIND_LABEL, type HeartbeatSignal,
} from "../_shared/heartbeatSnapshot.ts";
import { loadRunBudget, USER_MONTHLY_BUDGET_USD } from "./budget.ts";
import { captureMemories, captureScopeOf, landingWorthDistilling, loadStepTitles } from "./memoryCapture.ts";
import { loadMemoryContext, recordMemoryUses } from "../_shared/memoryDb.ts";
import { requestContent, type Attachment } from "../_shared/attachments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_TURNS_PER_SLICE = 14;
const SLICE_MS = 110_000;          // stay well inside the platform's wall clock
const MAX_CONTINUATIONS = 30;
const MAX_TOOLS = 120;
const WEIGHT_LABEL = { light: "軽い", standard: "標準", heavy: "重い" } as const;
/** No single run may spend more than this, whatever the budget left. */
const MAX_RUN_COST_USD = 5;
/** No single heartbeat wake may spend more than this: triage is a
 *  small judgement, and the cap plus the turn limit stop a wake from
 *  ever becoming the work it watches. */
const MAX_HEARTBEAT_WAKE_COST_USD = 0.05;
const HEARTBEAT_MAX_TURNS = 3;
/** A definition may raise a run's cap to its own budget, never past this. */
const MAX_DEFINED_RUN_COST_USD = 50;
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


type Transcript = {
  messages: Msg[]; turns: number; nudges: number;
  /** Times the verifier sent a finish back. */
  revisions?: number;
  /** Turns the run may take in all; grows when its starter resumes it. */
  turnBudget?: number;
  /** The tool definitions frozen at the first slice, so later slices send the same prefix. */
  tools?: RunToolDef[];
  pending?: SavedPending;
  /** A chat run's kept view context: where its person was, last told. */
  context?: CopilotContextLike;
  /** A heartbeat run's digest memory: what its wake told, so the next
   *  wake does not tell it again (dedup reads the last completed
   *  wake's, in _shared/heartbeatSnapshot.ts). */
  digest?: { at: string; fingerprints: string[] };
  /** A rehearsal run's report as it accumulates (reads executed,
   *  writes planned), sealed onto the draft when the run settles. */
  rehearsal?: RehearsalReport;
  /** The definition a rehearsal run is trying, carried here rather
   *  than in a definitions row: nothing is born before activation. */
  rehearsalDefinition?: { name: string; body: string };
};
type Run = {
  id: string; element_id: string; strategy_id: string | null; ai_session_id: string | null; integration_draft_id: string | null; promotion_draft_id: string | null; domain_id: string | null; worker_id: string | null; status: string;
  mode: string; prompt: string | null; reply_to: string | null; triggered_by: string | null;
  /** A run trying a definition with its writes blocked (the rehearsal substrate). */
  rehearsal: boolean;
  transcript: Transcript | null; step_count: number; model: string | null;
  input_tokens: number; output_tokens: number; cost_usd: number; activity_space_id: string | null;
  continuation_count: number; continuation_token: string | null;
  /** The approval mode this run started under, snapshotted by serve(); null until first driven. */
  approval_mode: string | null;
};

// IntegrationTool and ApprovalDisplay live in _shared/integrationTools.ts,
// with the manifest→tool planning, the approval facts and the executor every
// caller shares (run-agent and alcon-copilot alike).

/** An integration this run cannot use, told to the agent with the reason. */
function downIntegration(name: string, reason: string): TaskContext["integrations"][number] {
  return { name, kind: "使えない", delegation: "", tools: 0, down: reason };
}

/** Preset display names (web/src/AIP/connectors/catalog.ts): a harness may name a connector by any of them. */
const PRESET_NAMES: Record<string, string> = {
  linear: "Linear", asana: "Asana", "google-drive": "Google Drive", github: "GitHub", slack: "Slack",
  deepseek: "DeepSeek", kimi: "Kimi", "custom-mcp": "Custom MCP", "custom-http": "Custom API", "custom-model": "Custom model API",
};

/** The fold harness connector names are matched by (the same fold as checkHarness). */
const foldName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

/** A Space's approval mode, read with the service role: policy comes from
 *  the Space's row, never from the request or the model. An unreadable or
 *  unknown value is "auto" — the mode that changes nothing. */
async function loadSpaceApprovalMode(admin: SupabaseClient, spaceId: string): Promise<ApprovalMode> {
  const { data } = await admin.from("activity_spaces").select("approval_mode").eq("id", spaceId).maybeSingle();
  return approvalModeOf((data as { approval_mode?: unknown } | null)?.approval_mode);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "server env not configured" }, 500);

  let body: {
    runId?: string; advance?: string; ping?: boolean; resume?: boolean; continue?: boolean; token?: string; message?: string;
    decision?: { actionId?: string; approve?: boolean; inputHash?: string; note?: string; remember?: string[] };
    context?: CopilotContextLike; attachments?: Attachment[];
  };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }

  if (body.ping) {
    return json({ ok: !!anthropicKey, key_configured: !!anthropicKey, model_default: DEFAULT_AGENT_MODEL, allowed_models: Object.keys(AGENT_MODELS) });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!jwt || jwt === anonKey) return json({ error: "sign-in required" }, 401);
  const runId = body.runId;
  if (!runId && !body.advance) return json({ error: "runId is required" }, 400);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await userDb.auth.getUser(jwt);

  // A person closed an Element: under 'auto', what it unblocks starts, as
  // that person — the same step an AI's finished run takes.
  if (body.advance) {
    if (!user) return json({ error: "session expired or invalid" }, 401);
    const { data: el } = await userDb.from("elements").select("id, status").eq("id", body.advance).maybeSingle();
    if (!el) return json({ error: "element not found" }, 404);
    // Closing done accepts the work — and with it, the readings its latest
    // run held for this acceptance. That happens whatever the delegation;
    // a cancelled Element's numbers never land. It must not fail the close.
    if (el.status === "done") {
      await applyHeldReadings({ admin, userDb, user: { id: user.id } }, el.id)
        .catch((e) => console.error("run-agent: held readings failed", errorMessage(e)));
    }
    // Cancelled settles a prerequisite as much as done does.
    if (!["done", "cancelled"].includes(el.status ?? "") || (await elementDelegation(userDb, el.id)) !== "auto") return json({ started: [] });
    const started = await advanceFrom({ admin, userDb, user: { id: user.id, email: user.email ?? null }, jwt, supabaseUrl }, el.id);
    return json({ started });
  }
  if (!runId) return json({ error: "runId is required" }, 400);
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
    // Bound to what is about to run, not only to what the row says.
    const runningHash = await sha256(canonicalCalls(run.transcript.pending.calls));
    if (d.inputHash !== action.input_hash || runningHash !== action.input_hash) return json({ error: "承認の内容が提示したものと一致しません。画面を更新してやり直してください。" }, 409);
  }

  // The run's driver is its subject (dispatch.ts): an Element's work, a
  // Strategy conversation, or a Copilot chat. A message may be posted to
  // either conversation; a work run takes its words from its Element.
  const driver = driverForRun(run);
  // A chat run whose conversation was deleted keeps its record but has
  // no turn left to continue; its approval lapses on the automations tick.
  if (driver === "chat" && !run.ai_session_id) return json({ error: "この会話は削除されています。承認は期限で自動的に取り消されます。" }, 409);
  const said = typeof body.message === "string" ? body.message.trim() : "";
  const entry = entryForBody(body);
  // A heartbeat takes no words and no decisions: it is driven by its
  // schedule's start, and by the tick's revival of a cut-off wake.
  if (driver === "heartbeat" && !heartbeatEntryAllowed(entry)) return json({ error: "ハートビートはスケジュールからのみ駆動されます。" }, 400);
  if (entry === "message") {
    if (!messageAllowed(driver)) return json({ error: "この実行は会話ではありません。" }, 400);
    // A message of files alone is still a message: its words are the
    // fallback the attachment blocks carry.
    if (!said && !(Array.isArray(body.attachments) && body.attachments.length > 0)) return json({ error: "message が空です。" }, 400);
    if (said.length > 20_000) return json({ error: "message は 20000 文字までです。" }, 400);
  } else if (driver === "converse" && entry !== "continue") return json({ error: "会話には message を送ってください。" }, 400);

  // Claim the run atomically for the transition this request makes; the
  // statuses each entry may claim from are the dispatch table's.
  let claim = admin.from("agent_runs").update({ status: "running", error: null, continuation_token: null }).eq("id", runId);
  if (entry === "message") {
    if (run.status === "running") return json({ error: "応答中です。返事を待ってから送ってください。" }, 409);
    claim = admin.from("agent_runs").update({ status: "running", error: null, continuation_token: null, started_at: run.status === "queued" ? new Date().toISOString() : undefined })
      .eq("id", runId).in("status", [...claimFor("message").from]);
  } else if (entry === "decision") claim = claim.eq("status", claimFor("decision").from[0]);
  else if (entry === "continue") claim = claim.eq("status", claimFor("continue").from[0]).eq("continuation_token", body.token ?? "\u0000");
  else if (entry === "resume") {
    if (run.status === "running") {
      // A stuck run (the platform cut a slice off) may be resumed by its starter.
      const { data: last } = await admin.from("agent_run_steps").select("created_at").eq("run_id", runId).order("idx", { ascending: false }).limit(1).maybeSingle();
      const quietFor = Date.now() - new Date(last?.created_at ?? 0).getTime();
      if (quietFor < STALE_MS) return json({ error: "実行中です。" }, 409);
      claim = claim.eq("status", "running").eq("step_count", run.step_count);
    } else claim = claim.eq("status", claimFor("resume").from[0]);
  } else claim = admin.from("agent_runs").update({ status: "running", error: null, started_at: new Date().toISOString() }).eq("id", runId).eq("status", claimFor("start").from[0]);
  const { data: claimed } = await claim.select("id").maybeSingle();
  if (!claimed) return json({ error: `この実行は今その操作を受け付けません（${run.status}）。` }, 409);

  // The run's approval mode: the snapshot it started under wins — a mode
  // changed mid-run reaches the next run, not into this one, and never
  // retroactively approves what already waits. A run first driven now
  // takes its Space's current mode and keeps it; a personal run (no
  // Space) is fixed to "auto". Stamped before the driver runs, so the
  // record says under which policy the work happened.
  let approvalMode = approvalModeOf(run.approval_mode);
  if (run.approval_mode == null) {
    if (run.activity_space_id) approvalMode = await loadSpaceApprovalMode(admin, run.activity_space_id);
    run.approval_mode = approvalMode;
    await admin.from("agent_runs").update({ approval_mode: approvalMode }).eq("id", run.id);
  }

  const args: ExecArgs = { req, run, user: { id: user.id, email: user.email ?? null }, jwt, admin, userDb, anthropicKey: anthropicKey ?? null, body, supabaseUrl, approvalMode };
  const work = (driver === "converse" ? converse(args, said) : driver === "chat" ? chat(args, said) : driver === "draft" ? draft(args, said) : driver === "promote" ? promote(args, said) : driver === "heartbeat" ? heartbeat(args) : execute(args))
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

/** A GitHub integration: the preset, or a custom connection to GitHub's MCP server or API. */
function isGithubRow(row: IntegrationRow): boolean {
  return row.preset === "github" || /^https:\/\/(api\.)?github(copilot)?\.com\//.test(row.endpoint);
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

async function addStep(admin: SupabaseClient, runId: string, type: string, title: string, detail?: string | null): Promise<number> {
  const idx = await nextStepIdx(admin, runId);
  await admin.from("agent_run_steps").insert({ run_id: runId, idx, type, title: title.slice(0, 300), detail: detail ? String(detail).slice(0, 8000) : null });
  await admin.from("agent_runs").update({ step_count: idx + 1 }).eq("id", runId);
  return idx;
}

/** The memory ids a recall answer says entered the context. */
function usedIdsOf(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const ids = (data as { usedIds?: unknown }).usedIds;
  return Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Records a run's memory uses as steps on the run — the injection's
 * bodies and a recall's — including any auto-promotion a third use
 * completes (memoryDb). Best-effort: the bookkeeping never breaks the
 * turn it rides on. The step writer is the driver's own, so a chat
 * turn's steps keep their chained order.
 */
async function noteMemoryUse(
  admin: SupabaseClient, runId: string, ids: string[],
  step: (type: string, title: string) => Promise<unknown> = (type, title) => addStep(admin, runId, type, title),
): Promise<void> {
  if (!ids.length) return;
  try {
    const { recorded, promoted } = await recordMemoryUses(admin, runId, ids);
    if (recorded) await step("memory", `記憶を参照しました（${recorded} 件）`);
    if (promoted.length) await step("memory", `よく使う記憶を durable に昇格しました: ${promoted.join("、")}`);
  } catch (e) {
    console.error("run-agent: memory use recording failed", e instanceof Error ? e.message : e);
  }
}

/** Starts a promotion drafting run a conversation just created. The
 *  start_promotion tool makes the records (it runs on the catalog's
 *  context, which holds no JWT); starting is the driver's act, with the
 *  starter's own JWT, like every run start. Fire-and-forget: a run
 *  left queued can be started from the draft's screen. */
function startPromotionRunFromTool(a: ExecArgs, data: unknown): void {
  const runId = (data as { promotionRunId?: unknown } | null)?.promotionRunId;
  if (typeof runId !== "string" || !runId) return;
  void fetch(`${a.supabaseUrl}/functions/v1/run-agent`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${a.jwt}` },
    body: JSON.stringify({ runId }),
  }).catch(() => {});
}

/** Rewrites one step in place — a chat draft step becoming the reply it
 *  grew into (draft.ts). The step keeps its place in the trace. */
async function updateStep(admin: SupabaseClient, runId: string, idx: number, title: string, detail?: string | null, type?: string): Promise<void> {
  await admin.from("agent_run_steps").update({
    title: title.slice(0, 300), detail: detail ? String(detail).slice(0, 8000) : null,
    ...(type ? { type } : {}),
  }).eq("run_id", runId).eq("idx", idx);
}

/** Takes one step back — a draft whose call said nothing worth keeping. */
async function deleteStep(admin: SupabaseClient, runId: string, idx: number): Promise<void> {
  await admin.from("agent_run_steps").delete().eq("run_id", runId).eq("idx", idx);
}

interface ExecArgs {
  req: Request; run: Run; user: { id: string; email: string | null }; jwt: string;
  admin: SupabaseClient; userDb: SupabaseClient; anthropicKey: string | null; supabaseUrl: string;
  /** The run's approval mode (its snapshot; serve() resolved it). The
   *  drivers compose it over every verdict — policy read server-side,
   *  never a model's choice, and no tool exists that could change it. */
  approvalMode: ApprovalMode;
  body: {
    continue?: boolean; resume?: boolean; token?: string; message?: string;
    decision?: { actionId?: string; approve?: boolean; inputHash?: string; note?: string; remember?: string[] };
    /** A chat message's view context and files (the panel's send). */
    context?: CopilotContextLike; attachments?: Attachment[];
  };
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
  let weight: unknown = null;
  {
    const { data: el } = await admin.from("elements").select("object_id, ai_weight").eq("id", run.element_id).maybeSingle();
    weight = el?.ai_weight ?? null;
    if (el?.object_id) {
      const { data: obj } = await admin.from("objects").select("domain_id").eq("id", el.object_id).maybeSingle();
      if (obj?.domain_id) {
        const { data: d } = await admin.from("domains").select("name, ai_config").eq("id", obj.domain_id).maybeSingle();
        domain = (d as DomainConfigRow | null) ?? null;
      }
    }
  }
  const config = resolveAgentConfig(worker, domain, weight, run.transcript?.messages?.length ? run.model : null);
  const { agentName, model, instructions, domainInstructions } = config;
  // The definition the work follows: the Element's own, else its Strategy's.
  // A disabled harness in the way is skipped, and the run says so.
  const loadedDefinition = await loadDefinition(userDb, run.element_id);
  // A rehearsal run tries the definition its transcript carries — not a
  // row, so nothing is born before activation — in place of whatever
  // the Element itself names.
  const definition = run.rehearsal && run.transcript?.rehearsalDefinition
    ? { name: run.transcript.rehearsalDefinition.name, body: run.transcript.rehearsalDefinition.body, scope: "element" as const }
    : loadedDefinition.definition;
  if (loadedDefinition.skippedDisabled.length) {
    await addStep(admin, run.id, "status", `無効化されているハーネス「${loadedDefinition.skippedDisabled.join("」「")}」は使わずに進めます`);
  }
  // A Strategy's definition is direction for all its Elements; the output
  // shape and the loop are enforced only for an Element's own definition.
  const parsedAll: ParsedDefinition | null = definition ? parseDefinition(definition.body) : null;
  const parsed: ParsedDefinition | null = parsedAll && definition?.scope === "element" ? parsedAll : null;
  // A loop runs for many rounds: it may take more turns, and spend up to the
  // budget its definition names (never past a hard ceiling). A rehearsal
  // run's cap is the rehearsal's own ($1): the definition's ceiling is
  // what the real runs will live under, not what a trial may spend.
  const maxTotalTurns = parsed?.metric ? Math.max(config.maxTotalTurns, 400) : config.maxTotalTurns;
  const runCap = run.rehearsal
    ? REHEARSAL_COST_CAP_USD
    : parsed?.stop.budgetUsd ? Math.min(Math.max(parsed.stop.budgetUsd, MAX_RUN_COST_USD), MAX_DEFINED_RUN_COST_USD) : MAX_RUN_COST_USD;
  const refuse = async (reason: string) => {
    await admin.from("element_comments").insert({
      element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
      content: `**実行できません** — ${reason}`,
    });
    await failRun(admin, run, reason);
  };
  if (config.disabledReason) { await refuse(config.disabledReason); return; }
  // The harness is checked before it runs: an error means the engine cannot
  // run it as written (no goal; a loop with no stop the engine can judge).
  // Only the context-free errors gate here — the "connector not connected"
  // check (H005) is a warning, and which connectors are live is settled
  // further down, where the connections load.
  if (parsedAll) {
    const errors = checkHarness(parsedAll).filter((d) => d.severity === "error");
    if (errors.length) {
      await refuse(`定義「${definition?.name ?? ""}」をこのまま実行できません。${errors.map((d) => d.message).join(" ")}`);
      return;
    }
  }

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
    if (!provider.enabled) { await refuse(`接続先「${provider.name}」は無効になっています。設定 › カスタマイズで有効にすると実行できます。`); return; }
    if (!isSafeEndpoint(provider.endpoint)) { await refuse(`接続先「${provider.name}」のアドレスは使えません（https の公開ホストだけが使えます）。`); return; }
    const { data: key } = await admin.rpc("get_integration_secret", { p_integration_id: provider.id });
    if (!key) { await refuse(`接続先「${provider.name}」の API キーが設定されていません。設定 › カスタマイズで入力すると実行できます。`); return; }
    // Providers differ in which header carries the key; both carry it.
    modelClient = new Anthropic({ apiKey: key as string, authToken: key as string, baseURL: provider.endpoint.replace(/\/+$/, "") });
  } else {
    if (!a.anthropicKey) { await refuse("ANTHROPIC_API_KEY が設定されていません。"); return; }
    modelClient = new Anthropic({ apiKey: a.anthropicKey });
  }
  await admin.from("agent_runs").update({ model, worker_id: workerId }).eq("id", run.id);
  const actor: BoardActor = { agent: `${agentName}（AI）`, userId: user.id };
  // The Strategy the Element serves: its Tables are where the run keeps what it found.
  const served = await strategyOfElement(userDb, run.element_id);
  const recordScope: RecordScope | null = served
    ? { strategyId: served.strategyId, domainId: served.domainId, elementId: run.element_id, runId: run.id, userId: user.id, agentName }
    : null;

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
      .select("id, preset, kind, name, description, endpoint, auth_type, auth_header, delegation, enabled, manifest, guide, updated_at")
      .eq("activity_space_id", run.activity_space_id).eq("enabled", true).in("kind", ["mcp", "http"]).order("created_at");
    // The integrations' cached tool plans, read once for the whole Space:
    // this slice plans fresh only what the cache cannot vouch for, and a
    // connection's secret and session bind when a call runs, not here.
    const cachedPlans = await loadToolPlans(admin, (rows ?? []).map((r) => (r as { id: string }).id));
    // The connectors the definition names (「# 使うコネクタ」): when it names
    // any, only those are offered — a connection is matched the way the
    // editor matches it, by the name the Space gave it, its preset's id, or
    // its preset's name. A named one with no enabled connection is reported
    // after the loop; the rows above are already enabled-only.
    const wantedConnectors = parsedAll?.connectors ?? [];
    const matchedConnectors = new Set<string>();
    for (const row of (rows ?? []) as (IntegrationRow & { enabled: boolean; manifest: unknown; guide: string | null; updated_at?: string | null })[]) {
      if (wantedConnectors.length) {
        const names = [row.name, row.preset ?? "", PRESET_NAMES[row.preset ?? ""] ?? ""].filter(Boolean);
        const hits = wantedConnectors.filter((c) => names.some((n) => foldName(n) === foldName(c)));
        if (!hits.length) continue;
        for (const h of hits) matchedConnectors.add(h);
      }
      if (!isSafeEndpoint(row.endpoint)) continue;
      // A manifest declares what the integration may be asked to do. One that
      // declares nothing usable closes the integration rather than opening it.
      let manifest: Manifest | null = null;
      if (row.manifest != null && !isGoogleDriveRow(row)) {
        const parsed = parseManifest(row.manifest);
        if (parsed.errors.length) await addStep(admin, run.id, "error", `連携「${row.name}」の manifest に読めない所があります`, parsed.errors.join("\n"));
        if (offeredCommands(parsed.manifest).length === 0) continue;
        manifest = parsed.manifest;
      }
      // An MCP connection that was never tested has no manifest: nothing
      // declares what it may be asked to do, so it stays closed — like a
      // manifest that declares nothing — until a person runs the test.
      if (row.kind === "mcp" && row.manifest == null && !isGoogleDriveRow(row)) {
        await addStep(admin, run.id, "error", `連携「${row.name}」は接続テストが済んでいないため使いません`, "Settings › Customize で接続テストを実行すると、使える操作が宣言されます。");
        integrationSummary.push(downIntegration(row.name, "接続テストが済んでいない（Settings › Customize で接続テストが必要）"));
        continue;
      }
      // Never Alcon itself: the board tools already act as the starter, and a
      // stored token would act outside this run.
      if (pointsAtAlcon(row.endpoint, Deno.env.get("SUPABASE_URL"))) {
        await addStep(admin, run.id, "error", `連携「${row.name}」は Alcon 自身を指しているため使いません`, "Alcon のデータの操作はエージェントの標準の道具で行います。");
        continue;
      }
      // OAuth is Google Drive's or GitHub's sign-in; any other OAuth row has no way to authenticate.
      if (row.auth_type === "oauth" && !isGoogleDriveRow(row) && !isGithubOAuthRow(row)) continue;
      const prefix = integrationPrefix(row.name, row.id);
      const fingerprint = await planFingerprint(row);
      const cached = cachedPlans.get(row.id);
      try {
        if (isGoogleDriveRow(row)) {
          // Drive's typed tools stay the run's own path, bound eagerly as
          // before: they are not manifest commands, and a Drive row whose
          // token cannot be resolved is reported here, not at call time.
          const { data: raw } = await admin.rpc("get_integration_secret", { p_integration_id: row.id });
          // An OAuth token set becomes a current access token here
          // (refreshed when due); other credentials pass through as stored.
          const secret = await resolveCredential(admin, row, (raw as string | null) ?? null);
          if (!secret) {
            await addStep(admin, run.id, "error", `連携「${row.name}」は Google への接続が必要です`, "Settings › Customize で Google にサインインし直すと使えます。");
            integrationSummary.push(downIntegration(row.name, "Google にサインインしていない（Settings › Customize でサインインが必要）"));
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
          // With a manifest, only the MCP tools it declares, under its
          // commands' names and permissions — planned by the shared code
          // the AI panel uses too (_shared/integrationTools.ts). A manifest
          // is always present here: an untested MCP connection stayed
          // closed above. The plan comes from the cache while the cache
          // can vouch for it; a slice that must refresh pays for the
          // listing once, stores the plan for every later slice, and
          // keeps the session it opened as those tools' binding. All
          // other tools bind lazily when a call runs, so a slice no
          // longer re-reads every secret and re-opens every session
          // just to offer the tools.
          const offerPlanned = (planned: PlannedIntegrationTool[], bind: IntegrationTool["bind"]) => {
            let offered = 0;
            for (const p of planned) {
              if (integrationDefs.length >= MAX_TOOLS) break;
              integrationTools.set(p.name, { integration: row, remote: p.remote, command: p.command, manifest: manifest!, bind });
              integrationDefs.push({ name: p.name, description: p.description, input_schema: p.input_schema });
              offered++;
            }
            integrationSummary.push({ name: row.name, kind: "MCP", delegation: row.delegation, tools: offered, declared: !!manifest, guide: row.guide });
          };
          if (cached && planCacheState(cached, fingerprint, row.kind, Date.now()) === "use") {
            offerPlanned(adoptPlannedTools(cached.plan, integrationTools), lazyBinding(admin, row));
          } else {
            let refreshed: { planned: PlannedIntegrationTool[]; bound: Promise<IntegrationBinding> } | null = null;
            try {
              const { data: raw } = await admin.rpc("get_integration_secret", { p_integration_id: row.id });
              const secret = await resolveCredential(admin, row, (raw as string | null) ?? null);
              if (isGithubOAuthRow(row) && !secret) {
                await addStep(admin, run.id, "error", `連携「${row.name}」は GitHub への接続が必要です`, "Settings › Customize で GitHub にサインインし直すと使えます。");
                integrationSummary.push(downIntegration(row.name, "GitHub にサインインしていない（Settings › Customize でサインインが必要）"));
                continue;
              }
              const session = new McpSession(row, secret);
              await session.initialize();
              const tools = await session.listTools();
              refreshed = {
                planned: planManifestTools(row, manifest, tools, integrationTools),
                bound: Promise.resolve<IntegrationBinding>({ secret, session }),
              };
            } catch (refreshError) {
              if (!cached) throw refreshError;
              // The stored plan still names what this connection
              // declared; the run offers it, bound lazily, and the
              // failure stays on the record — a refused credential is
              // the connection's state, not this run's.
              const message = errorMessage(refreshError);
              await addStep(admin, run.id, "error", `連携「${row.name}」の道具一覧を更新できませんでした`, `前回取得した一覧で続けます: ${message}`);
              if (isAuthFailure(message)) {
                await admin.from("integrations").update({ last_test: { ok: false, at: new Date().toISOString(), code: "auth_failed", detail: message.slice(0, 300) } }).eq("id", row.id);
              }
            }
            if (refreshed) {
              await saveToolPlan(admin, row.id, fingerprint, refreshed.planned);
              const bound = refreshed.bound;
              offerPlanned(refreshed.planned, () => bound);
            } else if (cached) {
              offerPlanned(adoptPlannedTools(cached.plan, integrationTools), lazyBinding(admin, row));
            }
          }
        } else if (manifest) {
          // An API with a manifest: its declared commands, never a raw
          // request. The plan is pure, so the cache only saves the
          // planning; the secret binds when a call runs.
          const bind = lazyBinding(admin, row);
          let planned: PlannedIntegrationTool[];
          if (cached && planCacheState(cached, fingerprint, row.kind, Date.now()) === "use") {
            planned = adoptPlannedTools(cached.plan, integrationTools);
          } else {
            planned = planManifestTools(row, manifest, null, integrationTools);
            await saveToolPlan(admin, row.id, fingerprint, planned);
          }
          for (const p of planned) {
            if (integrationDefs.length >= MAX_TOOLS) break;
            integrationTools.set(p.name, { integration: row, remote: null, command: p.command, manifest, bind });
            integrationDefs.push({ name: p.name, description: p.description, input_schema: p.input_schema });
          }
          integrationSummary.push({ name: row.name, kind: "API", delegation: row.delegation, tools: planned.length, declared: true, guide: row.guide });
        } else {
          const name = `${prefix}${INTEGRATION_SEPARATOR}http_request`;
          integrationTools.set(name, { integration: row, remote: null, bind: lazyBinding(admin, row) });
          integrationDefs.push({
            name,
            description: `[${row.name}] ${row.description ?? ""} の API（base: ${row.endpoint}）に HTTP リクエストを送る。GET / HEAD は読み取り、それ以外は書き込み。`.slice(0, 1024),
            input_schema: HTTP_REQUEST_SCHEMA as unknown as Record<string, unknown>,
          });
          integrationSummary.push({ name: row.name, kind: "API", delegation: row.delegation, tools: 1 });
        }
      } catch (e) {
        const message = errorMessage(e);
        await addStep(admin, run.id, "error", `連携「${row.name}」に接続できませんでした`, message);
        // A refused credential is the connection's state, not this run's:
        // the connector shows it, so a person knows to sign in again.
        if (isAuthFailure(message)) {
          await admin.from("integrations").update({ last_test: { ok: false, at: new Date().toISOString(), code: "auth_failed", detail: message.slice(0, 300) } }).eq("id", row.id);
        }
        integrationSummary.push(downIntegration(row.name, isAuthFailure(message)
          ? (row.auth_type === "oauth" ? "認証が切れている（Settings › Customize でサインインし直す必要がある）" : "認証に失敗した（Settings › Customize で認証情報を直す必要がある）")
          : `接続できない: ${message.slice(0, 200)}`));
      }
    }
    // A connector the definition names but this Space has not enabled: the
    // run goes on without it, and both the person and the agent are told.
    const missingNamed: string[] = [];
    for (const name of wantedConnectors) {
      if (matchedConnectors.has(name)) continue;
      missingNamed.push(name);
      await addStep(admin, run.id, "error", `定義が使うコネクタ「${name}」につながっていません`, "「# 使うコネクタ」に書かれたコネクタが、この Space で有効になっていません。Settings › Customize で有効にするか、定義から外してください。");
      integrationSummary.push(downIntegration(name, "定義に書かれているが、この Space で有効な接続がない"));
    }
    // The step above lives inside this run's panel; the ask itself belongs
    // on the Element, where a person can act on it — once per run (its
    // first slice), however the run was started, a person pressing Start
    // or the engine advancing work on its own alike. The run still goes
    // on without the tools; this says plainly that it is doing so, and
    // what would give them back.
    if (missingNamed.length && !run.transcript) {
      await admin.from("element_comments").insert({
        element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
        content: `**接続待ち** — 定義が使うコネクタ「${missingNamed.join("」「")}」がこの Space で未接続のため、その道具なしで実行しています。接続すると次回から使えます（Settings › Customize、または Strategy の会話から接続できます）。`,
      }).then(() => {}, () => {});
    }
  }

  // The tool list is frozen at the first slice: later slices send the same
  // definitions (thinking blocks are bound to that prefix). A tool whose
  // integration went away since answers with an error instead.
  // The browser on the person's own computer, when they run one and it is on.
  const { data: runnerRows } = run.activity_space_id && run.triggered_by
    ? await admin.from("assets").select("id, name, manifest, last_seen_at")
      .eq("activity_space_id", run.activity_space_id).eq("status", "active").eq("claimed_by", run.triggered_by)
      .order("last_seen_at", { ascending: false }).limit(10)
    : { data: [] };
  const runner = pickRunner((runnerRows ?? []) as RunnerRow[], Date.now());
  if (runner) integrationSummary.push({ name: `この人の PC のブラウザ（${runner.name}）`, kind: "PC", delegation: "read_only", tools: RUNNER_TOOLS.length });
  // A disposable machine of theirs, when one is on: commands and files there.
  const machine = pickRunner((runnerRows ?? []) as RunnerRow[], Date.now(), "shell");
  if (machine) integrationSummary.push({ name: `使い捨ての仮想マシン（${machine.name}）`, kind: "VM", delegation: "full_delegation", tools: MACHINE_TOOLS.length });

  // A connection's tools load when the model searches for them, once there are many.
  const liveTools: RunToolDef[] = withDeferral(
    [...baseAgentTools(), ...(recordScope ? RECORD_TOOLS : []), ...(parsed?.metric ? [ROUND_TOOL] : []), ...(runner ? RUNNER_TOOLS : []), ...(machine ? MACHINE_TOOLS : [])],
    integrationDefs,
  );
  const tools: RunToolDef[] = run.transcript?.tools?.length ? run.transcript.tools : liveTools;
  const kindOf = (name: string): ToolKind => {
    const base = baseKindOf(name);
    // A catalog tool whose calls may wait for approval (a Strategy write) goes
    // through the approval path; needsApproval decides each call.
    if (base === "board" && mayNeedApproval("element", name)) return "write";
    if (base) return base;
    // The runner only reads unless its owner started it to write; a
    // disposable machine changes nothing outside itself.
    if (isRunnerTool(name) || isMachineTool(name)) return "read";
    return "write"; // decided per call below
  };
  /** What the approval card is told about one call — the shared builder in
   *  _shared/integrationTools.ts, so the run's card and the panel's agree. */
  const approvalDisplayFor = (c: ToolCall): ApprovalDisplay => approvalDisplayForCall(integrationTools, c);

  // ── The approval mode, composed over the policy's verdicts ───────────
  // The verdict and the mode composition live in _shared/approvalPolicy.ts;
  // what is gathered here, once per call and shared by the loop's gate and
  // its executor, is the facts this run has for the call. A deny the gate
  // answered is refused by the executor wrapper below; an ask the free
  // mode lifted is recorded there as a policy approval as it runs.
  const mode = a.approvalMode;
  const verdicts = new Map<string, { base: ApprovalVerdict; final: ApprovalVerdict }>();
  const factsForCall = (call: ToolCall): ApprovalFacts => {
    // Alcon's own operations: the Element entry's policy decides each call.
    if (isCatalogTool(call.name)) {
      const tool = catalogTool(call.name);
      return { catalogDecision: tool ? decideCall("element", tool, call.input) : "allow", isWrite: true, isRead: false };
    }
    // The facts are gathered by the shared adapter (_shared/integrationTools.ts).
    return integrationApprovalFacts(integrationTools.get(call.name), call, kindOf(call.name) === "write");
  };
  const verdictForCall = (call: ToolCall): { base: ApprovalVerdict; final: ApprovalVerdict } => {
    let v = verdicts.get(call.id);
    if (!v) {
      const facts = factsForCall(call);
      const base = approvalVerdict(facts);
      v = { base, final: applyMode(base, facts, mode) };
      verdicts.set(call.id, v);
    }
    return v;
  };

  // ── Disclosure: a lifted write announces itself ──────────────────────
  // A call full delegation let run unasked (liftOf) leaves no approval
  // row — by design, every write on such a connection is lifted, and
  // per-call rows would flood the audit with the connection's normal
  // operation. What it leaves instead is one trace step per turn-batch,
  // written when the batch lands, so the run's surface and the audit
  // answer "what ran without asking, and why was that allowed". The
  // free mode's lifts are a different record (its policy approvals,
  // below); a call whose own verdict never asked is never one of those.
  const liftedDisplays: ApprovalDisplay[] = [];
  const flushLifted = async () => {
    if (!liftedDisplays.length) return;
    const batch = liftedDisplays.splice(0, liftedDisplays.length);
    const names = [...new Set(batch.map((d) => d.integration))];
    await addStep(admin, run.id, "approval", `確認なしで実行（全委任）: ${approvalSummary(batch)}`,
      `${names.map((n) => `連携「${n}」`).join("、")}は全委任のため、承認を求めずに実行しました。`);
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
    // The call itself is the shared executor (deny rules re-checked at the
    // moment it runs, declared commands mapped to their requests); linking
    // the GitHub pulls it opened to this run's Element stays the run's own
    // post-step.
    const r = await executeIntegrationTool(it, call);
    if (!r.isError && isGithubRow(it.integration) && it.remote && /^(create|update)_pull_request$/i.test(it.remote.name)) {
      // The token the call ran with: bindingOf returns the binding the
      // executor just resolved (memoized on the tool for this slice).
      const binding = await bindingOf(it).catch(() => null);
      await linkOpenedPulls(r.text, binding?.secret ?? null);
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

  // A call to the person's PC: queued for its runner, answered within a
  // minute or given up (the runner may have gone offline since).
  const callRunner = async (call: ToolCall, target: RunnerRow | null, read: (result: unknown) => string): Promise<{ content: string; is_error?: boolean }> => {
    if (!target) return { content: "この道具の実行役は今つながっていません。ほかの道具で進めるか、つながっていないことを報告してください。", is_error: true };
    await addStep(admin, run.id, "action", runnerStep(call.name, call.input));
    const { data: queued, error } = await admin.from("asset_calls")
      .insert({ asset_id: target.id, run_id: run.id, tool: runnerOperation(call.name), input: call.input }).select("id").single();
    if (error || !queued) return { content: `PC に依頼できませんでした: ${error?.message ?? "unknown"}`, is_error: true };
    // A page takes seconds; the slice's soft deadline may be near, but an
    // answer thrown away costs the runner's work, so wait it out (within the
    // platform's wall clock, which the slice deadline leaves room under).
    const until = Date.now() + 45_000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 700));
      const { data: c } = await admin.from("asset_calls").select("status, result, error").eq("id", queued.id).maybeSingle();
      if (c?.status === "done") return { content: read(c.result) };
      if (c?.status === "failed") return { content: `PC のブラウザで失敗しました: ${c.error ?? ""}`, is_error: true };
    }
    await admin.from("asset_calls").update({ status: "expired", finished_at: new Date().toISOString() }).eq("id", queued.id).in("status", ["pending", "claimed"]);
    return { content: "PC のブラウザから時間内に答えがありませんでした（PC が眠っているか、実行役が止まっている可能性）。", is_error: true };
  };

  const executeCall = async (call: ToolCall, approved = false): Promise<{ content: string; is_error?: boolean; finish?: FinishPayload }> => {
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
        const format = ["markdown", "html", "text", "csv", "json"].includes(String(input.format)) ? String(input.format) : "markdown";
        // The definition's output shape is checked before anything is saved.
        if (parsed?.output) {
          const problems = checkOutput(parsed.output, content, format);
          if (problems.length) {
            await addStep(admin, run.id, "thought", "成果物の型から外れているため差し戻し", problems.join("\n"));
            return { content: `成果物の型に合っていないため保存しませんでした。直してから保存し直してください。\n${problems.map((p) => `- ${p}`).join("\n")}`, is_error: true };
          }
        }
        const { data: existing } = await userDb.from("agent_artifacts").select("id").eq("element_id", run.element_id).eq("title", title).maybeSingle();
        const res = existing
          ? await userDb.from("agent_artifacts").update({ content, format, run_id: run.id, updated_at: new Date().toISOString() }).eq("id", existing.id).select("id").single()
          : await userDb.from("agent_artifacts").insert({ element_id: run.element_id, run_id: run.id, title, content, format, author_name: agentName }).select("id").single();
        if (res.error) return { content: res.error.message, is_error: true };
        // Also a file in the Space's Artifacts, on this Element. The output
        // above is saved either way; a file that could not be written says so.
        const file = await saveArtifactFile(userDb, run.element_id, title, content, format);
        const fileNote = "error" in file ? `（Artifacts への保存に失敗: ${file.error}）` : `、Artifacts に ${artifactFileName(title, format)}`;
        await addStep(admin, run.id, "artifact", `成果物を保存: ${title}`, `${content.length} 文字${fileNote}`);
        return { content: `成果物「${title}」を保存しました${"error" in file ? "" : `（Artifacts のファイル ${artifactFileName(title, format)}）`}。` };
      }
      case "record_round": {
        if (!parsed?.metric) return { content: "この Element の定義には指標がありません。", is_error: true };
        const { count } = await admin.from("run_iterations").select("id", { count: "exact", head: true }).eq("run_id", run.id);
        const n = (count ?? 0) + 1;
        const value = typeof input.value === "number" && Number.isFinite(input.value) ? input.value : null;
        await admin.from("run_iterations").insert({
          run_id: run.id, element_id: run.element_id, n, value,
          change: String(input.change ?? "").slice(0, 2000), kept: input.kept === true, note: input.note ? String(input.note).slice(0, 2000) : null,
        });
        await addStep(admin, run.id, "thought", `${n} 周目: ${parsed.metric.name} ${value ?? "—"}（${input.kept === true ? "残す" : "戻す"}）`, String(input.change ?? ""));
        const { data: rounds } = await admin.from("run_iterations").select("value").eq("run_id", run.id).order("n");
        const values = ((rounds ?? []) as { value: number | null }[]);
        const best = values.map((r) => r.value).filter((v): v is number => v != null);
        const bestText = best.length ? `最良 ${parsed.metric.direction === "max" ? Math.max(...best) : Math.min(...best)}` : "まだ値なし";
        const stop = loopStop(parsed, values, usage.cost);
        if (stop) {
          await addStep(admin, run.id, "status", `止める条件: ${stop}`);
          return { content: `${n} 周目を記録しました（${bestText}）。止める条件を満たしました: ${stop}\n定義の「止める条件」に最終確認があればそれを済ませ、最良の状態に戻っていることを確かめてから finish を呼んでください。` };
        }
        const checks = checksDue(parsed, n)
          ? `\n点検の周です。次の項目に照らして直近の作業を見直し、log_progress に結果を残してから続けてください:\n${parsed.checks.items.map((c) => `- ${c}`).join("\n")}`
          : "";
        return { content: `${n} 周目を記録しました（${bestText}）。続けてください。${checks}` };
      }
      case "finish": {
        const outcome = ["completed", "partial", "blocked"].includes(String(input.outcome)) ? String(input.outcome) as FinishPayload["outcome"] : "completed";
        const finish: FinishPayload = {
          outcome, summary: String(input.summary ?? "").trim().slice(0, 300) || "完了", message: String(input.message ?? "").trim(),
          // Copied through unvalidated: the gate validates the proposals at
          // finish time, when the bound measures and the verdict are known.
          ...(Array.isArray(input.readings) ? { readings: input.readings as { measureId: string; value: number }[] } : {}),
        };
        return { content: "完了報告を受け取りました。", finish };
      }
    }
    if (call.name === "save_records" || call.name === "read_records") {
      if (!recordScope) return { content: "この Element は Strategy に属していないので、表は使えません。", is_error: true };
      try {
        if (call.name === "read_records") {
          const text = await readRecords(userDb, admin, recordScope, input);
          await addStep(admin, run.id, "action", `表を読む: ${String(input.table ?? "")}`);
          return { content: text };
        }
        const r = await saveRecords(userDb, admin, recordScope, input);
        const line = `表「${r.table}」${r.created ? "（新規）" : ""}: 追加 ${r.added}・更新 ${r.updated}・変化なし ${r.unchanged}`;
        await addStep(admin, run.id, "artifact", `表に保存: ${r.table}`, [line, ...r.skipped, r.notified ? `見直しを依頼した Element: ${r.notified} 件` : ""].filter(Boolean).join("\n"));
        return { content: `${line}${r.skipped.length ? `\n保存しなかったもの:\n${r.skipped.map((s) => `- ${s}`).join("\n")}` : ""}${r.notified ? `\nこの表を使って完了していた Element ${r.notified} 件を見直しに戻しました。` : ""}` };
      } catch (e) {
        return { content: errorMessage(e), is_error: true };
      }
    }
    if (isRunnerTool(call.name)) return await callRunner(call, runner, runnerResultText);
    if (isMachineTool(call.name)) return await callRunner(call, machine, machineResultText);
    if (baseKindOf(call.name) === "board") {
      const r = await runCatalogTool(userDb, call.name, input, actor, { entry: "element", approved });
      await addStep(admin, run.id, "action", `Alcon: ${catalogOperation(call.name, input)}`, r.ok ? null : r.error);
      // A failed Element resolution is recorded with its evidence — the
      // raw identifier, the stage it died at, the session's user (audit
      // only; the surface keeps the translated line). A write-back that
      // fails as "Element not found" was undiagnosable while the
      // argument existed nowhere; the traced re-check is read-only and
      // runs only on that failure.
      if (!r.ok && r.error === "Element not found") {
        const idArg = String(input.elementId ?? input.id ?? "");
        const traced = await resolveElementIdTraced(userDb, idArg).catch(() => null);
        await addStep(admin, run.id, "error", "Element を特定できませんでした",
          JSON.stringify({ idArg, stage: traced?.stage ?? "unknown", userId: user.id }));
      }
      // A recall's bodies count as uses of those memories (PR3).
      if (call.name === "recall_memory" && r.ok) await noteMemoryUse(admin, run.id, usedIdsOf(r.data));
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

  // ── The rehearsal gate ──────────────────────────────────────────────
  // A rehearsal run's choke point: the loop's executor wrapper sends
  // every call here first. Reads run live and are recorded; writes are
  // assembly-validated and recorded as plans, never executed; the run's
  // own bookkeeping tools (plan, progress, rounds, finish, artifact)
  // keep working — the artifact is the trial's own output, saved on the
  // trial's Element, and it is also how the definition's output shape
  // gets tried. A plan that could not be assembled is evidence, not a
  // stop: the model is told, and walks the procedure to its end so the
  // report covers it.
  const rehearsalGate = async (call: ToolCall): Promise<{ content: string; is_error?: boolean; finish?: FinishPayload }> => {
    const plan = async (tool: string, valid: boolean, problem: string | null) => {
      rehearsalReport.writes.push({ tool, valid, problem });
      await addStep(admin, run.id, "plan", `試走: 書き込みの計画 — ${tool}`,
        problem ? `組み立てに問題があります: ${problem}（実行はしません）` : "実行はしません。計画として記録しました。");
      return {
        content: problem
          ? `試走のため、この書き込みは実行しません。なお組み立てに問題があります: ${problem}`
          : "試走のため、この書き込みは実行しません。計画として記録しました。手順を続けてください。",
      };
    };
    const live = async (tool: string) => {
      const r = await executeCall(call);
      rehearsalReport.reads.push({ tool, ok: !r.is_error, authFailure: !!r.is_error && isAuthFailure(r.content) });
      return r;
    };
    switch (call.name) {
      case "record_plan": case "log_progress": case "record_round": case "finish": case "save_artifact":
        return await executeCall(call);
      case "read_records":
        return await live(`表を読む: ${String(call.input.table ?? "")}`);
      case "save_records": {
        const problem = !recordScope
          ? "この Element は Strategy に属していないので、表は使えません"
          : typeof call.input.table !== "string" || !call.input.table
            || typeof call.input.key !== "string" || !call.input.key
            || !Array.isArray(call.input.records)
            ? "table / key / records の形が要ります"
            : null;
        return await plan(`表に保存: ${String(call.input.table ?? "")}`, !problem, problem);
      }
      case "complete_subelement": {
        const ok = subelementIds.has(String(call.input.subelement_id ?? ""));
        return await plan("サブ要素を完了", ok, ok ? null : "この Element のサブ要素ではありません");
      }
    }
    if (isRunnerTool(call.name)) return await live(call.name);
    if (isMachineTool(call.name)) return await plan(call.name, true, null);
    const it = integrationTools.get(call.name);
    if (it) {
      const label = `${it.integration.name}: ${operationOf(it, call.input)}`;
      if (integrationCallIsRead(it, call)) return await live(label);
      let problem: string | null = null;
      if (it.command) {
        const req = requestFor(it.command, call.input);
        if ("error" in req) problem = req.error;
      } else if (it.remote) {
        const def = tools.find((t) => t.name === call.name);
        const required = ((def?.input_schema as { required?: unknown } | undefined)?.required ?? []) as string[];
        const missing = required.filter((f) => call.input[f] === undefined || call.input[f] === null || call.input[f] === "");
        if (missing.length) problem = `${missing.join("、")} が必要です`;
      }
      return await plan(label, !problem, problem);
    }
    if (isCatalogTool(call.name)) {
      const tool = catalogTool(call.name)!;
      const label = `Alcon: ${catalogOperation(call.name, call.input)}`;
      if (effectOfCall(tool, call.input) === "read") return await live(label);
      const decision = decideCall("element", tool, call.input);
      return await plan(label, decision !== "deny", decision === "deny" ? catalogDenyRefusal(call.name, call.input) : null);
    }
    return await executeCall(call);
  };

  // The measures this run may report readings for: those of the Strategies
  // its Element serves — the same set the verifier judges the finish
  // against. Loaded once: the task context lists them for the agent, and
  // finishRun gates the finish's proposals by them.
  const boundMeasures = await loadBoundMeasures(userDb, run.element_id);

  // ── State ───────────────────────────────────────────────────────────────
  const deadline = Date.now() + SLICE_MS;
  // A model call gets what is left of the slice: one that hangs would eat
  // the platform's whole wall clock and be cut off mid-turn, leaving the
  // run 'running' with nothing left to resume it. Aborted at the deadline
  // instead, it surfaces as an error and the run pauses, resumable.
  const sliceSignal = () => AbortSignal.timeout(Math.max(deadline - Date.now(), 1));
  let state: LoopState;
  let turnBudget: number;
  let pending: SavedPending | undefined = run.transcript?.pending;
  if (run.transcript?.messages?.length) {
    state = { messages: run.transcript.messages, turns: run.transcript.turns ?? 0, nudges: run.transcript.nudges ?? 0, revisions: run.transcript.revisions ?? 0 };
    turnBudget = run.transcript.turnBudget ?? maxTotalTurns;
    // Resuming grants a fresh allowance on top of the turns already taken.
    if (a.body.resume) turnBudget = state.turns + maxTotalTurns;
  } else {
    const ctx = await loadContext(userDb, run, integrationSummary, recordScope ? await strategyTableLines(userDb, recordScope.strategyId) : null, boundMeasures);
    const task = taskMessage(ctx);
    // The injected bodies count as uses of those memories (PR3).
    if (ctx.memoryUsedIds?.length) await noteMemoryUse(admin, run.id, ctx.memoryUsedIds);
    const defText = definition && parsedAll
      ? definition.scope === "element"
        ? definitionPrompt(definition.name, definition.body, parsedAll)
        : `# Strategy の定義「${definition.name}」（この Strategy 全体の方針。依頼した人が定めたもので、従う。成果物の型とループはこの Element には課されない）\n${definition.body.slice(0, 40_000)}`
      : null;
    const opening = defText ? `${task}\n\n${defText}` : task;
    state = { messages: [{ role: "user", content: run.rehearsal ? `${opening}\n\n${REHEARSAL_TASK_NOTICE}` : opening }], turns: 0, nudges: 0 };
    turnBudget = maxTotalTurns;
    await addStep(admin, run.id, "status", run.mode === "reply" ? "依頼を受けて実行を開始" : "任務の実行を開始", `${agentName} / ${config.modelLabel}${config.routedBy ? `（重さ: ${WEIGHT_LABEL[config.routedBy]}）` : ""}`);
  }

  // A rehearsal run's report, accumulated across its slices: the reads
  // it executed and the writes it planned. It rides the transcript, so
  // whoever settles the rehearsal (the tick, the promote driver) reads
  // the same evidence the run gathered.
  const rehearsalReport: RehearsalReport = run.rehearsal
    ? readRehearsalReport(run.transcript?.rehearsal)
    : emptyRehearsalReport();

  const saveTranscript = async (p?: SavedPending) => {
    const transcript: Transcript = {
      messages: state.messages, turns: state.turns, nudges: state.nudges, revisions: state.revisions ?? 0, turnBudget, tools,
      ...(p ? { pending: p } : {}),
      ...(run.rehearsal ? {
        rehearsal: rehearsalReport,
        ...(run.transcript?.rehearsalDefinition ? { rehearsalDefinition: run.transcript.rehearsalDefinition } : {}),
      } : {}),
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
    }).then(async (res) => {
      // A refused hand-off (a 409, a gateway error) would leave the run
      // 'running' with an armed token nobody will ever use: pause it, the
      // way a failed request does, so its starter can resume it.
      if (!res.ok) { await res.body?.cancel(); throw new Error(`続きの呼び出しが HTTP ${res.status} を返しました`); }
    }).catch(async (e) => {
      await admin.from("agent_runs").update({ status: "paused", error: `続きを開始できませんでした: ${errorMessage(e)}`, continuation_token: null }).eq("id", run.id).eq("status", "running");
    });
  };

  // A run resumed while a proposal is still unanswered (a stale decision, a
  // slice cut off before it stopped) goes back to waiting for it — sending
  // the transcript on with an unanswered tool_use would fail every time.
  if (pending && !pending.approved && !a.body.decision) {
    await restorePendingApproval({
      admin, runId: run.id, elementId: run.element_id, pending,
      displays: displaysUnderMode(pending.calls.map((c) => approvalDisplayFor(c)), mode),
      sha256, addStep: (type, title, detail) => addStep(admin, run.id, type, title, detail),
    });
    return;
  }

  // A standing approval, written when a decision asks to remember it
  // (decision.ts; Athena's chat driver shares the same writer).
  const rememberApproval = makeRememberApproval({
    userDb, tools: integrationTools,
    addStep: (type, title, detail) => addStep(admin, run.id, type, title, detail),
  });

  // ── A decision answers the paused turn first (decision.ts) ─────────────
  const decisionOutcome = await applyDecision(state, pending, a.body.decision, {
    admin, runId: run.id, userId: user.id,
    addStep: (type, title, detail) => addStep(admin, run.id, type, title, detail),
    saveTranscript, executeApproved: (call) => executeCall(call, true),
    // Under the ask mode nothing is rememberable: every write asks again,
    // so a decision's "from now on" is not accepted, as the card never
    // offered it.
    rememberApproval: mode === "ask" ? undefined : rememberApproval, scheduleContinuation, deadline,
  });
  if (decisionOutcome.continued) return;
  pending = decisionOutcome.pending;

  // ── Model ───────────────────────────────────────────────────────────────
  // Another provider gets the plain Messages API: no betas, no cache marks.
  const cache = external ? {} : { cache_control: { type: "ephemeral" as const } };
  const index = external ? "" : catalogIndex(tools);
  const system = [{ type: "text" as const, text: [systemPrompt({ name: agentName, instructions, domainInstructions }), index].filter(Boolean).join("\n\n"), ...cache }];
  const toolParams = toolParamsFor(tools, cache, external);
  const serverTools = [...webTools(model), ...(needsToolSearch(tools) ? [TOOL_SEARCH] : [])];

  const recordUsage = async (u: ModelUsage) => {
    usage = {
      input: usage.input + (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      output: usage.output + (u.output_tokens ?? 0),
      cost: Math.round((usage.cost + costAt(config.price, u)) * 1_000_000) / 1_000_000,
    };
    await admin.from("agent_runs").update({ input_tokens: usage.input, output_tokens: usage.output, cost_usd: usage.cost }).eq("id", run.id);
  };

  // The verdict record's raw material (runVerdict.ts): the last check the
  // verifier made, kept so the terminal finishRun can seal it onto the run.
  // Each attempt resets it — the record describes the finish that stood, so
  // a check of a finish that was sent back must not leak into it. When
  // revisions run out no new attempt happens, and the holder keeps the last
  // check (a fail), which is what the record then says.
  let lastCheck: VerdictInputs["lastCheck"] = null;
  let checkAttempted = false;

  // The verifier reads the task, the Strategy's success conditions and this
  // run's outputs fresh, in its own context, on the run's model at low effort.
  // Any failure to answer lets the finish stand rather than trap the run.
  const verifyFinish = async (finish: FinishPayload) => {
    lastCheck = null;
    checkAttempted = true;
    try {
      const [{ data: el }, { data: arts }] = await Promise.all([
        userDb.from("elements").select("title, description, object_id").eq("id", run.element_id).maybeSingle(),
        admin.from("agent_artifacts").select("id, title, content").eq("run_id", run.id),
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
        messages: [{ role: "user", content: verifyPrompt({ element: el, intents, finish, artifacts: (arts ?? []) as { title: string; content: string }[], usedWeb, definition: definition?.body ?? null }) }],
        output_config: { effort: "low", format: { type: "json_schema", schema: VERDICT_SCHEMA } },
      // deno-lint-ignore no-explicit-any
      } as any, { signal: sliceSignal() });
      await recordUsage(res.usage ?? {});
      const text = (res.content ?? []).find((b: { type: string }) => b.type === "text")?.text ?? "";
      const verdict = readVerdict(text);
      if (verdict) {
        const stepIdx = await addStep(admin, run.id, "thought", verdict.pass ? "検証: 合格" : `検証: 不足 ${verdict.gaps.length} 点`, verdict.gaps.join("\n") || null);
        lastCheck = {
          pass: verdict.pass, gaps: verdict.gaps, model, checkedAt: new Date().toISOString(), verifyStepIdx: stepIdx,
          artifactIds: ((arts ?? []) as { id: string }[]).map((art) => art.id),
        };
      }
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
        }, { signal: sliceSignal() });
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
        tools: [...serverTools, ...toolParams] as any,
        // deno-lint-ignore no-explicit-any
        messages: messages as any,
        // Medium thinking: these are working steps, not hard reasoning, and
        // the default (high on Sonnet) made every turn slow.
        output_config: { effort: "medium" },
        betas: ["context-management-2025-06-27"],
        // Old board results may be cleared to save room, never the web's:
        // with them cleared the agent searched and fetched the same pages
        // again until it ran out of uses. Nor a tool search's: it is what
        // loaded the tools the run goes on calling.
        context_management: { edits: [{
          type: "clear_tool_uses_20250919",
          trigger: { type: "input_tokens", value: 150_000 },
          keep: { type: "tool_uses", value: 6 },
          exclude_tools: ["web_search", "web_fetch", TOOL_SEARCH.name],
        }] },
      // deno-lint-ignore no-explicit-any
      } as any, { signal: sliceSignal() });
      for (const line of webSteps(res.content ?? [])) await addStep(admin, run.id, "action", line);
      return { content: res.content, stop_reason: res.stop_reason, usage: res.usage };
    },
    kindOf,
    // A rehearsal never asks: its writes are blocked, not approved, so
    // nothing waits for a person mid-trial.
    needsApproval: (call) => run.rehearsal ? false : verdictForCall(call).final === "ask",
    execute: async (call) => {
      // The rehearsal gate stands in front of every executor: a call in
      // a rehearsal run can only ever read, plan, or keep the run's own
      // books — the approval composition below is never reached.
      if (run.rehearsal) return await rehearsalGate(call);
      const v = verdicts.get(call.id);
      // A deny verdict is refused here, by the policy itself: the call is
      // never dispatched, so no executor path can grow around the
      // refusal. (Each executor still rechecks at the moment it runs —
      // an approval given before a rule denied these arguments must not
      // carry them through the decision path, which never passes here.)
      if (v?.final === "deny") {
        if (isCatalogTool(call.name)) {
          const refusal = catalogDenyRefusal(call.name, call.input);
          await addStep(admin, run.id, "action", `Alcon: ${catalogOperation(call.name, call.input)}`, refusal);
          return { content: refusal, is_error: true };
        }
        const deniedTool = integrationTools.get(call.name);
        if (deniedTool?.command) {
          const refusal = manifestDenyRefusal(deniedTool.command.name);
          await addStep(admin, run.id, "action", `${deniedTool.integration.name}: ${operationOf(deniedTool, call.input)}`, refusal.slice(0, 500));
          return { content: refusal, is_error: true };
        }
      }
      // The free mode lifted this call's ask: it runs as a policy
      // approval — recorded before it runs, settled when it lands, and
      // announced when the call is critical, so what ran unasked is as
      // visible as what a person approved.
      let policyActionId: string | null = null;
      if (v && v.base === "ask" && mode === "free") {
        const display = approvalDisplayFor(call);
        const summary = approvalSummary([display]);
        policyActionId = await recordPolicyApproval(admin, {
          runId: run.id, elementId: run.element_id, call, display, mode,
          integrationId: integrationTools.get(call.name)?.integration.id ?? null,
        });
        await addStep(admin, run.id, "approval", `ポリシー承認で実行: ${summary}`, "Space の承認モード（自由行動）により、承認を求めずに実行しました。");
        if (display.critical) {
          await admin.from("element_comments").insert({
            element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
            content: `**ポリシー承認で実行** — ${summary}。重要な操作のため記録しています。Space の承認モード（自由行動）により、承認は求めませんでした。`,
          });
          if (run.triggered_by) {
            await admin.from("notifications").insert({
              recipient_id: run.triggered_by, actor_name: agentName, kind: "status_change", element_id: run.element_id,
              agent_action_id: policyActionId, title: "重要な操作をポリシー承認で実行しました", body: summary,
            }).then(() => {}, () => {});
          }
        }
      }
      // A write full delegation lifted runs unasked: it is collected
      // here and announced once, when the turn's batch lands
      // (flushLifted, at the turn's end). Mutually exclusive with the
      // policy approval above — that one is a call whose verdict asked
      // and the mode lifted; this one's verdict never asked.
      if (!policyActionId && v?.final === "allow" && liftOf(factsForCall(call)) === "delegation") {
        liftedDisplays.push(approvalDisplayFor(call));
      }
      const r = await executeCall(call);
      if (policyActionId) await settlePolicyApproval(admin, policyActionId, !r.is_error);
      return r;
    },
    onUsage: recordUsage,
    verify: run.mode === "reply" || external ? undefined : verifyFinish,
    afterTurn: async () => { await flushLifted(); await saveTranscript(); },
    budgetExceeded: () => spentBefore + usage.cost >= budget || usage.cost >= runCap,
    cancelled: async () => {
      const { data } = await admin.from("agent_runs").select("status").eq("id", run.id).maybeSingle();
      return data?.status === "cancelled";
    },
  }, { maxTurnsThisCall: MAX_TURNS_PER_SLICE, maxTotalTurns: turnBudget, deadline });

  // ── Outcome ─────────────────────────────────────────────────────────────
  switch (outcome.kind) {
    case "finished": {
      await flushLifted();
      await saveTranscript();
      // A reply run's finish is a reply, not checked work: its verdict stays
      // null. Any other run's record is built from the verifier's holder —
      // a checked pass/fail, or an honest "unchecked" with its reason.
      const verdict = run.mode === "reply" ? null : buildRunVerdict({
        lastCheck, checkAttempted, revisions: state.revisions ?? 0, finish: outcome.finish, external,
      });
      const sealed = await finishRun(a, run, agentName, outcome.finish, undefined, verdict, boundMeasures);
      // Memory: a sealed finish is distilled into episodes — the curated
      // layer above this run's sealed record. Best-effort by construction
      // (capture never throws); a run stopped meanwhile (not sealed)
      // teaches nothing, and an external-provider run is skipped (the
      // distillation calls are Anthropic-shaped). A rehearsal run is
      // skipped too: a trial's finish is evidence about a definition,
      // not work the person did, and its report is the record it leaves.
      if (sealed && !run.rehearsal) {
        const { data: el } = await userDb.from("elements").select("title, description").eq("id", run.element_id).maybeSingle();
        await captureMemories({
          admin, userId: user.id,
          scope: captureScopeOf(run.activity_space_id), spaceId: run.activity_space_id,
          material: {
            finishSummary: outcome.finish.summary, finishMessage: outcome.finish.message,
            stepTitles: await loadStepTitles(admin, run.id),
            verdictGaps: verdict?.gaps ?? [],
            integrationNames: integrationSummary.filter((i) => !i.down).map((i) => i.name),
            subjectTitle: el?.title ?? null, subjectDescription: el?.description ?? null,
          },
          call: external ? null : { client: modelClient, model, recordUsage },
          budgetOk: spentBefore + usage.cost < budget && usage.cost < runCap,
          sourceRunId: run.id, sourceSessionId: null,
          links: { elementId: run.element_id, domainId: run.domain_id, strategyId: recordScope?.strategyId ?? null },
          noteKept: async (titles) => { await addStep(admin, run.id, "memory", `記憶に残しました: ${titles.join("、")}`); },
        });
      }
      return;
    }

    case "approval": {
      await flushLifted();
      await saveTranscript(outcome.pending);
      const calls = outcome.pending.calls;
      const display = displaysUnderMode(calls.map((c) => approvalDisplayFor(c)), mode);
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
      const why = usage.cost >= runCap
        ? `1 回の実行の上限（$${runCap}）に達したため一時停止しました。`
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

/**
 * A conversation on a Strategy (conversation.ts): the person's message is
 * added to the run's transcript and the same loop answers it, with the
 * Strategy's tools. A plain answer is the agent's reply: the run waits for
 * the person's next message ('awaiting_input'). Budget, slices and
 * cancellation work as for an Element's run; nothing here needs approval,
 * since the conversation writes only the Strategy's own record.
 */
async function converse(a: ExecArgs, said: string): Promise<void> {
  stepBase.delete(a.run.id);
  stepNext.delete(a.run.id);
  const { run, admin, userDb, user } = a;
  const strategyId = run.strategy_id!;

  const config = resolveAgentConfig(null, null, null, run.transcript?.messages?.length ? run.model : null);
  const { agentName, model } = config;
  if (!a.anthropicKey) { await failRun(admin, run, "ANTHROPIC_API_KEY が設定されていません。"); return; }
  const modelClient = new Anthropic({ apiKey: a.anthropicKey });
  await admin.from("agent_runs").update({ model }).eq("id", run.id);
  const actor: BoardActor = { agent: `${agentName}（AI）`, userId: user.id };

  // ── Budget (as for an Element's run; budget.ts holds the one formula) ──
  const { budget, spentBefore } = await loadRunBudget(admin, run, user.id);
  let usage = { input: run.input_tokens, output: run.output_tokens, cost: Number(run.cost_usd || 0) };

  // ── State: the conversation so far, and the person's new message ────────
  const tools: RunToolDef[] = run.transcript?.tools?.length ? run.transcript.tools : conversationTools();
  let state: LoopState;
  if (run.transcript?.messages?.length) {
    state = { messages: run.transcript.messages, turns: run.transcript.turns ?? 0, nudges: 0, revisions: 0 };
    if (said) state.messages.push({ role: "user", content: said });
  } else {
    const ctx = await loadConversationContext(userDb, run, strategyId, user.id);
    // Memory (PR3): what past work taught, relevant to this Strategy
    // and what was just said — the opening carries it, and the bodies
    // count as uses. Funnelled through loadMemoryContext, as at every
    // entry, so retrieval switches off in one place.
    const mem = await loadMemoryContext(userDb, {
      query: [ctx.strategy.name, said].join(" "),
      spaceId: run.activity_space_id, elementId: null,
    }, admin).catch(() => null);
    if (mem) {
      ctx.memories = mem.text;
      await noteMemoryUse(admin, run.id, mem.usedIds);
    }
    state = { messages: [{ role: "user", content: conversationOpening(ctx, said) }], turns: 0, nudges: 0 };
    await addStep(admin, run.id, "status", "会話を開始", `${agentName} / ${config.modelLabel}`);
  }
  // Each message gets its own allowance of turns.
  const turnBudget = state.turns + config.maxTotalTurns;
  if (said) await addStep(admin, run.id, "message", said.split("\n")[0].slice(0, 200), said);

  const saveTranscript = async () => {
    const transcript: Transcript = { messages: state.messages, turns: state.turns, nudges: 0, revisions: 0, turnBudget, tools };
    const clean = JSON.parse(JSON.stringify(transcript).replace(/\\u0000/g, ""));
    const { error } = await admin.from("agent_runs").update({ transcript: clean }).eq("id", run.id);
    if (error) throw new Error(`経過を保存できませんでした: ${error.message}`);
  };
  await saveTranscript();

  // This turn's substantive tool work — the landing capture's
  // threshold (memoryCapture.landingWorthDistilling) counts it.
  let toolCallsThisTurn = 0;
  const executeCall = async (call: ToolCall): Promise<{ content: string; is_error?: boolean }> => {
    if (call.name === PLANNER_TOOL.name) {
      const guidance = String(call.input.guidance ?? "").trim().slice(0, 4000);
      await addStep(admin, run.id, "plan_request", "計画を Planner に渡す準備をしました", guidance || null);
      return { content: "会話に「計画を作る」カードを出しました。人が押すと Execution タブで Planner が下書きを作ります。下書きは人が確かめて採用します。ここで計画の中身を作らないでください。" };
    }
    // The two proposals follow the hand-over's pattern: the step carries
    // the proposal (titles snapshotted, so the card reads even if the work
    // changes), a card is shown, the person presses, the web acts. The
    // conversation itself starts nothing and answers nothing.
    if (call.name === START_TOOL.name) {
      const ids = Array.isArray(call.input.elementIds)
        ? call.input.elementIds.filter((v): v is string => typeof v === "string")
        : [];
      const { data: els } = ids.length
        ? await userDb.from("elements").select("id, title").in("id", ids)
        : { data: [] as { id: string; title: string }[] };
      const titles = new Map(((els ?? []) as { id: string; title: string }[]).map((e) => [e.id, e.title]));
      const kept = ids.filter((id) => titles.has(id));
      if (!kept.length) return { content: "開始を提案できる Element が見つかりませんでした。getInitiativeExecution で id を確かめてください。", is_error: true };
      const detail = JSON.stringify({ elementIds: kept, titles: kept.map((id) => titles.get(id)) });
      await addStep(admin, run.id, "start_request", "実行の開始を提案しました", detail);
      return { content: "会話に「実行を開始する」カードを出しました。人が押すと Web が開始します。開始したとは言わないでください。" };
    }
    // The connection proposal follows the same pattern: the step carries
    // the ask (which connectors, and what work waits on them), a card is
    // shown, and connecting itself is the person's act in the dialog the
    // card opens. The judgement itself is shared with the Copilot panel
    // driver (_shared/connectProposal.ts): names that are already
    // connected — or whose latest test failed, a reauth — are resolved
    // there; the card re-reads the live state anyway, so a stale ask
    // cannot survive.
    if (call.name === CONNECT_TOOL.name) {
      const r = await resolveConnectionProposal(userDb, run.activity_space_id, call.input);
      if (r.kind === "invalid") return { content: r.error, is_error: true };
      if (r.kind === "already") return { content: `${r.asked.join("、")} はすでに接続されています。接続の提案は要りません。` };
      const detail = JSON.stringify({ names: r.names, waitingFor: r.waitingFor });
      await addStep(admin, run.id, "connection_request", "接続を提案しました", detail);
      return { content: CONNECTION_PROPOSED_REPLY };
    }
    if (call.name === ANSWER_TOOL.name) {
      const runId = String(call.input.runId ?? "");
      const elementId = String(call.input.elementId ?? "");
      const text = String(call.input.text ?? "").trim();
      if (!runId || !elementId || !text) return { content: "runId / elementId / text が要ります。", is_error: true };
      const [{ data: target }, { data: el }] = await Promise.all([
        userDb.from("agent_runs").select("id, summary").eq("id", runId).maybeSingle(),
        userDb.from("elements").select("id, title").eq("id", elementId).maybeSingle(),
      ]);
      if (!target || !el) return { content: "答えを待つ実行が見つかりませんでした。getInitiativeExecution で確かめてください。", is_error: true };
      const detail = JSON.stringify({ runId, elementId, elementTitle: el.title, text, question: target.summary ?? null });
      await addStep(admin, run.id, "answer_request", "実行への答えを提案しました", detail);
      return { content: "会話に「答えを送る」カードを出しました。人が押すと Web がその言葉を実行へ送ります。送ったとは言わないでください。" };
    }
    toolCallsThisTurn += 1;
    const r = await runCatalogTool(userDb, call.name, call.input, actor, { entry: "conversation" });
    const writes = (catalogTool(call.name)?.effect ?? "read") !== "read";
    // The page draws the conversation from these steps: what was done, about what, and whether it failed.
    await addStep(admin, run.id, !r.ok ? "error" : writes ? "write" : "action", `Alcon: ${call.name}`, r.ok ? conversationStepDetail(call.input) : r.error);
    // A recall's bodies count as uses of those memories (PR3).
    if (call.name === "recall_memory" && r.ok) await noteMemoryUse(admin, run.id, usedIdsOf(r.data));
    // A promotion the person just asked for starts drafting now (PR5).
    if (call.name === "start_promotion" && r.ok) startPromotionRunFromTool(a, r.data);
    return r.ok ? { content: JSON.stringify(r.data).slice(0, 20_000) } : { content: r.error, is_error: true };
  };

  const recordUsage = async (u: ModelUsage) => {
    usage = {
      input: usage.input + (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      output: usage.output + (u.output_tokens ?? 0),
      cost: Math.round((usage.cost + costAt(config.price, u)) * 1_000_000) / 1_000_000,
    };
    await admin.from("agent_runs").update({ input_tokens: usage.input, output_tokens: usage.output, cost_usd: usage.cost }).eq("id", run.id);
  };

  const cache = { cache_control: { type: "ephemeral" as const } };
  const index = catalogIndex(tools);
  const system = [{ type: "text" as const, text: [conversationSystemPrompt(agentName), index].filter(Boolean).join("\n\n"), ...cache }];
  const toolParams = toolParamsFor(tools, cache, false);
  const serverTools = [...webTools(model), ...(needsToolSearch(tools) ? [TOOL_SEARCH] : [])];
  const deadline = Date.now() + SLICE_MS;
  // The same slice bound as execute(): a hung call aborts at the deadline
  // and the run pauses, resumable, instead of dying with the invocation.
  const sliceSignal = () => AbortSignal.timeout(Math.max(deadline - Date.now(), 1));

  const outcome = await runLoop(state, {
    callModel: async (messages) => {
      // deno-lint-ignore no-explicit-any
      const res: any = await modelClient.beta.messages.create({
        model,
        max_tokens: 16000,
        system,
        // deno-lint-ignore no-explicit-any
        tools: [...serverTools, ...toolParams] as any,
        // deno-lint-ignore no-explicit-any
        messages: messages as any,
        // A conversation is answered while the person waits.
        output_config: { effort: "low" },
      // deno-lint-ignore no-explicit-any
      } as any, { signal: sliceSignal() });
      // Words said on the way, before the tools they lead into, are part of the conversation.
      const blocks = (res.content ?? []) as { type: string; text?: string }[];
      const words = blocks.filter((b) => b.type === "text" && b.text?.trim()).map((b) => b.text!.trim()).join("\n\n");
      if (words && blocks.some((b) => b.type === "tool_use")) await addStep(admin, run.id, "reply", words.split("\n")[0].slice(0, 200), words);
      for (const line of webSteps(res.content ?? [])) await addStep(admin, run.id, "action", line);
      return { content: res.content, stop_reason: res.stop_reason, usage: res.usage };
    },
    kindOf: conversationKindOf,
    needsApproval: () => false,
    execute: (call) => executeCall(call),
    onUsage: recordUsage,
    afterTurn: () => saveTranscript(),
    budgetExceeded: () => spentBefore + usage.cost >= budget || usage.cost >= MAX_RUN_COST_USD,
    cancelled: async () => {
      const { data } = await admin.from("agent_runs").select("status").eq("id", run.id).maybeSingle();
      return data?.status === "cancelled";
    },
  }, { maxTurnsThisCall: MAX_TURNS_PER_SLICE, maxTotalTurns: turnBudget, deadline });

  await saveTranscript();
  const wait = async (summary: string, error: string | null = null, status = "awaiting_input") => {
    await admin.from("agent_runs").update({ status, summary: summary.slice(0, 300), error, continuation_token: null })
      .eq("id", run.id).eq("status", "running");
  };
  switch (outcome.kind) {
    case "finished":
      await wait(outcome.finish.summary);
      await addStep(admin, run.id, "reply", outcome.finish.summary, outcome.finish.message);
      // Memory: a landed turn that did real tool work is distilled the
      // same way a run's finish is — scope follows the conversation's
      // own boundary (its Space, or the person when it has none).
      if (landingWorthDistilling(toolCallsThisTurn)) {
        const { data: strategy } = await userDb.from("strategies").select("name").eq("id", strategyId).maybeSingle();
        await captureMemories({
          admin, userId: user.id,
          scope: captureScopeOf(run.activity_space_id), spaceId: run.activity_space_id,
          material: {
            finishSummary: outcome.finish.summary, finishMessage: outcome.finish.message,
            stepTitles: await loadStepTitles(admin, run.id),
            verdictGaps: [], integrationNames: [],
            subjectTitle: strategy?.name ?? null, subjectDescription: null, personSaid: said || null,
          },
          call: { client: modelClient, model, recordUsage },
          budgetOk: spentBefore + usage.cost < budget && usage.cost < MAX_RUN_COST_USD,
          sourceRunId: run.id, sourceSessionId: null,
          links: { strategyId },
          noteKept: async (titles) => { await addStep(admin, run.id, "memory", `記憶に残しました: ${titles.join("、")}`); },
        });
      }
      return;
    case "yield": {
      // The answer is still being worked out: the next slice carries on.
      const token = crypto.randomUUID();
      const { data: armed } = await admin.from("agent_runs").update({ continuation_token: token, continuation_count: run.continuation_count + 1 })
        .eq("id", run.id).eq("status", "running").select("id").maybeSingle();
      if (!armed) return;
      await fetch(`${a.supabaseUrl}/functions/v1/run-agent`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${a.jwt}` },
        body: JSON.stringify({ runId: run.id, continue: true, token }),
      }).catch(async (e) => wait("続きを開始できませんでした", errorMessage(e), "paused"));
      return;
    }
    case "approval":
      // Nothing in a conversation asks for approval; answer it as refused.
      await wait("承認が要る操作は会話ではできません", "承認が要る操作は会話ではできません", "paused");
      return;
    case "limit":
      await wait("この発言への作業が上限に達しました。続けるには、もう一度話しかけてください。");
      return;
    case "budget": {
      const why = usage.cost >= MAX_RUN_COST_USD
        ? `この会話の上限（$${MAX_RUN_COST_USD}）に達しました。新しい会話を始めてください。`
        : run.activity_space_id ? "この Space の今月の AI 予算の上限に達しました。" : "今月の AI 予算（個人）の上限に達しました。";
      await wait("予算の上限に達しました", why, "paused");
      await addStep(admin, run.id, "error", "予算の上限に達しました", why);
      return;
    }
    case "cancelled":
      await addStep(admin, run.id, "status", "停止しました");
      return;
    case "refusal":
      await wait("モデルがこの依頼を断りました", outcome.detail.slice(0, 300));
      return;
  }
}

// ── Athena's draft driver: a connection drafted from its official spec ──
// The run's subject is an integration_drafts row (G4). Before any model
// call, the reconcile (§4.7) runs on the server: a service that already
// has a route — connected, a preset, a Registry server, an existing row
// to update, an open draft to join — is never drafted. The drafter's
// proposals are validated server-side (connectorDraft) before they are
// stored; its questions rest the draft in awaiting_input and the run
// with it, and a person's message resumes both. Tests and activation
// are later stages of the same draft (draftTest.ts / the owner's RPC);
// this driver ends when the drafting itself is done, one way or another.

/** The reconcile's presets: the built-ins a name can resolve to. Custom
 *  kinds and the drafted provenance are not routes to anywhere. */
const DRAFT_PRESETS = Object.entries(CONNECTOR_PRESET_NAMES)
  .filter(([id]) => !id.startsWith("custom-") && id !== AI_DRAFTED_PRESET)
  .map(([id, name]) => ({ id, name }));

/** One bounded Registry page for the reconcile: a server whose title (or
 *  its name's last part) folds to the requested name. A registry that
 *  cannot be reached is "no hit", never a blocker — drafting proceeds
 *  and the sources show what was actually used. */
async function registryHitFor(name: string): Promise<{ title: string; endpoint: string } | null> {
  try {
    const target = new URL(REGISTRY_URL);
    target.searchParams.set("version", "latest");
    target.searchParams.set("limit", "60");
    target.searchParams.set("search", name.slice(0, 100));
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    try {
      const res = await fetch(target, { headers: { accept: "application/json" }, signal: ctl.signal });
      if (!res.ok) return null;
      const { entries } = entriesOf(await res.json());
      const key = foldConnectorName(name);
      return entries.find((e) => foldConnectorName(e.title) === key) ?? null;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

interface ReconcileResult {
  /** Set when the draft closes without drafting. */
  close?: { status: "rerouted" | "superseded"; summary: string };
  /** The opening's account of the reconcile when drafting proceeds. */
  note: string;
}

async function reconcileForDraft(a: ExecArgs, d: DraftRow): Promise<ReconcileResult> {
  const { admin, userDb } = a;
  const spaceId = d.activity_space_id;
  const [{ data: rowData }, { data: draftData }] = await Promise.all([
    userDb.from("integrations").select("id, name, preset, enabled, endpoint").eq("activity_space_id", spaceId).in("kind", ["mcp", "http"]),
    admin.from("integration_drafts").select("id, name_key, status").eq("activity_space_id", spaceId)
      .in("status", ["drafting", "awaiting_input", "testing", "awaiting_review"]),
  ]);
  const rows = (rowData ?? []) as { id: string; name: string; preset: string | null; enabled: boolean; endpoint: string }[];
  const context = (d.request_context ?? {}) as { docsUrl?: string | null };
  const knownHost = (() => {
    try { return context.docsUrl ? new URL(context.docsUrl).hostname : null; } catch { return null; }
  })();
  // The registry outranks the update and join legs, so it is always asked.
  const registryHit = await registryHitFor(d.name);
  const outcome = reconcileDraft({
    name: d.name, rows, presets: DRAFT_PRESETS, registryHit,
    drafts: (draftData ?? []) as { id: string; name_key: string; status: string }[],
    selfDraftId: d.id, knownHost,
  });
  switch (outcome.kind) {
    case "connected":
      return { close: { status: "rerouted", summary: `「${d.name}」はすでに接続されています。起草は不要でした。` }, note: "" };
    case "preset":
      return { close: { status: "rerouted", summary: `「${d.name}」には組み込みの接続（プリセット）があります。設定の接続ダイアログから接続してください。起草はしません。` }, note: "" };
    case "registry":
      return { close: { status: "rerouted", summary: `「${d.name}」は MCP Registry にサーバがあります（${outcome.entry.title}: ${outcome.entry.endpoint}）。Registry 経由の接続を使ってください。起草はしません。` }, note: "" };
    case "join":
      return { close: { status: "superseded", summary: "同じサービスの起草がすでに進んでいます。そちらのドラフトに合流しました。" }, note: "" };
    case "update": {
      const target = rows.find((r) => r.id === outcome.rowId);
      if (d.target_integration_id !== outcome.rowId) {
        await admin.from("integration_drafts").update({ target_integration_id: outcome.rowId, updated_at: new Date().toISOString() }).eq("id", d.id);
        d.target_integration_id = outcome.rowId;
      }
      return { note: `既存の接続「${target?.name ?? d.name}」への定義の更新として起草します。テストは複製行で行い、有効化のときに原本へ反映されます。既存の接続は止めません。` };
    }
    case "create":
      return { note: "既存の経路（接続・プリセット・Registry・進行中の起草）はありません。新規の接続として起草します。" };
  }
}

/** The host a candidate's endpoint must agree with: the person's own
 *  documentation URL when they gave one, else the first cited source's. */
function officialHostFor(d: DraftRow, candidate: DraftCandidate): string | null {
  const context = (d.request_context ?? {}) as { docsUrl?: string | null };
  const from = context.docsUrl ?? candidate.sources[0] ?? null;
  try { return from ? new URL(from).hostname : null; } catch { return null; }
}

async function draft(a: ExecArgs, said: string): Promise<void> {
  stepBase.delete(a.run.id);
  stepNext.delete(a.run.id);
  const { run, admin, user } = a;
  const draftId = run.integration_draft_id!;
  let d = await loadDraft(admin, draftId);
  if (!d) { await failRun(admin, run, "起草の対象が見つかりません。"); return; }
  // The draft names its run (the review screen links to it; the run's
  // steps are the drafting's audit record). The creator cannot always
  // write the draft row, so the driver stamps it.
  if (d.draft_run_id !== run.id) {
    await admin.from("integration_drafts").update({ draft_run_id: run.id, updated_at: new Date().toISOString() }).eq("id", d.id);
    d.draft_run_id = run.id;
  }

  const config = resolveAgentConfig(null, null, null, run.transcript?.messages?.length ? run.model : null);
  const { agentName, model } = config;
  if (!a.anthropicKey) { await failRun(admin, run, "ANTHROPIC_API_KEY が設定されていません。"); return; }
  const modelClient = new Anthropic({ apiKey: a.anthropicKey });
  await admin.from("agent_runs").update({ model }).eq("id", run.id);

  const { budget, spentBefore } = await loadRunBudget(admin, run, user.id);
  let usage = { input: run.input_tokens, output: run.output_tokens, cost: Number(run.cost_usd || 0) };

  const complete = async (summary: string) => {
    await admin.from("agent_runs").update({
      status: "completed", summary: summary.slice(0, 300), error: null,
      finished_at: new Date().toISOString(), continuation_token: null,
    }).eq("id", run.id).eq("status", "running");
  };
  const rest = async (summary: string, error: string | null = null, status = "awaiting_input") => {
    await admin.from("agent_runs").update({ status, summary: summary.slice(0, 300), error, continuation_token: null })
      .eq("id", run.id).eq("status", "running");
  };

  // A draft that already ended has no drafting left in it.
  if (d.status === "active" || d.status === "rejected" || d.status === "failed" ||
      d.status === "expired" || d.status === "superseded" || d.status === "rerouted") {
    await complete(`この起草はすでに終わっています（状態: ${d.status}）。`);
    return;
  }

  const tools: RunToolDef[] = run.transcript?.tools?.length ? run.transcript.tools : draftTools();
  let state: LoopState;
  let finished: { kind: "ready" | "rerouted" | "failed" | "testing_wait"; reason: string } | null = null;

  if (run.transcript?.messages?.length) {
    state = { messages: run.transcript.messages, turns: run.transcript.turns ?? 0, nudges: 0, revisions: 0 };
    // Test rounds the conversation has not seen yet enter it once, so a
    // "fix this" is answered against the evidence, not from memory.
    const rounds = draftRounds(d);
    const seen = state.messages.filter((m) => typeof m.content === "string" && m.content.includes("【テスト結果】")).length;
    if (rounds.length > seen) {
      state.messages.push({ role: "user", content: `【テスト結果】\n${summarizeRound(rounds[rounds.length - 1])}` });
    }
    if (said) state.messages.push({ role: "user", content: said });
    // A person's answer reopens the draft; a "fix this" after a test
    // round reopens it for revision (the round itself stays recorded).
    if (d.status === "awaiting_input") {
      await transitionDraft(admin, d, "drafting", { awaiting_question: null });
    } else if (d.status === "testing" && d.test_results) {
      await transitionDraft(admin, d, "drafting", {});
    }
  } else {
    const rec = await reconcileForDraft(a, d);
    if (rec.close) {
      await transitionDraft(admin, d, rec.close.status, {});
      await addStep(admin, run.id, "status", "照合で起草を閉じました", rec.close.summary);
      await complete(rec.close.summary);
      return;
    }
    const context = (d.request_context ?? {}) as { entry?: string; waitingFor?: string; purpose?: string; docsUrl?: string };
    const manifest = d.manifest as { commands?: { name?: unknown }[] } | null;
    state = {
      messages: [{
        role: "user",
        content: draftOpening({
          name: d.name,
          entry: context.entry ?? null,
          waitingFor: context.waitingFor ?? null,
          purpose: context.purpose ?? null,
          docsUrl: context.docsUrl ?? null,
          reconcileNote: rec.note,
          candidate: d.endpoint
            ? { endpoint: d.endpoint, commands: (manifest?.commands ?? []).map((c) => String(c?.name ?? "")).filter(Boolean) }
            : null,
          answeredQuestion: d.status === "awaiting_input" ? d.awaiting_question : null,
          lastTestRound: null,
          today: new Date().toISOString().slice(0, 10),
        }, said),
      }],
      turns: 0, nudges: 0,
    };
    await addStep(admin, run.id, "status", "起草を開始", `${agentName} / ${config.modelLabel}`);
  }
  const turnBudget = state.turns + config.maxTotalTurns;
  if (said) await addStep(admin, run.id, "message", said.split("\n")[0].slice(0, 200), said);

  const saveTranscript = async () => {
    const transcript: Transcript = { messages: state.messages, turns: state.turns, nudges: 0, revisions: 0, turnBudget, tools };
    const clean = JSON.parse(JSON.stringify(transcript).replace(/\\u0000/g, ""));
    const { error } = await admin.from("agent_runs").update({ transcript: clean }).eq("id", run.id);
    if (error) throw new Error(`経過を保存できませんでした: ${error.message}`);
  };
  await saveTranscript();

  const executeCall = async (call: ToolCall): Promise<{ content: string; is_error?: boolean }> => {
    if (call.name === PROPOSE_TOOL.name) {
      const input = (call.input ?? {}) as Record<string, unknown>;
      const candidate: DraftCandidate = {
        name: d.name,
        endpoint: String(input.endpoint ?? ""),
        authType: String(input.authType ?? ""),
        authHeader: typeof input.authHeader === "string" && input.authHeader.trim() ? input.authHeader.trim() : null,
        manifest: input.manifest ?? null,
        guide: typeof input.guide === "string" ? input.guide : null,
        testInputs: (input.testInputs && typeof input.testInputs === "object" && !Array.isArray(input.testInputs)
          ? input.testInputs : {}) as Record<string, Record<string, unknown>>,
        sources: Array.isArray(input.sources) ? input.sources.filter((s): s is string => typeof s === "string") : [],
      };
      const { errors, manifest } = validateDraftCandidate(candidate, { officialHost: officialHostFor(d, candidate) });
      if (errors.length || !manifest) {
        await addStep(admin, run.id, "error", "候補が検証に通りませんでした", errors.join("\n"));
        return { content: `検証で落ちました。直して出し直してください:\n- ${errors.join("\n- ")}`, is_error: true };
      }
      const dropsIn: DraftDrop[] = (Array.isArray(input.drops) ? input.drops : [])
        .map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          return { name: String(o.name ?? ""), reason: String(o.reason ?? "") };
        })
        .filter((x) => x.name);
      const drops = [...d.dropped_commands];
      for (const drop of dropsIn) if (!drops.some((x) => x.name === drop.name)) drops.push(drop);
      const unaccounted = unaccountedDrops(d.required_commands, manifest, drops);
      if (unaccounted.length) {
        return {
          content: `必須の command が理由なく外れています: ${unaccounted.join("、")}。候補に戻すか、drops に { name, reason } で理由を書いてください（理由は審査画面に出ます）。`,
          is_error: true,
        };
      }
      const stored: DraftCandidate = { ...candidate, manifest: JSON.parse(JSON.stringify(manifest)) as unknown };
      if (!await applyCandidate(admin, d, stored, drops)) {
        return { content: "候補を保存できませんでした（ドラフトの状態が変わっています）。", is_error: true };
      }
      d = (await loadDraft(admin, draftId)) ?? d;
      const names = manifest.commands.map((c) => c.name);
      await addStep(admin, run.id, "action", "接続の候補を提出しました", `${candidate.endpoint}\ncommands: ${names.join("、")}`);
      return { content: "候補を受け付けました。テストへ進める形なら finish_draft(outcome=ready) で終えてください。実在する ID 等が分からない command があれば、推測で埋めず ask_person で聞いてください。" };
    }
    if (call.name === ASK_TOOL.name) {
      const question = String(call.input.question ?? "").trim();
      if (!question) return { content: "question が要ります。", is_error: true };
      if (!await askDraft(admin, d, question)) return { content: "質問を記録できませんでした（ドラフトの状態が変わっています）。", is_error: true };
      await addStep(admin, run.id, "status", "人に確認しています", question);
      return { content: "質問を記録しました。人に短く伝えて、このターンを終えてください。人が答えると起草が再開します。" };
    }
    if (call.name === FINISH_TOOL.name) {
      const outcomeIn = String(call.input.outcome ?? "");
      const reason = String(call.input.reason ?? "").trim().slice(0, 500);
      if (outcomeIn === "ready") {
        if (!d.endpoint || !d.manifest) return { content: "候補がまだ提出されていません。propose_manifest を先に通してください。", is_error: true };
        // Materialise the candidate as a disabled row (a clone, for an
        // update) and test it. A credential the owner has not entered
        // yet rests the draft in testing and this run with it; the test
        // then runs from the review screen.
        if (d.status === "drafting") await transitionDraft(admin, d, "testing", {});
        const mat = await materializeDraft(admin, d);
        if ("error" in mat) return { content: `素材化できませんでした: ${mat.error}`, is_error: true };
        const needsSecret = (d.auth_type ?? "none") !== "none" && !mat.row.secret_id;
        if (needsSecret) {
          finished = { kind: "testing_wait", reason: "認証情報の入力を待っています。審査画面で owner が入力するとテストが進みます。" };
          await addStep(admin, run.id, "status", "認証情報の入力を待っています", "候補を素材化しました。テストは認証情報の入力後に審査画面から実行されます。");
          return { content: "候補を素材化しました。認証情報がまだ入力されていないため、テストは審査画面で owner が認証情報を入れてから行われます。短く伝えて終えてください。" };
        }
        const tested = await runDraftTestRound(admin, d);
        if ("error" in tested) return { content: `テストを実行できませんでした: ${tested.error}`, is_error: true };
        const round = tested.round;
        await addStep(admin, run.id, round.outcome === "passed" ? "status" : "error", "接続テストを実行しました", summarizeRound(round));
        if (round.outcome === "passed") {
          finished = { kind: "ready", reason: reason || "テストが通り、審査待ちになりました。" };
          return { content: "テストが通り、審査待ちになりました。何を起草し、どう確かめたか短く報告して終えてください。" };
        }
        if (d.status === "failed") {
          finished = { kind: "failed", reason: "テストの往復上限に達しました。" };
          return { content: "テストの往復上限に達し、起草は失敗として記録されました。試したことと結果を短く伝えて終えてください。" };
        }
        if (round.outcome === "auth_unverified" || round.outcome === "unverifiable") {
          finished = { kind: "testing_wait", reason: "テストの証跡は揃いました。審査へ進めるかの判断を owner が行います。" };
          return { content: `${summarizeRound(round)}\n証跡は揃いましたが、審査へ進めるかの判断は owner が行います。短く伝えて終えてください。` };
        }
        // A failed round, back in drafting: the loop revises against it.
        return {
          content: `テストで落ちました。分類に沿って候補を直し、propose_manifest → finish_draft をもう一度行ってください。\n${summarizeRound(round)}`,
          is_error: true,
        };
      }
      if (outcomeIn === "rerouted" || outcomeIn === "failed") {
        if (!reason) return { content: "reason（理由・案内）が要ります。", is_error: true };
        if (outcomeIn === "rerouted") await transitionDraft(admin, d, "rerouted", {});
        else await transitionDraft(admin, d, "failed", { failure_class: null });
        finished = { kind: outcomeIn, reason };
        await addStep(admin, run.id, "status", outcomeIn === "rerouted" ? "既存の経路へ案内して閉じました" : "起草を諦めました", reason);
        return { content: "記録しました。理由を短く伝えて終えてください。" };
      }
      return { content: "outcome は ready / rerouted / failed のいずれかです。", is_error: true };
    }
    return { content: `この起草では使えない道具です: ${call.name}`, is_error: true };
  };

  const recordUsage = async (u: ModelUsage) => {
    usage = {
      input: usage.input + (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      output: usage.output + (u.output_tokens ?? 0),
      cost: Math.round((usage.cost + costAt(config.price, u)) * 1_000_000) / 1_000_000,
    };
    await admin.from("agent_runs").update({ input_tokens: usage.input, output_tokens: usage.output, cost_usd: usage.cost }).eq("id", run.id);
  };

  const cache = { cache_control: { type: "ephemeral" as const } };
  const system = [{ type: "text" as const, text: draftSystemPrompt(agentName), ...cache }];
  const toolParams = toolParamsFor(tools, cache, false);
  const serverTools = [...webTools(model)];
  const deadline = Date.now() + SLICE_MS;
  const sliceSignal = () => AbortSignal.timeout(Math.max(deadline - Date.now(), 1));

  const outcome = await runLoop(state, {
    callModel: async (messages) => {
      // deno-lint-ignore no-explicit-any
      const res: any = await modelClient.beta.messages.create({
        model,
        max_tokens: 16000,
        system,
        // deno-lint-ignore no-explicit-any
        tools: [...serverTools, ...toolParams] as any,
        // deno-lint-ignore no-explicit-any
        messages: messages as any,
        output_config: { effort: "low" },
      // deno-lint-ignore no-explicit-any
      } as any, { signal: sliceSignal() });
      const blocks = (res.content ?? []) as { type: string; text?: string }[];
      const words = blocks.filter((b) => b.type === "text" && b.text?.trim()).map((b) => b.text!.trim()).join("\n\n");
      if (words && blocks.some((b) => b.type === "tool_use")) await addStep(admin, run.id, "reply", words.split("\n")[0].slice(0, 200), words);
      for (const line of webSteps(res.content ?? [])) await addStep(admin, run.id, "action", line);
      return { content: res.content, stop_reason: res.stop_reason, usage: res.usage };
    },
    kindOf: draftKindOf,
    needsApproval: () => false,
    execute: (call) => executeCall(call),
    onUsage: recordUsage,
    afterTurn: () => saveTranscript(),
    budgetExceeded: () => spentBefore + usage.cost >= budget || usage.cost >= MAX_RUN_COST_USD,
    cancelled: async () => {
      const { data } = await admin.from("agent_runs").select("status").eq("id", run.id).maybeSingle();
      return data?.status === "cancelled";
    },
  }, { maxTurnsThisCall: MAX_TURNS_PER_SLICE, maxTotalTurns: turnBudget, deadline });

  await saveTranscript();
  switch (outcome.kind) {
    case "finished": {
      if (finished?.kind === "ready") {
        await addStep(admin, run.id, "reply", outcome.finish.summary, outcome.finish.message);
        await complete(finished.reason || "起草がまとまりました。テストと審査に進めます。");
        return;
      }
      if (finished?.kind === "testing_wait") {
        await addStep(admin, run.id, "reply", outcome.finish.summary, outcome.finish.message);
        await rest(finished.reason);
        return;
      }
      if (finished) {
        await addStep(admin, run.id, "reply", outcome.finish.summary, outcome.finish.message);
        await complete(finished.reason);
        return;
      }
      await rest(outcome.finish.summary);
      await addStep(admin, run.id, "reply", outcome.finish.summary, outcome.finish.message);
      return;
    }
    case "yield": {
      const token = crypto.randomUUID();
      const { data: armed } = await admin.from("agent_runs").update({ continuation_token: token, continuation_count: run.continuation_count + 1 })
        .eq("id", run.id).eq("status", "running").select("id").maybeSingle();
      if (!armed) return;
      await fetch(`${a.supabaseUrl}/functions/v1/run-agent`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${a.jwt}` },
        body: JSON.stringify({ runId: run.id, continue: true, token }),
      }).catch(async (e) => rest("続きを開始できませんでした", errorMessage(e), "paused"));
      return;
    }
    case "approval":
      await rest("承認が要る操作は起草ではできません", "承認が要る操作は起草ではできません", "paused");
      return;
    case "limit":
      await rest("この発言への作業が上限に達しました。続けるには、もう一度話しかけてください。");
      return;
    case "budget": {
      const why = usage.cost >= MAX_RUN_COST_USD
        ? `この起草の上限（$${MAX_RUN_COST_USD}）に達しました。`
        : run.activity_space_id ? "この Space の今月の AI 予算の上限に達しました。" : "今月の AI 予算（個人）の上限に達しました。";
      await rest("予算の上限に達しました", why, "paused");
      await addStep(admin, run.id, "error", "予算の上限に達しました", why);
      return;
    }
    case "cancelled":
      await addStep(admin, run.id, "status", "停止しました");
      return;
    case "refusal":
      await rest("モデルがこの依頼を断りました", outcome.detail.slice(0, 300));
      return;
  }
}

/** The Space's Objects a binding may choose from (through its Domains). */
async function spaceObjects(admin: SupabaseClient, spaceId: string): Promise<{ id: string; name: string }[]> {
  const { data: doms } = await admin.from("domains").select("id").eq("activity_space_id", spaceId);
  const domainIds = ((doms ?? []) as { id: string }[]).map((d) => d.id);
  if (!domainIds.length) return [];
  const { data } = await admin.from("objects").select("id, name").in("domain_id", domainIds).is("archived_at", null).order("name");
  return (data ?? []) as { id: string; name: string }[];
}

/**
 * Assembles a promotion's drafting material from its source (§4.3):
 * for a memory, the memory itself; for a run, the run's step titles,
 * its finish, and the Element and definition it worked under. Every
 * fragment passes the hygiene gate — a tainted fragment drops whole, an
 * instruction-shaped one is excluded as an instruction — and what was
 * given (and what was dropped, and why) is recorded on the draft, so
 * the reviewer can see the provenance of what they approve. Raw tool
 * I/O, response bodies and attachments never enter: the record is
 * titles, summaries and the person's own words, the Memory discipline.
 */
async function assemblePromotionMaterial(
  admin: SupabaseClient, d: PromotionDraftRow,
): Promise<{ text: string; sources: PromotionMaterialSource[]; sourceLine: string } | { missing: string }> {
  const sources: PromotionMaterialSource[] = [];
  const parts: string[] = [];
  const take = (kind: PromotionMaterialSource["kind"], ref: string, label: string, fragment: string) => {
    const cleaned = cleanPromotionMaterial(fragment);
    sources.push({ kind, ref, tainted: cleaned.tainted, instructionShaped: cleaned.instructionShaped });
    if (cleaned.tainted) {
      parts.push(`### ${label}\n（秘密らしい値を含んでいたため、この断片は材料から外しました）`);
    } else if (cleaned.instructionShaped) {
      parts.push(`### ${label}\n（命令形の文を含んでいたため、この断片は指示としては無効化しました。内容の要約だけを残します）`);
    } else {
      parts.push(`### ${label}\n${cleaned.text}`);
    }
  };

  if (d.source_kind === "memory") {
    if (!d.source_memory_id) return { missing: "元の記憶が指定されていません。" };
    const { data: mem } = await admin.from("memories")
      .select("id, title, gist, body").eq("id", d.source_memory_id).maybeSingle();
    if (!mem) return { missing: "元の記憶が見つかりませんでした（削除された可能性があります）。" };
    const m = mem as { id: string; title: string; gist: string; body: string };
    parts.push(`## 元の記憶「${m.title}」`);
    take("memory", m.id, "記憶の要約", m.gist);
    take("memory", m.id, "記憶の本文", m.body);
    return { text: parts.join("\n\n"), sources, sourceLine: `記憶「${m.title}」（手順の durable 記憶）` };
  }

  if (!d.source_run_id) return { missing: "元の実行が指定されていません。" };
  const { data: srcRun } = await admin.from("agent_runs")
    .select("id, element_id, summary, result, status").eq("id", d.source_run_id).maybeSingle();
  if (!srcRun) return { missing: "元の実行が見つかりませんでした。" };
  const r = srcRun as { id: string; element_id: string | null; summary: string | null; result: string | null; status: string };
  const { data: stepRows } = await admin.from("agent_run_steps")
    .select("title").eq("run_id", r.id).order("idx", { ascending: true }).limit(120);
  const titles = ((stepRows ?? []) as { title: string }[]).map((s) => s.title).filter(Boolean);
  parts.push("## 元の実行の記録");
  if (titles.length) take("run", r.id, "実行のステップ見出し", titles.map((t) => `- ${t}`).join("\n"));
  if (r.summary) take("run", r.id, "実行のまとめ", r.summary);
  if (r.result) take("run", r.id, "実行の成果", r.result);
  let elementTitle: string | null = null;
  if (r.element_id) {
    const { data: el } = await admin.from("elements")
      .select("id, title, description, definition_id").eq("id", r.element_id).maybeSingle();
    if (el) {
      const e = el as { id: string; title: string; description: string | null; definition_id: string | null };
      elementTitle = e.title;
      take("element", e.id, "仕事（Element）", [e.title, e.description ?? ""].filter(Boolean).join("\n"));
      if (e.definition_id) {
        const { data: defRow } = await admin.from("definitions").select("name, body").eq("id", e.definition_id).maybeSingle();
        if (defRow) {
          const df = defRow as { name: string; body: string };
          take("element", e.definition_id, `その仕事が従った定義「${df.name}」`, df.body);
        }
      }
    }
  }
  return {
    text: parts.join("\n\n"), sources,
    sourceLine: `実行「${elementTitle ?? (r.summary ?? "").slice(0, 60) ?? "終わった実行"}」（終わった実行）`,
  };
}

// ── The promotion driver: one-off work becomes a standing harness ────
// serve() claimed the run (its subject is the draft). The drafter works
// from the source's record only, proposes a package (definition +
// binding), and finishing "ready" runs the testing stage's first half:
// the static gate and the connector matching, then the tested hashes
// are frozen and the draft moves to rehearsing. It creates neither a
// definition nor an Automation — activation is the owner's RPC (PR4).
async function promote(a: ExecArgs, said: string): Promise<void> {
  stepBase.delete(a.run.id);
  stepNext.delete(a.run.id);
  const { run, admin, user } = a;
  const draftId = run.promotion_draft_id!;
  let d = await loadPromotionDraft(admin, draftId);
  if (!d) { await failRun(admin, run, "起草の対象が見つかりません。"); return; }
  if (d.draft_run_id !== run.id) {
    await admin.from("promotion_drafts").update({ draft_run_id: run.id, updated_at: new Date().toISOString() }).eq("id", d.id);
    d.draft_run_id = run.id;
  }

  const config = resolveAgentConfig(null, null, null, run.transcript?.messages?.length ? run.model : null);
  const { agentName, model } = config;
  if (!a.anthropicKey) { await failRun(admin, run, "ANTHROPIC_API_KEY が設定されていません。"); return; }
  const modelClient = new Anthropic({ apiKey: a.anthropicKey });
  await admin.from("agent_runs").update({ model }).eq("id", run.id);

  const { budget, spentBefore } = await loadRunBudget(admin, run, user.id);
  let usage = { input: run.input_tokens, output: run.output_tokens, cost: Number(run.cost_usd || 0) };

  const complete = async (summary: string) => {
    await admin.from("agent_runs").update({
      status: "completed", summary: summary.slice(0, 300), error: null,
      finished_at: new Date().toISOString(), continuation_token: null,
    }).eq("id", run.id).eq("status", "running");
  };
  const rest = async (summary: string, error: string | null = null, status = "awaiting_input") => {
    await admin.from("agent_runs").update({ status, summary: summary.slice(0, 300), error, continuation_token: null })
      .eq("id", run.id).eq("status", "running");
  };

  if (d.status === "active" || d.status === "rejected" || d.status === "expired" || d.status === "failed") {
    await complete(`この起草はすでに終わっています（状態: ${d.status}）。`);
    return;
  }

  const startRehearsalRun = async (runId: string, resume: boolean) => {
    await fetch(`${a.supabaseUrl}/functions/v1/run-agent`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${a.jwt}` },
      body: JSON.stringify(resume ? { runId, resume: true } : { runId }),
    }).catch(() => {});
  };

  // A draft in rehearsing has no drafting to do: settle a finished
  // rehearsal (whoever gets here first — the tick settles too), restart
  // one that never got going, and rest while one is still running. A
  // rehearsal that failed drops the draft back to drafting below, with
  // its report put in front of the drafter.
  if (d.status === "rehearsing") {
    const settled = await settlePromotionRehearsal(admin, d);
    d = settled.draft;
    if (d.status === "awaiting_review") { await complete("試走が通り、審査待ちになりました。審査は設定 › ハーネスで行えます。"); return; }
    if (d.status === "failed") { await complete("試走の書き直しの上限に達し、起草は失敗として記録されました。"); return; }
    if (d.status === "rehearsing") {
      const rep = readRehearsalReport(d.rehearsal_report);
      if (rep.outcome === "unverifiable") { await complete("試走では確かめきれませんでした。審査へ進めるかは owner の確認待ちです。"); return; }
      if (d.rehearsal_run_id) {
        const { data: rr } = await admin.from("agent_runs").select("status").eq("id", d.rehearsal_run_id).maybeSingle();
        if (rr?.status === "queued") await startRehearsalRun(d.rehearsal_run_id, false);
        else if (rr?.status === "paused") await startRehearsalRun(d.rehearsal_run_id, true);
      } else {
        const pkg = draftPackageOf(d);
        if (pkg) {
          await launchPromotionRehearsal({
            admin, userDb: a.userDb, draft: d, pkg,
            startRun: async (id) => { await startRehearsalRun(id, false); },
          });
          d = (await loadPromotionDraft(admin, draftId)) ?? d;
        }
      }
      await rest("試走が進行中です。終わると審査に進むか、結果を持って起草に戻ります。");
      return;
    }
  }

  const tools: RunToolDef[] = run.transcript?.tools?.length ? run.transcript.tools : promotionTools();
  let state: LoopState;
  let finished: { kind: "rehearsal_started" | "failed"; reason: string } | null = null;

  if (run.transcript?.messages?.length) {
    state = { messages: run.transcript.messages, turns: run.transcript.turns ?? 0, nudges: 0, revisions: 0 };
    if (said) state.messages.push({ role: "user", content: said });
    if (d.status === "awaiting_input") {
      await transitionPromotionDraft(admin, d, "drafting", { awaiting_question: null });
    }
    // A rehearsal's failure the conversation has not seen enters it
    // once, so a "fix this" is answered against the evidence.
    if (d.status === "drafting" && d.failure_class && d.rehearsal_report) {
      const rep = readRehearsalReport(d.rehearsal_report);
      const seen = state.messages.some((m) => typeof m.content === "string" && m.content.includes("【試走の結果】"));
      if (!seen && rep.at) {
        state.messages.push({
          role: "user",
          content: `【試走の結果 ${rep.at}】\n${summarizeRehearsalReport(rep, d.failure_class)}`,
        });
      }
    }
  } else {
    // The reconcile (§4.5 rules 1–2): an update target — named at
    // creation, or found through the draft this source already
    // activated — pins the base hash the activation will compare.
    let reconcileNote = "この元の仕事から生まれた定義はまだありません。新規の定義として起草します。";
    let targetBody: { name: string; body: string } | null = null;
    const resolveTarget = async (definitionId: string) => {
      const { data: defRow } = await admin.from("definitions").select("id, name, body").eq("id", definitionId).maybeSingle();
      if (!defRow) return;
      const def = defRow as { id: string; name: string; body: string };
      targetBody = { name: def.name, body: def.body };
      if (d.target_definition_id !== def.id || !d.base_definition_hash) {
        const base = await promotionStructureHash(def.name, def.body);
        await admin.from("promotion_drafts").update({
          target_definition_id: def.id, base_definition_hash: base,
          base_name: def.name, base_body: def.body, updated_at: new Date().toISOString(),
        }).eq("id", d.id);
        d.target_definition_id = def.id;
        d.base_definition_hash = base;
      }
      reconcileNote = `この元の仕事からはすでに定義「${def.name}」が生まれています。今回はその更新として起草します（元の本文は材料に含めます）。有効化のとき、起草開始時点の姿と照合され、人の編集が入っていれば黙って上書きはしません。`;
    };
    if (d.target_definition_id) {
      await resolveTarget(d.target_definition_id);
    } else {
      const sourceCol = d.source_kind === "memory" ? "source_memory_id" : "source_run_id";
      const sourceVal = d.source_kind === "memory" ? d.source_memory_id : d.source_run_id;
      if (sourceVal) {
        const { data: prior } = await admin.from("promotion_drafts")
          .select("activated_definition_id").eq(sourceCol, sourceVal).eq("status", "active").not("activated_definition_id", "is", null)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        const priorDef = (prior as { activated_definition_id?: string | null } | null)?.activated_definition_id;
        if (priorDef) await resolveTarget(priorDef);
      }
    }

    const material = await assemblePromotionMaterial(admin, d);
    if ("missing" in material) {
      await transitionPromotionDraft(admin, d, "failed", {});
      await appendPromotionEvent(admin, d, { at: new Date().toISOString(), kind: "drafting_failed", note: material.missing });
      await addStep(admin, run.id, "error", "材料が揃いませんでした", material.missing);
      await complete(material.missing);
      return;
    }
    await admin.from("promotion_drafts").update({
      material_sources: material.sources as unknown as Record<string, unknown>[],
      updated_at: new Date().toISOString(),
    }).eq("id", d.id);
    d.material_sources = material.sources;

    const objects = await spaceObjects(admin, d.activity_space_id);
    const materialText = targetBody
      ? `${material.text}\n\n### 更新元の定義「${targetBody.name}」\n${targetBody.body}`
      : material.text;
    state = {
      messages: [{
        role: "user",
        content: promotionOpening({
          sourceLine: material.sourceLine,
          material: materialText,
          reconcileNote,
          objects,
          candidateName: d.name,
          answeredQuestion: d.status === "awaiting_input" ? d.awaiting_question : null,
          lastFailure: d.failure_class && d.rehearsal_report
            ? summarizeRehearsalReport(readRehearsalReport(d.rehearsal_report), d.failure_class)
            : null,
          today: new Date().toISOString().slice(0, 10),
        }, said),
      }],
      turns: 0, nudges: 0,
    };
    await addStep(admin, run.id, "status", "昇格の起草を開始", `${agentName} / ${config.modelLabel}`);
  }
  const turnBudget = state.turns + config.maxTotalTurns;
  if (said) await addStep(admin, run.id, "message", said.split("\n")[0].slice(0, 200), said);

  const saveTranscript = async () => {
    const transcript: Transcript = { messages: state.messages, turns: state.turns, nudges: 0, revisions: 0, turnBudget, tools };
    const clean = JSON.parse(JSON.stringify(transcript).replace(/\\u0000/g, ""));
    const { error } = await admin.from("agent_runs").update({ transcript: clean }).eq("id", run.id);
    if (error) throw new Error(`経過を保存できませんでした: ${error.message}`);
  };
  await saveTranscript();

  const executeCall = async (call: ToolCall): Promise<{ content: string; is_error?: boolean }> => {
    if (call.name === PROPOSE_PACKAGE_TOOL.name) {
      const input = (call.input ?? {}) as Record<string, unknown>;
      const name = String(input.name ?? "").trim().slice(0, 120);
      const body = String(input.body ?? "");
      const b = (input.binding ?? {}) as Record<string, unknown>;
      const objectId = typeof b.objectId === "string" && b.objectId ? b.objectId : null;
      const triggerIn = (b.trigger ?? null) as Record<string, unknown> | null;
      const pkg: PromotionPackage = {
        name,
        body,
        binding: {
          objectId,
          titleTemplate: String(b.titleTemplate ?? ""),
          descriptionTemplate: String(b.descriptionTemplate ?? ""),
          trigger: triggerIn && typeof triggerIn.cron === "string" && triggerIn.cron.trim()
            ? {
              kind: "schedule",
              cron: triggerIn.cron.trim(),
              timezone: typeof triggerIn.timezone === "string" && triggerIn.timezone.trim() ? triggerIn.timezone.trim() : "Asia/Tokyo",
            }
            : null,
        },
      };
      if (!pkg.name || !pkg.body.trim()) return { content: "name と body が要ります。", is_error: true };
      if (pkg.binding.trigger && pkg.binding.trigger.cron.split(/\s+/).length !== 5) {
        return { content: "trigger.cron は 5 フィールドの cron で書いてください（例: 0 9 * * 1-5）。", is_error: true };
      }
      if (pkg.binding.objectId) {
        const objects = await spaceObjects(admin, d.activity_space_id);
        if (!objects.some((o) => o.id === pkg.binding.objectId)) {
          return { content: "binding.objectId は、この Space の Object の候補から選んでください。決められなければ null にして ask_person で聞いてください。", is_error: true };
        }
      }
      const outcome = evaluatePromotionPackage(pkg, []);
      if (outcome.errors.length) {
        await addStep(admin, run.id, "error", "候補が静的チェックに通りませんでした", outcome.errors.join("\n"));
        return { content: `静的チェックで落ちました。直して出し直してください:\n- ${outcome.errors.join("\n- ")}`, is_error: true };
      }
      // Rules 3–4, now the package has a name and a binding: a rival
      // name and a duplicate binding are shown, never silently taken.
      const [{ data: defRows }, { data: autoRows }] = await Promise.all([
        admin.from("definitions").select("id, name").eq("activity_space_id", d.activity_space_id),
        admin.from("automations").select("definition_id, object_id").eq("activity_space_id", d.activity_space_id),
      ]);
      const rec = reconcilePromotionPackage({
        pkg,
        targetDefinitionId: d.target_definition_id,
        definitions: (defRows ?? []) as { id: string; name: string }[],
        automations: ((autoRows ?? []) as { definition_id: string | null; object_id: string | null }[])
          .map((r) => ({ definitionId: r.definition_id, objectId: r.object_id })),
      });
      if (!await applyPromotionPackage(admin, d, pkg)) {
        return { content: "候補を保存できませんでした（ドラフトの状態が変わっています）。", is_error: true };
      }
      d = (await loadPromotionDraft(admin, draftId)) ?? d;
      await addStep(admin, run.id, "action", "昇格の候補を提出しました",
        `${pkg.name}\n置き場: ${pkg.binding.objectId ?? "(未定)"} / トリガ: ${pkg.binding.trigger ? `${pkg.binding.trigger.cron} (${pkg.binding.trigger.timezone})` : "なし"}`);
      const notes: string[] = [];
      if (rec.nameConflict) notes.push(`同じ名前の定義「${rec.nameConflict.name}」がすでにあります。更新として扱いたいのか、別物として名前を変えるのか、勝手に決めず人に確かめてください（審査でも表示されます）。`);
      if (rec.bindingDuplicate) notes.push("この定義と Object の組み合わせの自動化がすでにあります。二重に回らないよう、審査で人が判断します（ここにも記録しました）。");
      if (outcome.warnings.length) notes.push(`注意: ${outcome.warnings.join(" / ")}`);
      return {
        content: `候補を受け付けました。${notes.length ? `\n${notes.join("\n")}` : ""}\n検査へ進める形なら finish_promotion(outcome=ready) で終えてください。決められない点があれば ask_person で聞いてください。`,
      };
    }
    if (call.name === PROMOTE_ASK_TOOL.name) {
      const question = String(call.input.question ?? "").trim();
      if (!question) return { content: "question が要ります。", is_error: true };
      if (!await askPromotionDraft(admin, d, question)) return { content: "質問を記録できませんでした（ドラフトの状態が変わっています）。", is_error: true };
      d = (await loadPromotionDraft(admin, draftId)) ?? d;
      await addStep(admin, run.id, "status", "人に確認しています", question);
      return { content: "質問を記録しました。人に短く伝えて、このターンを終えてください。人が答えると起草が再開します。" };
    }
    if (call.name === FINISH_PROMOTION_TOOL.name) {
      const outcomeIn = String(call.input.outcome ?? "");
      const reason = String(call.input.reason ?? "").trim().slice(0, 500);
      if (outcomeIn === "ready") {
        const pkg = draftPackageOf(d);
        if (!pkg) return { content: "候補がまだ提出されていません。propose_package を先に通してください。", is_error: true };
        const connected = await connectedConnectorNames(admin, d.activity_space_id);
        const outcome = evaluatePromotionPackage(pkg, connected);
        if (outcome.errors.length) {
          await admin.from("promotion_drafts").update({ failure_class: "definition_invalid", updated_at: new Date().toISOString() }).eq("id", d.id);
          d.failure_class = "definition_invalid";
          await addStep(admin, run.id, "error", "静的チェックで落ちました", outcome.errors.join("\n"));
          return { content: `静的チェックで落ちました。分類は definition_invalid です。直して propose_package → finish_promotion をもう一度行ってください。\n- ${outcome.errors.join("\n- ")}`, is_error: true };
        }
        if (outcome.missing.length) {
          await admin.from("promotion_drafts").update({ failure_class: "connector_missing", updated_at: new Date().toISOString() }).eq("id", d.id);
          d.failure_class = "connector_missing";
          await addStep(admin, run.id, "error", "接続が足りません", outcome.missing.join("、"));
          return {
            content: `接続が足りません: ${outcome.missing.join("、")}。分類は connector_missing です。接続は人が設定 › AI › コネクタで行います（この起草からは作れません）。候補の「# 使うコネクタ」が材料の仕事で実際に使ったものだけか確かめ、要らない接続なら外して出し直してください。必要な接続なら、その旨を人に伝えて終えてください。`,
            is_error: true,
          };
        }
        const frozen = await freezePromotionPackage(admin, d, pkg);
        if (!frozen) return { content: "候補を確定できませんでした（ドラフトの状態が変わっています）。", is_error: true };
        d = frozen;
        const launched = await launchPromotionRehearsal({
          admin, userDb: a.userDb, draft: d, pkg,
          startRun: async (runId) => { await startRehearsalRun(runId, false); },
        });
        if ("error" in launched) {
          await addStep(admin, run.id, "error", "試走を開始できませんでした", launched.error);
          return { content: `試走を開始できませんでした: ${launched.error}。理由を人に伝えてください（候補は確定済みで、次に起草を動かしたときに試走から再開します）。`, is_error: true };
        }
        d = (await loadPromotionDraft(admin, draftId)) ?? d;
        finished = { kind: "rehearsal_started", reason: "試走を開始しました。終わると審査に進むか、結果を持って起草に戻ります。" };
        await addStep(admin, run.id, "status", "試走を開始しました", pkg.name);
        return { content: "試走を開始しました。何を起草し、どう確かめるか短く報告して終えてください。" };
      }
      if (outcomeIn === "failed") {
        if (!reason) return { content: "reason（理由）が要ります。", is_error: true };
        await transitionPromotionDraft(admin, d, "failed", {});
        await appendPromotionEvent(admin, d, { at: new Date().toISOString(), kind: "drafting_failed", note: reason });
        finished = { kind: "failed", reason };
        await addStep(admin, run.id, "status", "起草を諦めました", reason);
        return { content: "記録しました。理由を短く伝えて終えてください。" };
      }
      return { content: "outcome は ready / failed のいずれかです。", is_error: true };
    }
    return { content: `この起草では使えない道具です: ${call.name}`, is_error: true };
  };

  const recordUsage = async (u: ModelUsage) => {
    usage = {
      input: usage.input + (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      output: usage.output + (u.output_tokens ?? 0),
      cost: Math.round((usage.cost + costAt(config.price, u)) * 1_000_000) / 1_000_000,
    };
    await admin.from("agent_runs").update({ input_tokens: usage.input, output_tokens: usage.output, cost_usd: usage.cost }).eq("id", run.id);
  };

  const cache = { cache_control: { type: "ephemeral" as const } };
  const system = [{ type: "text" as const, text: promotionSystemPrompt(agentName), ...cache }];
  const toolParams = toolParamsFor(tools, cache, false);
  const deadline = Date.now() + SLICE_MS;
  const sliceSignal = () => AbortSignal.timeout(Math.max(deadline - Date.now(), 1));

  const outcome = await runLoop(state, {
    callModel: async (messages) => {
      // deno-lint-ignore no-explicit-any
      const res: any = await modelClient.beta.messages.create({
        model,
        max_tokens: 16000,
        system,
        // deno-lint-ignore no-explicit-any
        tools: toolParams as any,
        // deno-lint-ignore no-explicit-any
        messages: messages as any,
        output_config: { effort: "low" },
      // deno-lint-ignore no-explicit-any
      } as any, { signal: sliceSignal() });
      const blocks = (res.content ?? []) as { type: string; text?: string }[];
      const words = blocks.filter((b) => b.type === "text" && b.text?.trim()).map((b) => b.text!.trim()).join("\n\n");
      if (words && blocks.some((b) => b.type === "tool_use")) await addStep(admin, run.id, "reply", words.split("\n")[0].slice(0, 200), words);
      return { content: res.content, stop_reason: res.stop_reason, usage: res.usage };
    },
    kindOf: promotionKindOf,
    needsApproval: () => false,
    execute: (call) => executeCall(call),
    onUsage: recordUsage,
    afterTurn: () => saveTranscript(),
    budgetExceeded: () => spentBefore + usage.cost >= budget || usage.cost >= MAX_RUN_COST_USD,
    cancelled: async () => {
      const { data } = await admin.from("agent_runs").select("status").eq("id", run.id).maybeSingle();
      return data?.status === "cancelled";
    },
  }, { maxTurnsThisCall: MAX_TURNS_PER_SLICE, maxTotalTurns: turnBudget, deadline });

  await saveTranscript();
  switch (outcome.kind) {
    case "finished": {
      if (finished?.kind === "rehearsal_started") {
        await addStep(admin, run.id, "reply", outcome.finish.summary, outcome.finish.message);
        await rest(finished.reason);
        return;
      }
      if (finished) {
        await addStep(admin, run.id, "reply", outcome.finish.summary, outcome.finish.message);
        await complete(finished.reason);
        return;
      }
      await rest(outcome.finish.summary);
      await addStep(admin, run.id, "reply", outcome.finish.summary, outcome.finish.message);
      return;
    }
    case "yield": {
      const token = crypto.randomUUID();
      const { data: armed } = await admin.from("agent_runs").update({ continuation_token: token, continuation_count: run.continuation_count + 1 })
        .eq("id", run.id).eq("status", "running").select("id").maybeSingle();
      if (!armed) return;
      await fetch(`${a.supabaseUrl}/functions/v1/run-agent`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${a.jwt}` },
        body: JSON.stringify({ runId: run.id, continue: true, token }),
      }).catch(async (e) => rest("続きを開始できませんでした", errorMessage(e), "paused"));
      return;
    }
    case "approval":
      await rest("承認が要る操作は起草ではできません", "承認が要る操作は起草ではできません", "paused");
      return;
    case "limit":
      await rest("この発言への作業が上限に達しました。続けるには、もう一度話しかけてください。");
      return;
    case "budget": {
      const why = usage.cost >= MAX_RUN_COST_USD
        ? `この起草の上限（$${MAX_RUN_COST_USD}）に達しました。`
        : run.activity_space_id ? "この Space の今月の AI 予算の上限に達しました。" : "今月の AI 予算（個人）の上限に達しました。";
      await rest("予算の上限に達しました", why, "paused");
      await addStep(admin, run.id, "error", "予算の上限に達しました", why);
      return;
    }
    case "cancelled":
      await addStep(admin, run.id, "status", "停止しました");
      return;
    case "refusal":
      await rest("モデルがこの依頼を断りました", outcome.detail.slice(0, 300));
      return;
  }
}

// ── Athena's heartbeat driver: a Space's wake ─────────────────────────
// serve() claimed the run (status running) for a schedule's start, or
// for the tick's revival of a wake the platform cut off. The wake's
// three layers stay apart, here as everywhere in the design: the tick
// decided WHEN (deterministic), this driver inspects WHAT waits
// (deterministic), and only the speaking — whether a digest is worth
// sending, and how it reads — is the model's, through one internal
// tool. A wake always leaves its record: the run and its steps are the
// evidence it happened, silent or not. It takes no other action, in
// any approval mode: nobody asked it to work, so it only ever speaks.

const NOTIFY_DIGEST_TOOL: RunToolDef = {
  name: "notify_digest",
  description:
    "放置された待ちのダイジェストを、有効化したオーナーへ1件だけ通知する。items には提示された候補の signalId と見出しだけを渡す（候補に無い対象については通知できない）。" +
    "通知しない判断なら、この道具は呼ばず、理由を書いて終える。",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "ダイジェスト全体の総括（1〜2文）" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            signalId: { type: "string" },
            headline: { type: "string", description: "何が・どれだけ待っているかの短い見出し" },
          },
          required: ["signalId", "headline"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "items"],
    additionalProperties: false,
  },
};

function heartbeatSystemPrompt(agentName: string): string {
  return [
    `あなたは ${agentName}。この Space のハートビートとして起きました。`,
    "あなたの責任は1つだけです: 有効化したオーナーが見られる待ちのうち、長く放置されたものを、要るときだけ持ち上げること。",
    "- 通知しないことが既定の姿勢です。発生時の通知は既に出ていて、これは「放置」の再浮上です。本当に人の目が要るものだけを選んでください。",
    "- 確信が持てない候補は落としてください。間違って起こすより、黙る方がましです。",
    "- 通知するときは notify_digest を1回だけ呼びます。items には提示された候補の signalId と、人の言葉の短い見出しを。候補に無いものは作れません。",
    "- 通知しないときは、道具を呼ばず、理由を1〜2文で書いて終えてください。その文章が判断の記録として残ります。",
    "- あなたは実行しません。承認の代行、実行の開始や再開は、どの権限モードでもハートビートの仕事ではありません。",
  ].join("\n");
}

/** The Space's AI Worker a heartbeat speaks as: the run's own Worker
 *  when the tick named one, else the Space's in-Alcon worker (the
 *  automations selection: an active AI worker not handed to Claude
 *  Code, "Claude" preferred). Null runs as the default agent. */
async function loadHeartbeatWorker(admin: SupabaseClient, run: Run): Promise<WorkerConfigRow | null> {
  if (run.worker_id) {
    const { data } = await admin.from("workers").select("name, ai_config, ai_model").eq("id", run.worker_id).maybeSingle();
    if (data) return data as WorkerConfigRow;
  }
  if (!run.activity_space_id) return null;
  const { data } = await admin.from("workers").select("name, ai_config, ai_model")
    .eq("activity_space_id", run.activity_space_id).eq("type", "ai_agent").eq("status", "active");
  const inAlcon = ((data ?? []) as WorkerConfigRow[])
    .filter((w) => (w.ai_config as Record<string, unknown> | null)?.runner !== "claude-code");
  return inAlcon.find((w) => w.name === "Claude") ?? inAlcon[0] ?? null;
}

/**
 * The waits, read as the enabling owner (their RLS is the wake's field
 * of view: a wait they cannot see is not theirs to be told about).
 * Each source is read on its own; one source failing empties only
 * itself, never the inspection.
 */
async function readHeartbeatSignals(userDb: SupabaseClient, spaceId: string): Promise<HeartbeatSignal[]> {
  const signals: HeartbeatSignal[] = [];
  const guard = async <T,>(read: PromiseLike<{ data: T | null }>, fallback: T): Promise<T> => {
    try { return (await read).data ?? fallback; } catch { return fallback; }
  };

  // Element titles for the run- and action-shaped waits, in one batch.
  const titleOf = async (elementIds: (string | null)[]): Promise<Map<string, string>> => {
    const ids = [...new Set(elementIds.filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    const rows = await guard(userDb.from("elements").select("id, title").in("id", ids), [] as { id: string; title: string }[]);
    return new Map(rows.map((e) => [e.id, e.title]));
  };

  // ── Approvals waiting (Element's, and the Copilot's expiring ones) ──
  const actions = await guard(
    userDb.from("agent_actions").select("id, element_id, summary, created_at, expires_at")
      .eq("status", "pending").order("created_at", { ascending: true }).limit(40),
    [] as { id: string; element_id: string | null; summary: string; created_at: string; expires_at: string | null }[],
  );
  const actionTitles = await titleOf(actions.map((x) => x.element_id));
  for (const x of actions) {
    const label = (x.element_id ? actionTitles.get(x.element_id) : null) ?? x.summary;
    if (x.expires_at) {
      signals.push({ kind: "approval_copilot", id: x.id, since: x.created_at, expiresAt: x.expires_at, label, place: "Copilot の会話で判断できます" });
    } else {
      signals.push({ kind: "approval_element", id: x.id, since: x.created_at, label, place: "Element で判断できます" });
    }
  }

  // ── Runs waiting: for an answer, for review, on their readings,
  //    stopped on an error, or failed ──
  const runs = await guard(
    userDb.from("agent_runs").select("id, status, element_id, summary, proposed_readings, updated_at, finished_at")
      .eq("activity_space_id", spaceId)
      .in("status", ["awaiting_input", "awaiting_review", "paused", "failed", "completed"])
      .order("updated_at", { ascending: true }).limit(60),
    [] as { id: string; status: string; element_id: string | null; summary: string | null; proposed_readings: unknown; updated_at: string; finished_at: string | null }[],
  );
  const runTitles = await titleOf(runs.map((r) => r.element_id));
  for (const r of runs) {
    const label = (r.element_id ? runTitles.get(r.element_id) : null) ?? r.summary ?? "実行";
    if (r.status === "awaiting_input") {
      signals.push({ kind: "run_answer", id: r.id, since: r.updated_at, version: r.updated_at, label, place: "会話で答えられます" });
    } else if (r.status === "awaiting_review") {
      signals.push({ kind: "run_review", id: r.id, since: r.updated_at, label, place: "Element の実行パネルで確認できます" });
    } else if (r.status === "paused") {
      signals.push({ kind: "run_paused", id: r.id, since: r.updated_at, version: r.updated_at, label, place: "Element の実行パネルで再開できます" });
    } else if (r.status === "failed") {
      signals.push({ kind: "run_failed", id: r.id, since: r.finished_at ?? r.updated_at, label, place: "Element の実行パネルで確認できます" });
    }
    const held = parseProposedReadings(r.proposed_readings)
      ?.some((p) => !p.applied && p.heldReason === "awaiting-acceptance");
    if (held) {
      signals.push({ kind: "readings", id: r.id, since: r.finished_at ?? r.updated_at, label, place: "Element の仕事を受け入れると反映されます" });
    }
  }

  // ── Work itself waiting for a person's review ──
  const reviewing = await guard(
    userDb.from("elements").select("id, title, updated_at, objects!inner(domains!inner(activity_space_id))")
      .eq("status", "review").eq("objects.domains.activity_space_id", spaceId)
      .order("updated_at", { ascending: true }).limit(20),
    [] as { id: string; title: string; updated_at: string }[],
  );
  for (const e of reviewing) {
    signals.push({ kind: "element_review", id: e.id, since: e.updated_at, version: e.updated_at, label: e.title, place: "Element で確認できます" });
  }

  // ── Drafted connections waiting: for review, or for an answer ──
  const drafts = await guard(
    userDb.from("integration_drafts").select("id, name, status, expires_at, updated_at")
      .eq("activity_space_id", spaceId).in("status", ["awaiting_review", "awaiting_input"])
      .order("updated_at", { ascending: true }).limit(20),
    [] as { id: string; name: string; status: string; expires_at: string | null; updated_at: string }[],
  );
  for (const d of drafts) {
    if (d.status === "awaiting_review") {
      signals.push({ kind: "draft_review", id: d.id, since: d.updated_at, version: "awaiting_review", expiresAt: d.expires_at, label: d.name, place: "接続の審査画面で判断できます" });
    } else {
      signals.push({ kind: "draft_input", id: d.id, since: d.updated_at, version: "awaiting_input", label: d.name, place: "起草の画面で答えられます" });
    }
  }

  // ── Promotion drafts waiting the same two ways (condition 5) ──
  const promotions = await guard(
    userDb.from("promotion_drafts").select("id, name, status, expires_at, updated_at")
      .eq("activity_space_id", spaceId).in("status", ["awaiting_review", "awaiting_input"])
      .order("updated_at", { ascending: true }).limit(20),
    [] as { id: string; name: string | null; status: string; expires_at: string | null; updated_at: string }[],
  );
  for (const p of promotions) {
    if (p.status === "awaiting_review") {
      signals.push({ kind: "promotion_review", id: p.id, since: p.updated_at, version: "awaiting_review", expiresAt: p.expires_at, label: p.name ?? "昇格ドラフト", place: "ハーネスの昇格ドラフトで判断できます" });
    } else {
      signals.push({ kind: "promotion_input", id: p.id, since: p.updated_at, version: "awaiting_input", label: p.name ?? "昇格ドラフト", place: "昇格の起草の画面で答えられます" });
    }
  }

  // ── Automations standing in failure ──
  const automations = await guard(
    userDb.from("automations").select("id, name, last_fired_at, updated_at")
      .eq("activity_space_id", spaceId).eq("last_status", "failed")
      .order("last_fired_at", { ascending: true }).limit(20),
    [] as { id: string; name: string; last_fired_at: string | null; updated_at: string }[],
  );
  for (const au of automations) {
    const since = au.last_fired_at ?? au.updated_at;
    signals.push({ kind: "automation_failed", id: au.id, since, version: since, label: au.name, place: "自動化の画面で確認できます" });
  }

  // ── Pending-capability rules whose command has landed ──
  // A rule waited from the day it was recorded (its `since`), so the
  // threshold reads as how long the person has waited for the
  // capability — and the fingerprint (capability:<memory id>) dedups
  // it to one telling, however it arrived: a connection test's rebuild,
  // a G4 activation, a preset update. The rules read here are this
  // Space's and the heartbeat owner's own (their session's RLS view);
  // the match itself is the shared deterministic one.
  const pendingRules = await guard(
    userDb.from("memories").select("id, topic_key, title, created_at, scope, activity_space_id")
      .eq("status", "active").eq("kind", "procedure").like("topic_key", "pending-capability:%")
      .order("created_at", { ascending: true }).limit(40),
    [] as { id: string; topic_key: string | null; title: string; created_at: string; scope: string; activity_space_id: string | null }[],
  );
  const spaceRules = pendingRules.filter((r) => r.scope === "personal" || r.activity_space_id === spaceId);
  if (spaceRules.length) {
    const conns = await guard(
      userDb.from("integrations").select("preset, manifest")
        .eq("activity_space_id", spaceId).in("kind", ["mcp", "http"]),
      [] as { preset: string | null; manifest: unknown }[],
    );
    const namesByPreset = new Map<string, string[]>();
    for (const c of conns) {
      if (!c.preset) continue;
      const names = parseManifest(c.manifest).manifest.commands.map((cmd) => cmd.name);
      namesByPreset.set(c.preset, [...(namesByPreset.get(c.preset) ?? []), ...names]);
    }
    for (const [preset, names] of namesByPreset) {
      for (const rule of matchPendingCapabilities(spaceRules, preset, names)) {
        signals.push({
          kind: "capability_landed", id: rule.id, since: rule.created_at,
          label: rule.title, place: "会話で効かせ始められます",
        });
      }
    }
  }

  return signals;
}

async function heartbeat(a: ExecArgs): Promise<void> {
  stepBase.delete(a.run.id);
  stepNext.delete(a.run.id);
  const { run, admin, userDb, user } = a;
  const spaceId = run.activity_space_id;
  const complete = async (summary: string) => {
    await admin.from("agent_runs").update({
      status: "completed", summary: summary.slice(0, 300), error: null,
      finished_at: new Date().toISOString(), continuation_token: null,
    }).eq("id", run.id).eq("status", "running");
  };
  if (!spaceId) { await complete("通知なし"); return; } // a heartbeat run is its Space's; the row cannot exist otherwise

  const { data: spaceRow } = await admin.from("activity_spaces")
    .select("name, heartbeat_notify_after_hours, heartbeat_monthly_budget_usd")
    .eq("id", spaceId).maybeSingle();
  const thresholdHours = Number(spaceRow?.heartbeat_notify_after_hours ?? 24) || 24;
  const subCap = Number(spaceRow?.heartbeat_monthly_budget_usd ?? 2);

  // What the last completed wake told: dedup reads its digest, and a
  // wake that told nothing still carries the memory forward (the
  // fingerprints are re-derived against what is still pending).
  const { data: prevRuns } = await admin.from("agent_runs").select("transcript")
    .eq("activity_space_id", spaceId).eq("mode", "heartbeat").eq("status", "completed")
    .neq("id", run.id).order("created_at", { ascending: false }).limit(1);
  const prevFingerprints = ((prevRuns?.[0]?.transcript as Transcript | null)?.digest?.fingerprints ?? [])
    .filter((x): x is string => typeof x === "string");

  // The month's heartbeat spend against its sub-cap (the Space's whole
  // budget still stands over the wake through loadRunBudget, below).
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const { data: monthRuns } = await admin.from("agent_runs").select("cost_usd")
    .eq("activity_space_id", spaceId).eq("mode", "heartbeat")
    .gte("created_at", monthStart.toISOString()).neq("id", run.id);
  const monthSpent = ((monthRuns ?? []) as { cost_usd: number | string }[])
    .reduce((s, r) => s + Number(r.cost_usd || 0), 0);

  // ── Inspection (deterministic): the snapshot this wake judges ──────
  const now = new Date();
  const signals = await readHeartbeatSignals(userDb, spaceId);
  const snap = buildHeartbeatSnapshot(signals, { now, thresholdHours, previousFingerprints: prevFingerprints });
  const pendingFps = signals.map((s) => fingerprintOf(s));
  const byKind = new Map<string, { count: number; oldest: number }>();
  for (const p of snap.pending) {
    const cur = byKind.get(p.kind) ?? { count: 0, oldest: 0 };
    cur.count += 1; cur.oldest = Math.max(cur.oldest, p.waitedHours);
    byKind.set(p.kind, cur);
  }
  const kindLines = [...byKind.entries()].map(([kind, v]) =>
    `${HEARTBEAT_KIND_LABEL[kind as keyof typeof HEARTBEAT_KIND_LABEL]} ${v.count}件（最古 ${Math.floor(v.oldest)}時間）`);
  const inspectedTotal = snap.pending.length;
  await addStep(admin, run.id, "status",
    inspectedTotal ? `ハートビート: ${kindLines.join("、")}を確認` : "ハートビート: 待ちはありません",
    [
      inspectedTotal ? `閾値（${thresholdHours}時間）を超えた待ち: ${inspectedTotal}件` : "閾値を超えた待ちはありませんでした。",
      snap.candidates.length ? `通知の候補: ${snap.candidates.length}件` : null,
      snap.silenced ? `通知済みのため静かにする待ち: ${snap.silenced}件` : null,
    ].filter(Boolean).join("\n"));

  const saveTranscript = async (state: LoopState | null, notified: string[]) => {
    const transcript: Transcript = {
      messages: state?.messages ?? [], turns: state?.turns ?? 0, nudges: 0, revisions: 0,
      digest: { at: now.toISOString(), fingerprints: carryDigestFingerprints(prevFingerprints, pendingFps, notified) },
    };
    const clean = JSON.parse(JSON.stringify(transcript).replace(/\u0000/g, ""));
    await admin.from("agent_runs").update({ transcript: clean }).eq("id", run.id);
  };

  if (!snap.candidates.length) { await saveTranscript(null, []); await complete("通知なし"); return; }
  if (monthSpent >= subCap) {
    await addStep(admin, run.id, "status", "今月は上限のため点検のみ",
      `ハートビートの今月の費用がサブ上限（$${subCap}）に達しているため、候補 ${snap.candidates.length} 件の通知判断はしませんでした。`);
    await saveTranscript(null, []);
    await complete("点検のみ（月次上限）");
    return;
  }

  // ── Speech (the model's, and nothing else): pick from the snapshot ─
  const worker = await loadHeartbeatWorker(admin, run);
  const config = resolveAgentConfig(worker, null, null, run.model);
  const { agentName, model } = config;
  const inspectionOnly = async (reason: string) => {
    await addStep(admin, run.id, "status", "点検のみで終えます", reason);
    await saveTranscript(null, []);
    await complete("通知なし");
  };
  if (config.disabledReason) { await inspectionOnly(config.disabledReason); return; }
  if (config.providerId) {
    await inspectionOnly(`${agentName} のモデル接続先は、ハートビートの通知判断ではまだ使えません。点検のみで終えます。`);
    return;
  }
  if (!a.anthropicKey) { await inspectionOnly("ANTHROPIC_API_KEY が設定されていないため、通知判断はしませんでした。"); return; }
  const modelClient = new Anthropic({ apiKey: a.anthropicKey });
  await admin.from("agent_runs").update({ model }).eq("id", run.id);

  const { budget, spentBefore } = await loadRunBudget(admin, run, user.id);
  let usage = { input: run.input_tokens, output: run.output_tokens, cost: Number(run.cost_usd || 0) };
  const recordUsage = async (u: ModelUsage) => {
    usage = {
      input: usage.input + (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      output: usage.output + (u.output_tokens ?? 0),
      cost: Math.round((usage.cost + costAt(config.price, u)) * 1_000_000) / 1_000_000,
    };
    await admin.from("agent_runs").update({ input_tokens: usage.input, output_tokens: usage.output, cost_usd: usage.cost }).eq("id", run.id);
  };

  const bySignalId = new Map(snap.candidates.map((c) => [c.signalId, c]));
  let notified: string[] = [];
  const executeCall = async (call: ToolCall): Promise<{ content: string; is_error?: boolean }> => {
    if (call.name !== NOTIFY_DIGEST_TOOL.name) {
      return { content: `この wake で使える道具は notify_digest だけです: ${call.name}`, is_error: true };
    }
    if (notified.length) return { content: "この wake の通知はすでに送りました。" };
    const itemsIn = Array.isArray(call.input.items) ? call.input.items : [];
    const items = itemsIn.flatMap((x) => {
      const o = (x ?? {}) as { signalId?: unknown; headline?: unknown };
      const c = bySignalId.get(String(o.signalId ?? ""));
      return c ? [{ c, headline: String(o.headline ?? "").trim().slice(0, 200) }] : [];
    });
    if (!items.length) {
      return { content: "候補に無い signalId ばかりでした。提示された候補の id だけを使ってください。", is_error: true };
    }
    const summary = String(call.input.summary ?? "").trim().slice(0, 500);
    const title = digestTitleFor(items.map((i) => i.c));
    const lines = items.slice(0, 3).map((i) => `・${i.headline || i.c.label}（${i.c.place}）`);
    if (items.length > 3) lines.push(`ほか ${items.length - 3} 件`);
    const body = [summary, ...lines].filter(Boolean).join("\n").slice(0, 2000);
    const { error } = await admin.from("notifications").insert({
      recipient_id: run.triggered_by, actor_name: agentName, kind: "heartbeat",
      agent_run_id: run.id, title, body,
    });
    if (error) return { content: `通知を送れませんでした: ${error.message}`, is_error: true };
    notified = items.map((i) => i.c.signalId);
    await addStep(admin, run.id, "action", `ダイジェストを通知: ${items.length}件`, `${title}\n${body}`);
    return { content: `通知しました（${items.length}件）。短く終えてください。` };
  };

  const opening = [
    `【ハートビート点検 — Space「${spaceRow?.name ?? ""}」】`,
    `閾値（${thresholdHours}時間）を超えて放置されている待ちが ${snap.candidates.length} 件あります。通知するか、しないかを判断してください。`,
    "",
    ...snap.candidates.map((c) => `- [${c.signalId}] ${HEARTBEAT_KIND_LABEL[c.kind]}: ${c.label} — ${Math.floor(c.waitedHours)}時間待ち`
      + (c.expiryHours !== null && c.expiryHours < thresholdHours ? `（失効まで約 ${Math.max(0, Math.floor(c.expiryHours))} 時間）` : "")
      + (c.escalated ? "（一度通知済みで、さらに放置されています）" : "")
      + `。判断の場所: ${c.place}`),
  ].join("\n");
  const state: LoopState = { messages: [{ role: "user", content: opening }], turns: 0, nudges: 0, revisions: 0 };
  const cache = { cache_control: { type: "ephemeral" as const } };
  const system = [{ type: "text" as const, text: heartbeatSystemPrompt(agentName), ...cache }];
  const toolParams = toolParamsFor([NOTIFY_DIGEST_TOOL], cache, false);
  const deadline = Date.now() + SLICE_MS;
  const sliceSignal = () => AbortSignal.timeout(Math.max(deadline - Date.now(), 1));

  const outcome = await runLoop(state, {
    callModel: async (messages) => {
      // deno-lint-ignore no-explicit-any
      const res: any = await modelClient.beta.messages.create({
        model,
        max_tokens: 4000,
        system,
        // deno-lint-ignore no-explicit-any
        tools: toolParams as any,
        // deno-lint-ignore no-explicit-any
        messages: messages as any,
        output_config: { effort: "low" },
      // deno-lint-ignore no-explicit-any
      } as any, { signal: sliceSignal() });
      const blocks = (res.content ?? []) as { type: string; text?: string }[];
      const words = blocks.filter((b) => b.type === "text" && b.text?.trim()).map((b) => b.text!.trim()).join("\n\n");
      if (words && blocks.some((b) => b.type === "tool_use")) await addStep(admin, run.id, "thought", words.split("\n")[0].slice(0, 200), words);
      return { content: res.content, stop_reason: res.stop_reason, usage: res.usage };
    },
    kindOf: () => "internal",
    needsApproval: () => false,
    execute: (call) => executeCall(call),
    onUsage: recordUsage,
    afterTurn: () => saveTranscript(state, notified),
    budgetExceeded: () => spentBefore + usage.cost >= budget
      || usage.cost >= MAX_HEARTBEAT_WAKE_COST_USD
      || monthSpent + usage.cost >= subCap,
    cancelled: async () => {
      const { data } = await admin.from("agent_runs").select("status").eq("id", run.id).maybeSingle();
      return data?.status === "cancelled";
    },
    nudge: "通知するなら notify_digest を呼んでください。しないなら、理由を書いて終えてください。",
  }, { maxTurnsThisCall: HEARTBEAT_MAX_TURNS, maxTotalTurns: HEARTBEAT_MAX_TURNS, deadline });

  await saveTranscript(state, notified);
  const toldSummary = `${notified.length}件を通知`;
  switch (outcome.kind) {
    case "finished":
      if (!notified.length && outcome.finish.message) {
        await addStep(admin, run.id, "thought", "通知しないと判断しました", outcome.finish.message.slice(0, 2000));
      }
      await complete(notified.length ? toldSummary : "通知なし");
      return;
    case "budget":
      await addStep(admin, run.id, "error", "予算の上限に達しました",
        usage.cost >= MAX_HEARTBEAT_WAKE_COST_USD
          ? `この wake の上限（$${MAX_HEARTBEAT_WAKE_COST_USD}）に達しました。`
          : "予算の上限に達したため、この wake の判断を終えます。");
      await complete(notified.length ? toldSummary : "点検のみ（月次上限）");
      return;
    case "refusal":
      await addStep(admin, run.id, "thought", "モデルが判断を断りました", outcome.detail.slice(0, 500));
      await complete(notified.length ? toldSummary : "通知なし");
      return;
    case "cancelled":
      await addStep(admin, run.id, "status", "停止しました");
      return;
    default: // yield / limit: a wake takes no continuation; it closes as it stands
      await addStep(admin, run.id, "status", "判断の上限で区切りました", "この wake は続きを持たないため、現在の状態で閉じます。次回の wake が改めて点検します。");
      await complete(notified.length ? toldSummary : "通知なし");
      return;
  }
}

// ── Athena's chat driver: a Copilot conversation on its session's run ────
// serve() claimed the run (status running) for one of three entries:
//
//   message    the person's next words — new with the unification. Their
//              view context and any files ride along; the words (files as
//              document blocks, _shared/attachments.ts) join the
//              transcript, the turn runs, and what it says is written
//              back into the kept conversation.
//   decision   the person decided on the approval the paused turn holds
//              (serve()'s pre-check verified the decision against the
//              action and the saved pending): the shared decision path
//              (decision.ts) answers the turn, and it goes on.
//   continue   a slice's self-POST continuation, token-bound.
//
// The roles are the ones fixed for the Copilot's runs: the display's
// truth is ai_sessions.messages and this driver is its only writer; the
// model's context is the run's transcript (seeded from the kept
// conversation when a session's run carries none yet); the audit trail
// is the run's steps, written as a conversation's are — the person's
// message, each tool's step, the reply, the stops. The run rests
// awaiting the next message ('awaiting_input', a conversation's word);
// a budget stop rests it 'paused', as a conversation's does. The panel's
// per-message allowance of turns is kept (24).
const CHAT_TURNS_PER_MESSAGE = 24;

async function chat(a: ExecArgs, said: string): Promise<void> {
  stepBase.delete(a.run.id);
  stepNext.delete(a.run.id);
  const { run, admin, userDb, user } = a;
  const sessionId = run.ai_session_id!;
  const bound = (type: string, title: string, detail?: string | null) => addStep(admin, run.id, type, title, detail);
  const deadline = Date.now() + SLICE_MS;
  const isMessage = a.body.message !== undefined;

  const state: LoopState = {
    messages: run.transcript?.messages ?? [],
    turns: run.transcript?.turns ?? 0,
    nudges: run.transcript?.nudges ?? 0,
    revisions: 0,
  };
  let pending = run.transcript?.pending as SavedPending | undefined;
  const hadWork = !!pending;

  // The context this turn runs under: the newest the client sent with
  // its message, else the one the transcript kept, else the run's Space.
  const context = foldCopilotContext(run.transcript?.context, a.body.context, run.activity_space_id);

  // The turn's approval mode follows the turn's context Space: the
  // snapshot serve() took is the session's own Space, but a turn held
  // under another Space's view runs under that Space's policy — and the
  // run's snapshot follows the turn, so the record names the policy the
  // latest work ran under.
  let turnMode = a.approvalMode;
  if (context.spaceId && context.spaceId !== run.activity_space_id) {
    turnMode = await loadSpaceApprovalMode(admin, context.spaceId);
    if (turnMode !== a.approvalMode) await admin.from("agent_runs").update({ approval_mode: turnMode }).eq("id", run.id);
  }

  // The turn's tools, rebuilt for this slice by the one assembly
  // (copilotTurn.ts). Each result lands on the run as a step — the
  // turn's audit trace, detail carrying the call's input and outcome
  // for the panel's live display — and collects as a tool event for
  // the kept message the turn ends in. Calls pair with their results
  // by name, earliest first, as the panel has always paired them.
  const toolEvents: PanelToolEvent[] = [];
  // Connection proposals this turn makes (propose_connection): recorded
  // as connection_request steps for the live panel, and kept with the
  // turn's message so the card renders after the panel re-opens.
  const connectProposals: { names: string[]; waitingFor: string }[] = [];
  const callInputs: { name: string; input: Record<string, unknown> }[] = [];
  let stepChain: Promise<unknown> = Promise.resolve();
  const stepLater = (type: string, title: string, detail?: string | null) => {
    stepChain = stepChain.then(() => bound(type, title, detail));
  };
  // Memory (PR3): what past work taught, relevant to where the person
  // is and what they just said. The turn's context block carries it
  // (never the cached prompt); the bodies count as uses of the run.
  const mem = await loadMemoryContext(userDb, {
    query: said,
    spaceId: context.spaceId ?? run.activity_space_id, elementId: context.elementId ?? null,
  }, admin).catch(() => null);
  if (mem) await noteMemoryUse(admin, run.id, mem.usedIds, (type, title) => bound(type, title));
  const turn: CopilotTurn = await buildCopilotTurn({
    userDb, admin, context, supabaseUrl: a.supabaseUrl, approvalMode: turnMode,
    ...(mem ? { memories: mem.text } : {}),
    actor: { agent: COPILOT_AGENT_NAME, userId: user.id },
    events: {
      onToolResult: (r) => {
        const at = callInputs.findIndex((c) => c.name === r.name);
        const call = at >= 0 ? callInputs.splice(at, 1)[0] : undefined;
        toolEvents.push({
          name: r.name,
          ...(call ? { input: call.input } : {}),
          result: r.ok
            ? { ok: true, ...(r.rows !== undefined ? { rows: r.rows } : {}) }
            : { ok: false, ...(r.error ? { error: r.error } : {}) },
        });
        if (r.connectionProposal) {
          // A proposal is recorded in the conversation's own medium — a
          // connection_request step, the shape the Strategy conversation
          // writes — not as a generic action step.
          connectProposals.push(r.connectionProposal);
          stepLater("connection_request", "接続を提案しました",
            JSON.stringify(r.connectionProposal));
          return;
        }
        stepLater(
          r.ok ? (turn.kindOf(r.name) === "write" ? "write" : "action") : "error",
          r.name,
          JSON.stringify({
            ...(call ? { input: call.input } : {}),
            ...(r.rows !== undefined ? { rows: r.rows } : {}),
            ...(r.error ? { error: r.error } : {}),
          }).slice(0, 8000),
        );
      },
    },
  });
  // This turn's tool work — the landing capture's threshold counts it.
  let toolCallsThisTurn = 0;
  const execute = async (call: ToolCall) => {
    toolCallsThisTurn += 1;
    callInputs.push({ name: call.name, input: call.input });
    const r = await turn.execute(call);
    // A recall's bodies count as uses of those memories (PR3): the
    // answer's JSON carries the ids its bodies came from.
    if (call.name === "recall_memory" && !r.is_error) {
      try {
        await noteMemoryUse(admin, run.id, usedIdsOf(JSON.parse(r.content)), (type, title) => bound(type, title));
      } catch { /* a recall's bookkeeping never breaks the turn */ }
    }
    // A promotion the person just asked for starts drafting now (PR5).
    if (call.name === "start_promotion" && !r.is_error) {
      try { startPromotionRunFromTool(a, JSON.parse(r.content)); } catch { /* starting is a courtesy; the draft's screen can start it */ }
    }
    return r;
  };
  const displaysFor = (calls: ToolCall[]) => displaysUnderMode(calls.map((c) => approvalDisplayForCall(turn.toolset?.tools ?? new Map(), c)), turnMode);

  const saveTranscript = async (p: SavedPending | undefined = pending) => {
    const transcript: Transcript = {
      messages: state.messages, turns: state.turns, nudges: state.nudges, revisions: 0,
      context,
      ...(p ? { pending: p } : {}),
    };
    const clean = JSON.parse(JSON.stringify(transcript).replace(/\\u0000/g, ""));
    const { error } = await admin.from("agent_runs").update({ transcript: clean }).eq("id", run.id);
    if (error) throw new Error(`経過を保存できませんでした: ${error.message}`);
  };

  const scheduleContinuation = async () => {
    const token = crypto.randomUUID();
    const { data: armed } = await admin.from("agent_runs").update({ continuation_token: token, continuation_count: run.continuation_count + 1 })
      .eq("id", run.id).eq("status", "running").select("id").maybeSingle();
    if (!armed) return;
    await fetch(`${a.supabaseUrl}/functions/v1/run-agent`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${a.jwt}` },
      body: JSON.stringify({ runId: run.id, continue: true, token }),
    }).catch(() => {});
  };

  /** Rests the run until its person's next word or decision. */
  const rest = async (status: "awaiting_input" | "paused", summary: string, error: string | null = null) => {
    await admin.from("agent_runs").update({ status, summary: summary.slice(0, 300), error, continuation_token: null })
      .eq("id", run.id).eq("status", "running");
  };
  const pause = (summary: string) => rest("paused", summary);

  // A claim with nothing to answer (a stale decision): the unanswered
  // proposal goes back to waiting, as in execute(). A message waits
  // behind it — the claim's discipline puts the approval first.
  if (pending && !pending.approved && !a.body.decision) {
    await restorePendingApproval({
      admin, runId: run.id, elementId: null, pending,
      displays: displaysFor(pending.calls),
      integrationId: turn.toolset?.tools.get(pending.calls[0].name)?.integration.id ?? null,
      expiresAt: copilotApprovalExpiresAt(new Date()),
      sha256, addStep: bound,
    });
    return;
  }

  // The pending's action row, for settling its card afterwards: a fresh
  // decision names it, a batch continuation finds it by its first call.
  let pendingActionId: string | null = a.body.decision?.actionId ?? null;
  const decidedCalls = pending?.calls ?? [];
  if (pending && !pendingActionId) {
    const { data: act } = await admin.from("agent_actions").select("id")
      .eq("run_id", run.id).eq("tool_use_id", pending.calls[0].id).maybeSingle();
    pendingActionId = (act?.id as string | undefined) ?? null;
  }

  const rememberApproval = makeRememberApproval({ userDb, tools: turn.toolset?.tools ?? new Map(), addStep: bound });
  const decisionOutcome = await applyDecision(state, pending, a.body.decision, {
    admin, runId: run.id, userId: user.id, addStep: bound,
    saveTranscript, executeApproved: execute,
    // Under the ask mode nothing is rememberable, as in an Element's run.
    rememberApproval: turnMode === "ask" ? undefined : rememberApproval, scheduleContinuation, deadline,
  });
  if (decisionOutcome.continued) return;
  pending = decisionOutcome.pending;
  const decided = decisionOutcome.decided;

  // The decided card settles in the kept conversation before the turn goes
  // on: its status, and what each of its calls answered.
  if (decided && pendingActionId) {
    const results = decided.results.map((r) => {
      const call = decidedCalls.find((c) => c.id === r.tool_use_id);
      return { name: call?.name ?? "tool", ok: !r.is_error, content: r.content.slice(0, 300) };
    });
    const status = !decided.approved ? "denied"
      : decided.results.length > 0 && decided.results.every((r) => r.is_error) ? "failed" : "executed";
    await updateCopilotSessionMessages(admin, sessionId, (messages) =>
      withApprovalDecision(messages, pendingActionId!, { status, results }));
  }

  // ── The message entry: the person's words join the turn ───────────────
  if (isMessage) {
    // A session whose run carries no transcript yet is seeded from the
    // kept conversation, so the model sees the talk as it stands.
    if (!state.messages.length) {
      const { data: sessionRow } = await admin.from("ai_sessions").select("messages").eq("id", sessionId).maybeSingle();
      const kept = (Array.isArray(sessionRow?.messages) ? sessionRow.messages : []) as PanelMessage[];
      state.messages = seedMessagesFromPanel(kept);
    }
    const files = (a.body.attachments ?? [])
      .map((f) => ({ name: typeof f.name === "string" ? f.name : "", mediaType: typeof f.mediaType === "string" ? f.mediaType : "" }))
      .filter((f) => f.name);
    let userContent: string | Block[];
    try {
      userContent = requestContent({ role: "user", content: said, attachments: a.body.attachments ?? [] });
    } catch (e) {
      // The files cannot go to the model: the conversation hears why,
      // with the person's words kept, and the run rests for a retry.
      const reason = errorMessage(e);
      await bound("error", "添付ファイルを使えませんでした", reason);
      await updateCopilotSessionMessages(admin, sessionId, (messages) => [...messages,
        { role: "user", content: said, ...(files.length ? { attachments: files } : {}) },
        resumedAssistantMessage({ text: `添付ファイルを使えませんでした: ${reason}` })]);
      await rest("awaiting_input", "添付ファイルを使えませんでした");
      return;
    }
    state.messages.push({ role: "user", content: userContent });
    await updateCopilotSessionMessages(admin, sessionId, (messages) => [...messages,
      { role: "user", content: said, at: Date.now(), ...(files.length ? { attachments: files } : {}) }]);
    await bound("message", (said.split("\n")[0] || files[0]?.name || "（ファイル）").slice(0, 200), said || null);
    await saveTranscript();
  }

  // A claim with no turn in flight hands the run back to rest: no
  // pending to answer, no decision, no message, and no token-bound
  // continuation carrying one. The token is the evidence — a
  // continuation only exists because a slice armed it mid-turn.
  if (!hadWork && !isMessage && !a.body.continue) { await pause(run.summary ?? "承認待ち"); return; }

  const notifyDone = async (summary: string) => {
    if (!run.triggered_by || !decided || !pendingActionId) return;
    await admin.from("notifications").insert({
      recipient_id: run.triggered_by, actor_name: COPILOT_AGENT_NAME, kind: "status_change",
      agent_action_id: pendingActionId, title: "承認の続きが終わりました", body: summary.slice(0, 300),
    }).then(() => {}, () => {});
  };

  if (!a.anthropicKey) {
    // Any decision above stands; only the turn cannot run. The run
    // pauses rather than fails — failing would end the session's run
    // and strand the transcript it carries.
    const note = decided
      ? "承認の結果は記録しましたが、続きを実行できませんでした（ANTHROPIC_API_KEY が設定されていません）。"
      : "ANTHROPIC_API_KEY が設定されていないため、応答できませんでした。";
    await updateCopilotSessionMessages(admin, sessionId, (messages) => [...messages,
      resumedAssistantMessage({ text: note, toolEvents })]);
    await pause("続きを実行できませんでした");
    await notifyDone("承認の結果は記録しましたが、続きを実行できませんでした");
    return;
  }
  const modelClient = new Anthropic({ apiKey: a.anthropicKey });

  // ── Budget: the session's spend counts toward its Space's month, or
  // its person's own when the session has no Space (budget.ts). ─────────
  const { budget, spentBefore } = await loadRunBudget(admin, run, user.id);
  let usage = { input: run.input_tokens, output: run.output_tokens, cost: Number(run.cost_usd || 0) };
  const recordUsage = async (u: ModelUsage) => {
    usage = {
      input: usage.input + (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      output: usage.output + (u.output_tokens ?? 0),
      cost: Math.round((usage.cost + costOf(DEFAULT_AGENT_MODEL, u)) * 1_000_000) / 1_000_000,
    };
    await admin.from("agent_runs").update({ input_tokens: usage.input, output_tokens: usage.output, cost_usd: usage.cost }).eq("id", run.id);
  };

  const lastWords = (): string => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i];
      if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
      const text = (m.content as { type: string; text?: string }[])
        .filter((b) => b.type === "text" && b.text?.trim()).map((b) => b.text!.trim()).join("\n\n");
      if (text) return text;
    }
    return "";
  };

  // Writes full delegation lifted in this turn, collected as they run
  // and announced once when the turn's batch lands: a write that would
  // have asked, but didn't, leaves a step saying so (the free mode's
  // lifts leave policy approvals instead — a different record for a
  // different lift, in loopExecute below).
  const liftedDisplays: ApprovalDisplay[] = [];
  const flushLifted = async () => {
    if (!liftedDisplays.length) return;
    const batch = liftedDisplays.splice(0, liftedDisplays.length);
    const names = [...new Set(batch.map((d) => d.integration))];
    await bound("approval", `確認なしで実行（全委任）: ${approvalSummary(batch)}`,
      `${names.map((n) => `連携「${n}」`).join("、")}は全委任のため、承認を求めずに実行しました。`);
  };

  // The loop's executor: a call the free mode let through records its
  // policy approval as it runs (policyApproval.ts), settled when it
  // lands — the decision path above runs its approved calls through the
  // plain executor, a person's approval already being their record.
  const loopExecute = async (call: ToolCall) => {
    const v = turn.verdictOf(call);
    let policyActionId: string | null = null;
    if (v && v.base === "ask" && turnMode === "free") {
      const display = approvalDisplayForCall(turn.toolset?.tools ?? new Map(), call);
      const summary = approvalSummary([display]);
      policyActionId = await recordPolicyApproval(admin, {
        runId: run.id, elementId: null, call, display, mode: turnMode,
        integrationId: turn.toolset?.tools.get(call.name)?.integration.id ?? null,
      });
      await bound("approval", `ポリシー承認で実行: ${summary}`, "Space の承認モード（自由行動）により、承認を求めずに実行しました。");
      if (display.critical && run.triggered_by) {
        await admin.from("notifications").insert({
          recipient_id: run.triggered_by, actor_name: COPILOT_AGENT_NAME, kind: "status_change",
          agent_action_id: policyActionId, title: "重要な操作をポリシー承認で実行しました", body: summary,
        }).then(() => {}, () => {});
      }
    }
    if (!policyActionId && v?.final === "allow" && turn.liftOf(call) === "delegation") {
      liftedDisplays.push(approvalDisplayForCall(turn.toolset?.tools ?? new Map(), call));
    }
    const r = await execute(call);
    if (policyActionId) await settlePolicyApproval(admin, policyActionId, !r.is_error);
    return r;
  };

  const outcome = await runLoop(state, {
    // One model call, streamed: the answer grows in a draft step (S2) —
    // throttled writes the panel's live display reads — and folds into
    // the call's reply step when the call lands, so the trace keeps the
    // words, never the draft's fragments. A call that said nothing, or
    // was refused, leaves no step behind.
    callModel: async (messages) => {
      const stream = modelClient.messages.stream({
        model: DEFAULT_AGENT_MODEL,
        max_tokens: 16000,
        system: turn.system,
        // deno-lint-ignore no-explicit-any
        tools: turn.toolParams as any,
        // deno-lint-ignore no-explicit-any
        messages: messages as any,
      }, { signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1)) });
      let draftIdx: number | null = null;
      let shown = "";
      let flushedAt = 0;
      let flushedLength = 0;
      for await (const ev of stream) {
        // deno-lint-ignore no-explicit-any
        const e = ev as any;
        if (e.type !== "content_block_delta" || e.delta?.type !== "text_delta" || !e.delta.text) continue;
        shown += e.delta.text as string;
        const now = Date.now();
        if (!draftDue(flushedAt, flushedLength, now, shown.length)) continue;
        if (draftIdx === null) draftIdx = await addStep(admin, run.id, "draft", "応答を書いています", shown);
        else await updateStep(admin, run.id, draftIdx, "応答を書いています", shown);
        flushedAt = now;
        flushedLength = shown.length;
      }
      const final = await stream.finalMessage();
      const blocks = (final.content ?? []) as unknown as { type: string; text?: string }[];
      const words = blocks.filter((b) => b.type === "text" && b.text?.trim()).map((b) => b.text!.trim()).join("\n\n");
      if (draftIdx !== null) {
        if (words && final.stop_reason !== "refusal") {
          await updateStep(admin, run.id, draftIdx, words.split("\n")[0].slice(0, 200), words, "reply");
        } else await deleteStep(admin, run.id, draftIdx);
      } else if (words && final.stop_reason !== "refusal") {
        await addStep(admin, run.id, "reply", words.split("\n")[0].slice(0, 200), words);
      }
      // deno-lint-ignore no-explicit-any
      return { content: final.content as any, stop_reason: final.stop_reason, usage: final.usage };
    },
    kindOf: turn.kindOf,
    needsApproval: turn.needsApproval,
    execute: loopExecute,
    onUsage: recordUsage,
    afterTurn: async () => { await flushLifted(); await saveTranscript(); },
    budgetExceeded: () => spentBefore + usage.cost >= budget || usage.cost >= MAX_RUN_COST_USD,
    cancelled: async () => {
      const { data } = await admin.from("agent_runs").select("status").eq("id", run.id).maybeSingle();
      return data?.status === "cancelled";
    },
  }, { maxTurnsThisCall: MAX_TURNS_PER_SLICE, maxTotalTurns: state.turns + CHAT_TURNS_PER_MESSAGE, deadline });

  // The turn's tool steps all land before the run rests.
  await stepChain;
  switch (outcome.kind) {
    case "finished": {
      await flushLifted();
      await saveTranscript();
      const text = outcome.finish.message || outcome.finish.summary;
      await updateCopilotSessionMessages(admin, sessionId, (messages) => [...messages,
        resumedAssistantMessage({ text, toolEvents, connections: connectProposals })]);
      // The answer's words are already a step: the streaming call folded
      // its draft into the reply.
      await rest("awaiting_input", outcome.finish.summary);
      await notifyDone(outcome.finish.summary);
      // Memory: a landed chat turn that did real tool work is distilled,
      // with the session's own boundary as its scope (the view context
      // only links the memories to what they were about).
      if (landingWorthDistilling(toolCallsThisTurn)) {
        await captureMemories({
          admin, userId: user.id,
          scope: captureScopeOf(run.activity_space_id), spaceId: run.activity_space_id,
          material: {
            finishSummary: outcome.finish.summary, finishMessage: text,
            stepTitles: await loadStepTitles(admin, run.id),
            verdictGaps: [], integrationNames: [],
            subjectTitle: null, subjectDescription: null, personSaid: said || null,
          },
          call: { client: modelClient, model: DEFAULT_AGENT_MODEL, recordUsage },
          budgetOk: spentBefore + usage.cost < budget && usage.cost < MAX_RUN_COST_USD,
          sourceRunId: run.id, sourceSessionId: sessionId,
          links: { elementId: context.elementId ?? null, strategyId: context.strategyId ?? null },
          noteKept: async (titles) => { await bound("memory", `記憶に残しました: ${titles.join("、")}`); },
        });
      }
      return;
    }
    case "approval": {
      // The turn stops for approval: the same persistence as any run's
      // stop, and a fresh card in the kept conversation.
      await flushLifted();
      const p = outcome.pending;
      const persisted = await persistCopilotApproval({
        admin, run, pending: p, messages: state.messages, turns: state.turns, nudges: state.nudges,
        displays: displaysFor(p.calls),
        integrationId: turn.toolset?.tools.get(p.calls[0].name)?.integration.id ?? null,
      });
      await updateCopilotSessionMessages(admin, sessionId, (messages) => [...messages,
        resumedAssistantMessage({
          text: lastWords(), toolEvents, connections: connectProposals,
          approval: { calls: p.calls, inputHash: persisted.inputHash, status: "pending", runId: run.id, actionId: persisted.actionId },
        })]);
      await bound("approval", "承認待ち", persisted.summary);
      return;
    }
    case "yield":
      await saveTranscript();
      await scheduleContinuation();
      return;
    case "cancelled":
      await saveTranscript();
      await bound("status", "停止しました");
      return;
    default: {
      // limit / budget / refusal: the turn stops here; the kept
      // conversation says so, and the run rests for the next message —
      // 'paused' on a budget stop, as a conversation rests.
      await flushLifted();
      await saveTranscript();
      const note = outcome.kind === "budget" ? "予算の上限に達したため、続きは止まりました。"
        : outcome.kind === "refusal" ? "モデルがこの依頼を断ったため、続きは止まりました。"
        : "作業の上限に達したため、続きは止まりました。チャットで話しかけると続けられます。";
      await updateCopilotSessionMessages(admin, sessionId, (messages) => [...messages,
        resumedAssistantMessage({ text: note, toolEvents, connections: connectProposals })]);
      if (outcome.kind === "budget") {
        await bound("error", "予算の上限に達しました", note);
        await pause(note);
      } else {
        await rest("awaiting_input", note);
      }
      await notifyDone(note);
      return;
    }
  }
}

/** Pure. What a conversation's tool call was about, for its step. */
function conversationStepDetail(input: Record<string, unknown>): string | null {
  for (const k of ["title", "name", "description", "query", "body"]) {
    const v = input[k];
    if (typeof v === "string" && v.trim()) return v.trim().replace(/\s+/g, " ").slice(0, 300);
  }
  return null;
}

/** What a conversation starts from: the Strategy as recorded, and the Space's connections. */
async function loadConversationContext(userDb: SupabaseClient, run: Run, strategyId: string, userId: string): Promise<ConversationContext> {
  const r = await runStrategyTool(userDb, "getInitiative", { id: strategyId });
  if (!r.ok) throw new Error(`Strategy を読めませんでした: ${r.error}`);
  const d = r.data as { id: string; name: string; description: string | null; intents: { id: string; kind: string | null; title: string; status: string | null }[]; objects: { id: string; name: string }[]; childInitiativeIds: string[] };
  const [{ data: row }, { data: children }, { data: elements }, { data: integrations }, { data: allIntegrations }] = await Promise.all([
    userDb.from("strategies").select("created_by, definition_id").eq("id", strategyId).maybeSingle(),
    d.childInitiativeIds.length ? userDb.from("strategies").select("name").in("id", d.childInitiativeIds) : Promise.resolve({ data: [] }),
    d.objects.length ? userDb.from("elements").select("title, status").in("object_id", d.objects.map((o) => o.id)).is("parent_id", null).limit(300) : Promise.resolve({ data: [] }),
    run.activity_space_id
      ? userDb.from("integrations").select("name, kind, delegation").eq("activity_space_id", run.activity_space_id).eq("enabled", true).in("kind", ["mcp", "http"])
      : Promise.resolve({ data: [] }),
    // Every row, enabled or not: what the definition names but the Space
    // has not connected is computed against these (a switched-off row is
    // not a connection; neither is one whose latest test failed — its
    // sign-in is gone, so the conversation names it as a need too).
    run.activity_space_id
      ? userDb.from("integrations").select("name, preset, enabled, last_test").eq("activity_space_id", run.activity_space_id).in("kind", ["mcp", "http"])
      : Promise.resolve({ data: [] }),
  ]);
  // The harness the Strategy is worked by: its own, else the Space's
  // default. A disabled one is inert — the chain falls through to the next
  // slot, and to no harness (Alcon's built-in conversation) at the end.
  const strategyDefId = (row as { definition_id?: string | null } | null)?.definition_id ?? null;
  let defaultDefId: string | null = null;
  if (run.activity_space_id) {
    const { data: space } = await userDb.from("activity_spaces").select("default_definition_id").eq("id", run.activity_space_id).maybeSingle();
    defaultDefId = (space as { default_definition_id?: string | null } | null)?.default_definition_id ?? null;
  }
  const chainIds = [...new Set([strategyDefId, defaultDefId].filter((x): x is string => !!x))];
  let definitionId: string | null = null;
  if (chainIds.length) {
    const { data: rows } = await userDb.from("definitions").select("id, name, enabled").in("id", chainIds);
    const byId = new Map(((rows ?? []) as DefinitionCandidate[]).map((r) => [r.id, r]));
    definitionId = resolveDefinition(chainIds.map((cid) => byId.get(cid) ?? null)).id;
  }
  const { data: def } = definitionId ? await userDb.from("definitions").select("name, body").eq("id", definitionId).maybeSingle() : { data: null };
  const defRow = (def as { name: string; body: string } | null) ?? null;
  const missingConnectors = defRow
    ? missingConnectorNames(parseDefinition(defRow.body).connectors, (allIntegrations ?? []) as { name: string; preset: string | null; enabled: boolean }[])
    : [];
  // The drafts already in flight for those names (G4): the conversation
  // says where a connection stands instead of proposing it cold. Members
  // read every draft of their Space, so the caller's client sees them.
  let connectorDrafts: { name: string; status: string }[] = [];
  if (missingConnectors.length && run.activity_space_id) {
    const { data: draftRows } = await userDb.from("integration_drafts")
      .select("id, name_key, status")
      .eq("activity_space_id", run.activity_space_id)
      .in("status", [...DRAFT_OPEN_STATUSES]);
    connectorDrafts = openDraftsForNames(missingConnectors, (draftRows ?? []) as { id: string; name_key: string; status: string }[]);
  }
  return {
    strategy: {
      id: d.id, name: d.name, description: d.description, intents: d.intents, objects: d.objects,
      children: (children ?? []) as { name: string }[],
      elements: (elements ?? []) as { title: string; status: string | null }[],
    },
    canEdit: (row as { created_by?: string } | null)?.created_by === userId,
    definition: defRow,
    integrations: (integrations ?? []) as { name: string; kind: string; delegation: string }[],
    missingConnectors,
    connectorDrafts,
    today: new Date().toISOString().slice(0, 10),
  };
}

async function finishRun(a: ExecArgs, run: Run, agentName: string, finish: FinishPayload, status?: "paused", verdict?: RunVerdict | null, bound?: readonly BoundMeasure[]): Promise<boolean> {
  const { admin, userDb, user } = a;
  // A run stopped meanwhile stays stopped, and says nothing.
  const { data: live } = await admin.from("agent_runs").select("status").eq("id", run.id).maybeSingle();
  if (live?.status !== "running") return false;

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
    // Part done is a person's call — accept it, or send it back — so it lands
    // in review rather than staying "to do" where nobody would see it.
    const next = finish.outcome === "completed" ? (auto ? "done" : "review") : finish.outcome === "blocked" ? "blocked" : "review";
    if (el && next && !["done", "cancelled"].includes(el.status ?? "") && el.status !== next) {
      // The move acts on the run's bound element_id directly — no fresh
      // resolution of a string under the session's view (write-back
      // binding): the run is about this Element by construction.
      await updateElementById(userDb, run.element_id, { status: next }, { agent: `${agentName}（AI）`, userId: user.id });
      await addStep(admin, run.id, "status", next === "review" ? "Element をレビュー待ちに移動" : next === "done" ? "Element を完了に移動（自動で進める設定）" : "Element をブロック中に移動");
    }
  }

  // ── The finish's proposed readings ──────────────────────────────────────
  // Gated by the run's verdict and the Strategies' delegation
  // (readingsGate.ts): only a checked pass ever lands — now, under 'auto';
  // held for the work's acceptance, under manual review. Everything else
  // stays on the run with the reason it did not land.
  let proposals: ProposedReading[] | null = null;
  if (verdict && bound && finish.readings?.length) {
    proposals = validateProposals(finish.readings, bound);
    const decision = readingsDecision({ verdict, delegation: await elementDelegation(userDb, run.element_id), elementClosed: false });
    if (decision === "apply") {
      proposals = await applyReadings(admin, run.id, proposals, userDb, user.id);
    } else {
      const heldReason: ProposedReading["heldReason"] = decision === "hold" ? "awaiting-acceptance" : "verdict-not-pass";
      proposals = proposals.map((p) => (p.heldReason === "not-bound" ? p : { ...p, heldReason }));
    }
  }

  const runStatus = status ?? (finish.outcome === "completed" && run.mode !== "reply" && !auto ? "awaiting_review" : "completed");
  const { data: closed } = await admin.from("agent_runs").update({
    status: runStatus, summary: finish.summary, result: finish.message, finished_at: status ? null : new Date().toISOString(),
    error: status === "paused" ? finish.summary : null, continuation_token: null,
    // The verdict is sealed with the finish that stood — written here, at a
    // terminal finish only, and never updated afterwards.
    ...(verdict ? { verdict } : {}),
    ...(proposals ? { proposed_readings: proposals } : {}),
  }).eq("id", run.id).eq("status", "running").select("id").maybeSingle();
  if (!closed) return false;

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
  const readingsLine = proposals?.length ? readingsSummaryLine(proposals) : "";
  await addStep(admin, run.id, "result", finish.summary, readingsLine ? `${finish.message}\n\n${readingsLine}` : finish.message);

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
  return true;
}

/**
 * Lands a run's pending proposals on their measures, through the given
 * person's client — RLS decides, and the readings trigger records each
 * with source 'agent' and that person as its recorder. Only proposals
 * still waiting to land are attempted (at finish, the ones the gate just
 * validated; at acceptance, the ones held for it). A failure marks the
 * proposal write-failed and steps the run; it never fails the run, never
 * blocks a close, and never falls back to the service role — bypassing
 * RLS to land a Strategy's success number is precisely what the gate
 * exists to prevent.
 */
async function applyReadings(admin: SupabaseClient, runId: string, proposals: ProposedReading[], db: SupabaseClient, by: string): Promise<ProposedReading[]> {
  const now = new Date().toISOString();
  const out: ProposedReading[] = [];
  for (const p of proposals) {
    if (p.applied || (p.heldReason !== null && p.heldReason !== "awaiting-acceptance")) { out.push(p); continue; }
    const { data, error } = await db.from("intents")
      .update({ actual_value: p.value, measured_at: now })
      .eq("id", p.measureId).eq("kind", "measure")
      .setHeader("x-alcon-reading-source", "agent")
      .select("id");
    if (error || !data?.length) {
      const { data: m } = await admin.from("intents").select("title").eq("id", p.measureId).maybeSingle();
      await addStep(admin, runId, "status", `成功条件「${(m as { title?: string } | null)?.title ?? p.measureId}」の報告を記録できませんでした`, error?.message ?? null);
      out.push({ ...p, heldReason: "write-failed" });
      continue;
    }
    out.push({ ...p, applied: true, appliedAt: now, appliedBy: by, heldReason: null });
  }
  return out;
}

/**
 * A person accepted an Element's work by closing it done: the readings its
 * latest finished run held for that acceptance land now, through the
 * closer's client — the same act that accepts the work accepts its
 * numbers. Only the latest finished run's proposals can land: a re-run
 * supersedes an older run's, which stay held forever. The verdict is
 * re-read from the run's row — it cannot have changed since it was sealed.
 */
async function applyHeldReadings(a: { admin: SupabaseClient; userDb: SupabaseClient; user: { id: string } }, elementId: string): Promise<void> {
  const { admin, userDb, user } = a;
  const { data: runs } = await admin.from("agent_runs")
    .select("id, verdict, proposed_readings")
    .eq("element_id", elementId).not("finished_at", "is", null)
    .order("finished_at", { ascending: false }).limit(1);
  const latest = (runs ?? [])[0] as { id: string; verdict: unknown; proposed_readings: unknown } | undefined;
  if (!latest) return;
  const proposals = parseProposedReadings(latest.proposed_readings);
  if (!proposals?.some((p) => !p.applied && p.heldReason === "awaiting-acceptance")) return;
  const decision = readingsDecision({
    verdict: parseRunVerdict(latest.verdict), delegation: await elementDelegation(userDb, elementId), elementClosed: true,
  });
  if (decision !== "apply") return;
  const next = await applyReadings(admin, latest.id, proposals, userDb, user.id);
  await admin.from("agent_runs").update({ proposed_readings: next }).eq("id", latest.id);
}

/** The definition an Element follows: its own, else the first enabled of its
 *  Strategies'. A disabled definition is skipped as if its slot were empty;
 *  the skipped names come back so the run can say it went on without them. */
async function loadDefinition(userDb: SupabaseClient, elementId: string): Promise<{ definition: { name: string; body: string; scope: "element" | "strategy" } | null; skippedDisabled: string[] }> {
  const { data: el } = await userDb.from("elements").select("definition_id, object_id").eq("id", elementId).maybeSingle();
  const ownId = (el as { definition_id?: string | null } | null)?.definition_id ?? null;
  const candidates: (DefinitionCandidate | null)[] = [];
  if (ownId) {
    const { data: own } = await userDb.from("definitions").select("id, name, enabled").eq("id", ownId).maybeSingle();
    candidates.push((own as DefinitionCandidate | null) ?? null);
  }
  const own = candidates[0] ?? null;
  if ((!own || !own.enabled) && el?.object_id) {
    const { data: links } = await userDb.from("strategy_objects").select("strategy_id").eq("object_id", el.object_id);
    const ids = ((links ?? []) as { strategy_id: string }[]).map((l) => l.strategy_id);
    if (ids.length) {
      const { data: s } = await userDb.from("strategies").select("definition_id").in("id", ids).not("definition_id", "is", null);
      const defIds = [...new Set(((s ?? []) as { definition_id: string }[]).map((r) => r.definition_id).filter((d) => d !== ownId))];
      if (defIds.length) {
        const { data: rows } = await userDb.from("definitions").select("id, name, enabled").in("id", defIds);
        const byId = new Map(((rows ?? []) as DefinitionCandidate[]).map((r) => [r.id, r]));
        for (const defId of defIds) candidates.push(byId.get(defId) ?? null);
      }
    }
  }
  const { id, skippedDisabled } = resolveDefinition(candidates);
  if (!id) return { definition: null, skippedDisabled };
  const { data: d } = await userDb.from("definitions").select("name, body").eq("id", id).maybeSingle();
  if (!d) return { definition: null, skippedDisabled };
  return { definition: { ...(d as { name: string; body: string }), scope: id === ownId ? "element" : "strategy" }, skippedDisabled };
}

/** One measure of a Strategy an Element serves, as the readings gate and
 *  the task context need it. */
interface BoundMeasureInfo extends BoundMeasure {
  strategyName: string;
  unit: string | null;
  direction: string | null;
  targetValue: number | null;
  actualValue: number | null;
}

/** The measures a run on this Element may report readings for: those of
 *  the Strategies linked to its Object — the same set the verifier judges
 *  the finish against. */
async function loadBoundMeasures(userDb: SupabaseClient, elementId: string): Promise<BoundMeasureInfo[]> {
  const { data: el } = await userDb.from("elements").select("object_id").eq("id", elementId).maybeSingle();
  if (!el?.object_id) return [];
  const { data: links } = await userDb.from("strategy_objects").select("strategy_id").eq("object_id", el.object_id);
  const ids = [...new Set(((links ?? []) as { strategy_id: string }[]).map((l) => l.strategy_id))];
  if (!ids.length) return [];
  const [{ data: measures }, { data: strategies }] = await Promise.all([
    userDb.from("intents").select("id, title, unit, direction, target_value, actual_value, strategy_id").in("strategy_id", ids).eq("kind", "measure").is("superseded_by_intent_id", null),
    userDb.from("strategies").select("id, name").in("id", ids),
  ]);
  const nameOf = new Map(((strategies ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  return ((measures ?? []) as { id: string; title: string; unit: string | null; direction: string | null; target_value: number | null; actual_value: number | null; strategy_id: string }[])
    .map((m) => ({
      id: m.id, title: m.title, strategyId: m.strategy_id, strategyName: nameOf.get(m.strategy_id) ?? "",
      unit: m.unit, direction: m.direction, targetValue: m.target_value, actualValue: m.actual_value,
    }));
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
async function advanceFrom(a: Pick<ExecArgs, "admin" | "userDb" | "user" | "jwt" | "supabaseUrl">, doneId: string): Promise<string[]> {
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

async function loadContext(userDb: SupabaseClient, run: Run, integrations: TaskContext["integrations"], tables: string[] | null, boundMeasures: readonly BoundMeasureInfo[] = []): Promise<TaskContext> {
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
  const ctx: TaskContext = {
    mode: run.mode === "reply" ? "reply" : "execute",
    prompt: run.prompt,
    element: {
      id: el.id, display_id: el.display_id, title: el.title, description: el.description, status: el.status,
      priority: el.priority, due_date: el.due_date, labels: Array.isArray(el.labels) ? el.labels : [],
    },
    objectName: (obj.data as { name?: string } | null)?.name ?? null,
    subElements: (subs.data ?? []).map((s: { id: string; title: string; status: string | null }) => ({ id: s.id, title: s.title, done: s.status === "done" })),
    initiatives,
    measures: boundMeasures.map((m) => ({ id: m.id, title: m.title, strategyName: m.strategyName, unit: m.unit, target: m.targetValue, current: m.actualValue })),
    comments: ((comments.data ?? []) as { author_name: string | null; author_kind: string; content: string; created_at: string }[]).reverse()
      .map((c) => ({ author: c.author_name ?? "不明", kind: c.author_kind, content: c.content ?? "", at: c.created_at.slice(0, 16).replace("T", " ") })),
    previousRuns: ((runs.data ?? []) as { created_at: string; status: string; summary: string | null }[])
      .map((r) => ({ at: r.created_at.slice(0, 16).replace("T", " "), status: r.status, summary: r.summary })),
    artifacts: ((artifacts.data ?? []) as { title: string }[]).map((x) => x.title),
    upstream,
    integrations,
    tables,
    today: new Date().toISOString().slice(0, 10),
  };
  // Memory (PR3): what past work taught, relevant to this Element. Read
  // through the person's client (RLS is the scope) and funnelled
  // through loadMemoryContext, so retrieval can be switched off at
  // this one call site without touching capture. A failure here is a
  // run without memories, never a failed run.
  const mem = await loadMemoryContext(userDb, {
    query: [el.title, el.description ?? ""].join(" "),
    spaceId: run.activity_space_id, elementId: run.element_id,
  }).catch(() => null);
  if (mem) { ctx.memories = mem.text; ctx.memoryUsedIds = mem.usedIds; }
  return ctx;
}
