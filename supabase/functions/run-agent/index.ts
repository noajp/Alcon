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
import { fetchPull, githubTokens, pullUrlsIn, upsertCodeChange, withGithubToken, type GithubPull, type PullRef } from "../_shared/github.ts";
import { DRIVE_TOOLS } from "../_shared/googleDrive.ts";
import { readRecords, saveRecords, strategyOfElement, type RecordScope } from "./recordStore.ts";
import { TOOL_SEARCH, needsToolSearch, toolParamsFor, withDeferral, type RunToolDef } from "../_shared/toolLoading.ts";
import { ROUND_TOOL, approvalSummary, baseAgentTools, baseKindOf, integrationPrefix, INTEGRATION_SEPARATOR, uniqueToolName, webSteps, webTools } from "./agentTools.ts";
import {
  adoptPlannedTools, approvalDisplayForCall, bindingOf, connectorMatches, criticalOfTool, executeIntegrationTool, integrationApprovalFacts, integrationCallIsRead, lazyBinding, manifestDenyRefusal, oauthRowOpens, operationOf, planManifestTools, replayActionFor,
  type ApprovalDisplay, type IntegrationBinding, type IntegrationTool, type PlannedIntegrationTool,
} from "../_shared/integrationTools.ts";
import { loadToolPlans, planCacheState, planFingerprint, saveToolPlan } from "../_shared/integrationPlans.ts";
import { catalogDenyRefusal, catalogIndex, catalogOperation, catalogTool, decideCall, effectOfCall, isCatalogTool, mayNeedApproval, runCatalogTool } from "../_shared/catalog.ts";
import { systemPrompt, taskMessage, type TaskContext } from "./context.ts";
import { conversationKindOf, conversationOpening, conversationSystemPrompt, conversationTools, PLANNER_TOOL, START_TOOL, ANSWER_TOOL, CONNECT_TOOL, type ConversationContext } from "./conversation.ts";
import { CONNECTOR_PRESET_NAMES, foldConnectorName, missingConnectorNames } from "../_shared/connectorNeeds.ts";
import { CONNECTION_PROPOSED_REPLY, resolveConnectionProposal } from "../_shared/connectProposal.ts";
import {
  CREDENTIAL_REQUEST_STEP, createCredentialRequestsForNames, createRunnerWallCredentialRequest, createSiteReauthCredentialRequest,
  credentialRequestTitle, credentialStepDetail, normalizeSiteOrigin,
  ensureIntegrationCredentialRequest, notifyCredentialRequestOwners, type CaptureIntegrationRow,
} from "../_shared/credentialRequests.ts";
import {
  SIGN_IN_TOOL, annotateOnceUseRun, hasSignInUse, loginWallOf, onceRequestForOrigin, pairFromTakeRow, parseSitePair,
  recordSignInUse, setSiteCredentialLastTest, signInDisplayFor, signInNeedsAsk, signInOutcomeOf, signInStepTitle,
  signInTarget, siteCredentialRowForOrigin, supersedePendingSiteRequests, type SignInTarget, type SitePair,
} from "../_shared/signIn.ts";
import { matchPendingCapabilities } from "../_shared/pendingCapability.ts";
import { resolveAgentConfig, type DomainConfigRow, type WorkerConfigRow } from "./agentConfig.ts";
import { alignVerdictScoring, readVerdict, VERDICT_SCHEMA, VERIFY_SYSTEM, verifyPrompt } from "./verify.ts";
import { delegationOf, readyDownstream, type AdvanceCandidate } from "./advance.ts";
import { resolveDefinition, type DefinitionCandidate } from "../_shared/definitionResolution.ts";
import { artifactFileName, saveArtifactFile } from "./artifactFile.ts";
import { isGithubOAuthRow } from "../_shared/githubOAuth.ts";
import { offeredCommands, parseManifest, requestFor, ruleFromCalls, withRule, type Manifest } from "../_shared/connectorManifest.ts";
import {
  approvalModeOf, approvalVerdict, liftOf, verdictWithAutonomy, type ApprovalFacts, type ApprovalMode, type ApprovalVerdict,
} from "../_shared/approvalPolicy.ts";
import { grantFactFor, loadAutonomyGrantFacts, revokeAutonomyForIncident } from "../_shared/autonomy.ts";
import {
  evaluateBreakers, loadBreakerCounts, recordIntegrationCall, targetKeyOf, type BreakerTrip,
} from "../_shared/breakers.ts";
import { displaysUnderMode, recordPolicyApproval, settlePolicyApproval } from "../_shared/policyApproval.ts";
import {
  capturePlanExpected, checkPlanDrift, expectedNote, matchPlanCall, planApplyNotice, planCallKey, planHashOf,
  PLAN_TASK_NOTICE, readPlanCalls, readRunPlan, recordPlanApproval, settlePlanApproval,
  type PlanCall, type PlanExpectedEffect, type RunPlan,
} from "../_shared/planMode.ts";
import { buildRunVerdict, parseRunVerdict, type RunVerdict, type VerdictInputs } from "../_shared/runVerdict.ts";
import {
  correctionEnvelopeOf, correctionExhaustedSignals, elementInputsCanonical, formatCorrectionEnvelope,
  parseCorrectionHistory, standingSkipReason, type CorrectionEnvelope, type CorrectionSource, type ExhaustedRunFact,
} from "../_shared/correctionEnvelope.ts";
import { checkFinishClaims, finishDetailOf, normalizeClaims, normalizeUnconfirmed, type ClaimCheck } from "../_shared/finishClaims.ts";
import { emptyVerifyTally, tallyVerify, verifyDiffText, type VerifyCheck, type VerifyTally } from "../_shared/verifyReads.ts";
import { parseProposedReadings, readingsDecision, readingsSummaryLine, validateProposals, type BoundMeasure, type ProposedReading } from "../_shared/readingsGate.ts";
import { checkHarness, checkOutput, checksDue, definitionPrompt, freshnessTableOf, loopStop, parseDefinition, type ParsedDefinition } from "../_shared/definition.ts";
import { isMachineTool, isRunnerTool, machineResultText, MACHINE_TOOLS, passwordFieldOf, pickRunner, RUNNER_TOOLS, runnerOperation, runnerResultText, runnerStep, signInResultText, type RunnerRow } from "./runnerTools.ts";
import {
  DEFAULT_WORKSPACE_CAPS, machineCallKind, provisionedRunIdOf, WORKSPACE_READY_WAIT_MS, type MachineBindingFacts,
} from "../_shared/workspaces.ts";
import {
  closeRunWorkspace, ensureManagedWorkspace, loadLatestWorkspace, loadLiveWorkspace,
  markWorkspaceReady, recordStandingBinding,
} from "../_shared/workspaceLifecycle.ts";
import {
  captureCommand, changeSetSummaryText, codingFinishGaps, deliveryStepTitle, parseChangeSet,
  parseDeliveryDetail, patchArtifactTitle, resolveCodingTarget, targetRefusalText, testEvidenceOf,
  type ChangeSet, type CodingTarget, type ShellCallRecord, type TestEvidence,
} from "../_shared/codingLoop.ts";
import { deliverTreeAtShaToWorkspace, deliverTreeToWorkspace, fetchBaseSha, fetchRepoFileAtSha } from "../_shared/codingDelivery.ts";
import {
  amendCommitMessage, branchNameForRun, composeAmend, composePublish, parsePatchFiles, publishCommandKind, publishCriticalReason, publishIsCritical,
  pullRequestBody, pullRequestTitle, type PublishCommand,
} from "../_shared/codingPublish.ts";
import { parseCodingAmend, type CodingAmendBrief } from "../_shared/codingIteration.ts";
import { pullRequestCreatedOf } from "../_shared/createdEntities.ts";
import {
  runLoop, canonicalCalls, appendDecisionResults,
  type Block, type LoopState, type ToolCall, type ToolKind, type ToolResult, type FinishPayload, type Msg,
  type PendingApproval, type Verdict,
} from "../_shared/agentLoop.ts";
import {
  ensureQuestionTicket, loadQuestionTicket, loadQuestionTickets, markQuestionAnswered,
  questionShortForm, restingSummaryFor, settleRunBlockedByQuestions, ticketContextOf,
  standingAnswerMemory, validateAskInput, validateTicketAnswer, type QuestionTicketRow,
} from "../_shared/questionTickets.ts";
import { writeDurableMemory } from "../_shared/memoryTools.ts";
import { explainRunError, runErrorLine, SAME_CAUSE_QUIET_MS } from "../_shared/runErrorExplain.ts";
import {
  COMPENSATION_REASONS, compensationReportHasContent, compensationReportText,
  compensationSummaryOf, loadCompensationReport, mergeCompensationBatchOutcome,
  recordCompensationExecution, recordWriteCompensation,
  runCompensationPass, settleWriteCompensation, type CompensationPassOutcome,
  type CompensationReportData,
} from "../_shared/compensation.ts";
import {
  classifyCallFailure, classifySettledFailure, failureDetailOf, failurePolicySource,
  FAILURE_RETRYABLE_CLASSES, FAILURE_RETRY_BACKOFF_MS, POLICY_LAYER_LABEL, ESCALATE_TARGET_LABEL,
  narrowEntriesByExceptions, parseExceptionEntry,
  resolveFailurePolicy, sealFailureDetail,
  type CallFailureClass, type InstalledExceptionEntry, type ResolvedFailurePolicy,
} from "../_shared/failurePolicy.ts";
import { isFailureClass, type FailureClass } from "../_shared/definition.ts";
import { applyDecision, makeRememberApproval, restorePendingApproval, type SavedPending } from "./decision.ts";
import { buildCopilotTurn, foldCopilotContext, type CopilotContextLike, type CopilotTurn } from "../_shared/copilotTurn.ts";
import { COPILOT_AGENT_NAME, persistCopilotApproval, updateCopilotSessionMessages } from "../_shared/copilotAnchor.ts";
import {
  copilotApprovalExpiresAt, resumedAssistantMessage, seedMessagesFromPanel, stoppedAssistantMessage, toolStepDetail, withApprovalDecision,
  type PanelMessage, type PanelToolEvent,
} from "../_shared/copilotSession.ts";
import { answerAllowed, claimFor, driverForRun, entryForBody, heartbeatEntryAllowed, messageAllowed } from "./dispatch.ts";
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
import {
  DEFINITION_TEST_COLUMNS, launchDefinitionTest, parseFixture, parseTranscriptTest,
  previewDefinitionTestCapture, ReplayTransport,
  saveDefinitionTestCapture, settleDefinitionTest,
  type DefinitionTestRow, type TranscriptTestState,
} from "../_shared/definitionTests.ts";
import { draftRounds, materializeDraft, runDraftTestRound, summarizeRound } from "../_shared/draftTest.ts";
import { REGISTRY_URL, entriesOf } from "../_shared/connectorDirectory.ts";
import { draftDue } from "./draft.ts";
import {
  buildHeartbeatSnapshot, carryDigestFingerprints, digestTitleFor, fingerprintOf,
  HEARTBEAT_KIND_LABEL, type HeartbeatSignal,
} from "../_shared/heartbeatSnapshot.ts";
import { credentialAnomalySignals, type CredentialUseFact } from "../_shared/credentialAnomalies.ts";
import { calibrationCandidateSignals, type CalibrationCandidateFact } from "../_shared/verifierCalibration.ts";
import {
  CHAIN_POLICY, chainClaimMatches, chainDepthFor, chainDenyRefusal, chainFactFor, chainScopeMalformed, deriveChildScope, deriveScopeFromDefinition,
  loadDerivationIntegrations, parseChainScope, rootChainScope, strategyIdForObject, type ChainScope, type DerivationIntegration,
} from "../_shared/chainScope.ts";
import { chainClaimOf, mintChainJwt } from "../_shared/delegatedAuth.ts";
import { constraintDraftSignals, constraintOfferCandidate, constraintOfferText, definitionConstraintBlock, effectiveDefinitionText, strategyConstraintSection, type ActiveConstraintFact } from "../_shared/constraintDrafts.ts";
import { recordIntegrationAuthFailure, recordIntegrationUse } from "../_shared/credentialUseAudit.ts";
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


/** A paused turn resting on question tickets (B12): the approval
 *  pending's shape — the unanswered calls, the turn's other results —
 *  plus the ticket each call filed. The answers themselves live on
 *  the ticket rows; the transcript carries only the turn's shape. */
type SavedQuestion = PendingApproval & { tickets: { callId: string; ticketId: string }[] };

type Transcript = {
  messages: Msg[]; turns: number; nudges: number;
  /** Times the verifier sent a finish back. */
  revisions?: number;
  /** Turns the run may take in all; grows when its starter resumes it. */
  turnBudget?: number;
  /** The tool definitions frozen at the first slice, so later slices send the same prefix. */
  tools?: RunToolDef[];
  pending?: SavedPending;
  /** A question rest (B12): the ask_question calls awaiting a person's
   *  answer, rested in awaiting_input until the last of them lands. */
  question?: SavedQuestion;
  /** A chat run's kept view context: where its person was, last told. */
  context?: CopilotContextLike;
  /** A heartbeat run's digest memory: what its wake told, so the next
   *  wake does not tell it again (dedup reads the last completed
   *  wake's, in _shared/heartbeatSnapshot.ts). */
  digest?: { at: string; fingerprints: string[] };
  /** A rehearsal run's report as it accumulates (reads executed,
   *  writes planned), sealed onto the draft when the run settles. */
  rehearsal?: RehearsalReport;
  /** The corrections this run's finishes were sent back with (B3),
   *  as they were issued — carried across slices so the terminal
   *  verdict record seals the run's whole correction history, not
   *  just the last slice's. */
  corrections?: CorrectionEnvelope[];
  /** The definition a rehearsal run is trying, carried here rather
   *  than in a definitions row: nothing is born before activation. */
  rehearsalDefinition?: { name: string; body: string };
  /** A plan run's accumulating plan (B8): every intended write with its
   *  exact arguments, recorded while the run walks the work. */
  planDraft?: PlanCall[];
  /** The plan this run sealed (a plan run) — the whole ordered sequence
   *  the person is asked to approve as ONE unit, bound by its hash. */
  plan?: RunPlan;
  /** The plan this run is applying (an apply run): the approved plan,
   *  copied over on approval; consumption is marked on it as covered
   *  calls execute. */
  approvedPlan?: RunPlan;
  /** The iteration brief this run was born with (coding PR4): the
   *  PR a dev_event routed to it, written by the tick router before
   *  the drive and carried across slices like an approved plan — it
   *  decides where the tree comes from (the PR's head) and where the
   *  patch goes (an added commit on the same branch). */
  codingAmend?: CodingAmendBrief;
  /** The run's total of engine retries (B13), accumulated across
   *  slices: the settle's failure record reports the run's own count,
   *  not one slice's. */
  failureRetries?: number;
  /** A definition-test run's fixture reference (B14): the test row
   *  whose fixture this run replays. The fixture body itself is NOT
   *  carried — the server loads the row when the run executes, so a
   *  fixture deleted mid-run ends the test honestly. */
  testFixture?: { testId: string; definitionId: string };
  /** A definition-test run's replay state as it accumulates (B14):
   *  the transport's consumed seqs and divergences, restored on a
   *  continuation so consumption survives slices; `escalation` is
   *  where the run's failure would have escalated, resolved but
   *  never delivered (§6.2). */
  test?: TranscriptTestState & { escalation?: string | null };
};
type Run = {
  id: string; element_id: string; strategy_id: string | null; ai_session_id: string | null; integration_draft_id: string | null; promotion_draft_id: string | null; domain_id: string | null; worker_id: string | null; status: string;
  mode: string; prompt: string | null; reply_to: string | null; triggered_by: string | null;
  /** A run trying a definition with its writes blocked (the rehearsal substrate). */
  rehearsal: boolean;
  /** A plan run (B8): writes recorded as a plan instead of executed. */
  plan_mode: boolean;
  transcript: Transcript | null; step_count: number; model: string | null;
  input_tokens: number; output_tokens: number; cost_usd: number; activity_space_id: string | null;
  continuation_count: number; continuation_token: string | null;
  /** The approval mode this run started under, snapshotted by serve(); null until first driven. */
  approval_mode: string | null;
  /** The chain scope minted at this run's birth (B10): the row is the
   *  truth the gate enforces from; null/absent is an unscoped root.
   *  Read as unknown jsonb and parsed by chainScope.parseChainScope —
   *  a deploy ahead of the migration simply finds the key absent. */
  chain_scope?: unknown;
};

// IntegrationTool and ApprovalDisplay live in _shared/integrationTools.ts,
// with the manifest→tool planning, the approval facts and the executor every
// caller shares (run-agent and alcon-copilot alike).

/** An integration this run cannot use, told to the agent with the reason. */
function downIntegration(name: string, reason: string): TaskContext["integrations"][number] {
  return { name, kind: "使えない", delegation: "", tools: 0, down: reason };
}

/** Preset display names (web/src/AIP/connectors/catalog.ts): a harness may name a connector by any of them. */
// Connector-name matching itself lives in _shared/integrationTools.ts
// (connectorMatches) — the assembly below and B10's scope derivation
// share the one rule, so what is offered and what a chain may touch
// are computed from the same names.

/** A Space's approval mode, read with the service role: policy comes from
 *  the Space's row, never from the request or the model. An unreadable or
 *  unknown value is "auto" — the mode that changes nothing. */
async function loadSpaceApprovalMode(admin: SupabaseClient, spaceId: string): Promise<ApprovalMode> {
  const { data } = await admin.from("activity_spaces").select("approval_mode").eq("id", spaceId).maybeSingle();
  return approvalModeOf((data as { approval_mode?: unknown } | null)?.approval_mode);
}

/**
 * The JWT a chained run is driven with (B10): a fresh chain token
 * minted from the run's ROW scope for this one drive — slices
 * outlive the carriage's 300 seconds, so every hand-off (a child's
 * first drive, a slice's continuation) mints its own. A failed mint
 * (no signing key) does NOT fall back to driving unscoped: the
 * person's own JWT drives, the failure is said out loud, and the
 * row keeps enforcing the scope at the gate — carriage is
 * best-effort, enforcement is the row.
 */
async function chainDriveJwt(userId: string, scope: ChainScope, runId: string, fallback: string): Promise<string> {
  try {
    return await mintChainJwt({ userId, scope, runId });
  } catch (e) {
    console.error("run-agent: chain JWT mint failed; driving with the person's session — the run's row still enforces its scope", errorMessage(e));
    return fallback;
  }
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
    answer?: { ticketId?: string; option?: string; text?: string; keep?: boolean };
    context?: CopilotContextLike; attachments?: Attachment[];
    definitionTest?: {
      action?: string; runId?: string; testId?: string; name?: string;
      marks?: { seq: number; keys: string[] }[]; body?: string;
    };
  };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }

  if (body.ping) {
    return json({ ok: !!anthropicKey, key_configured: !!anthropicKey, model_default: DEFAULT_AGENT_MODEL, allowed_models: Object.keys(AGENT_MODELS) });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!jwt || jwt === anonKey) return json({ error: "sign-in required" }, 401);
  const runId = body.runId;
  if (!runId && !body.advance && !body.definitionTest) return json({ error: "runId is required" }, 400);

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
    const { started } = await advanceFrom({ admin, userDb, user: { id: user.id, email: user.email ?? null }, jwt, supabaseUrl }, el.id);
    return json({ started });
  }
  // Definition tests (B14): a person's capture / launch / settle
  // actions. None of them drives the run they name — capture reads a
  // FINISHED run's record, launch creates a new run, settle closes a
  // finished test run out — so they stand beside advance, outside
  // the run-drive path and its starter-only rule: membership is the
  // shells' own check, through the caller's session (RLS).
  if (body.definitionTest) {
    if (!user) return json({ error: "session expired or invalid" }, 401);
    const dt = body.definitionTest;
    const startRun = async (id: string) => {
      await fetch(`${supabaseUrl}/functions/v1/run-agent`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ runId: id }),
      }).catch(() => {});
    };
    if (dt.action === "capturePreview" && dt.runId) {
      return json(await previewDefinitionTestCapture(admin, userDb, dt.runId));
    }
    if (dt.action === "captureSave" && dt.runId) {
      const marks = new Map<number, string[]>();
      for (const m of dt.marks ?? []) {
        if (typeof m?.seq === "number" && Array.isArray(m.keys)) {
          marks.set(m.seq, m.keys.filter((k): k is string => typeof k === "string"));
        }
      }
      return json(await saveDefinitionTestCapture(admin, userDb, {
        runId: dt.runId, name: typeof dt.name === "string" ? dt.name : "", marks, userId: user.id,
      }));
    }
    if ((dt.action === "launch" || dt.action === "settle") && dt.testId) {
      const { data: t } = await userDb.from("definition_tests")
        .select(DEFINITION_TEST_COLUMNS).eq("id", dt.testId).maybeSingle();
      if (!t) return json({ ok: false, reason: "test_not_found" });
      // The catch-up settle (promotion's pattern): whoever drives a
      // test action first closes out its finished run, so the result
      // a person sees is never stale behind a tick.
      await settleDefinitionTest(admin, t as unknown as DefinitionTestRow).catch(() => {});
      if (dt.action === "settle") return json({ ok: true, settled: true });
      return json(await launchDefinitionTest({
        admin, userDb, userId: user.id, testId: dt.testId,
        bodyOverride: typeof dt.body === "string" ? dt.body : undefined, startRun,
      }));
    }
    return json({ error: "unknown definitionTest action" }, 400);
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

  // A drive that presents a chain claim (B10) must be carrying THIS
  // run's scope: the claim names the one run it may drive and must
  // equal the row's scope in canonical form. The claim is read
  // unverified and grants nothing — a forgery can only narrow or
  // refuse its bearer — the row below is the truth the gate
  // enforces from; a drive with no claim (the person's session, the
  // tick's revival) is judged by the row alone.
  const chainClaim = chainClaimOf(jwt);
  if (chainClaim && !chainClaimMatches(chainClaim, parseChainScope(run.chain_scope), runId)) {
    return json({ error: "提示された連鎖の範囲が、この実行の範囲と一致しません。" }, 403);
  }

  // A decision is checked before the run is touched: a stale or mismatched
  // decision is refused and the run keeps waiting for the right one. The
  // calls the decision is about live in the transcript: a parked batch
  // (pending) normally — or, for a plan run (B8), the sealed plan itself,
  // whose calls' hash must equal the approval unit's input_hash.
  if (body.decision) {
    const d = body.decision;
    const { data: action } = await admin.from("agent_actions").select("id, status, input_hash").eq("id", d.actionId ?? "").eq("run_id", runId).maybeSingle();
    const plan = readRunPlan(run.transcript?.plan);
    const decidedCalls = run.transcript?.pending?.calls ?? (plan ? plan.calls.map((p) => p.call) : undefined);
    if (!action || action.status !== "pending" || !decidedCalls) return json({ error: "この承認依頼はもう処理されています。" }, 409);
    // Bound to what is about to run, not only to what the row says.
    const runningHash = await sha256(canonicalCalls(decidedCalls));
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
  // An answer is checked before the run is touched, like a decision
  // (B12): it must name a ticket of THIS run that the run is actually
  // resting on, still standing open inside its window, and the answer
  // must be one the ticket can take — a choice it offered, or the
  // person's own words. What the driver delivers is the validated
  // answer, never the raw request.
  let validatedAnswer: { ticketId: string; answer: string; keep: boolean } | null = null;
  if (entry === "answer") {
    if (!answerAllowed(driver)) return json({ error: "この実行は質問への回答を受け付けません。" }, 400);
    const ticketId = typeof body.answer?.ticketId === "string" ? body.answer.ticketId : "";
    const ticket = ticketId ? await loadQuestionTicket(admin, ticketId) : null;
    if (!ticket || ticket.run_id !== runId) return json({ error: "その質問は見つかりませんでした。" }, 404);
    if (ticket.status === "answered") return json({ error: "その質問にはすでに回答があります。" }, 409);
    if (ticket.status !== "open" || new Date(ticket.expires_at).getTime() <= Date.now()) {
      return json({ error: "その質問は期限を過ぎたため、回答は受け付けられません。" }, 409);
    }
    const resting = (run.transcript?.question?.tickets ?? []).some((t) => t.ticketId === ticket.id);
    if (!resting) return json({ error: "その質問は、この実行の現在の待ちには含まれていません。" }, 409);
    const v = validateTicketAnswer(ticket, { option: body.answer?.option, text: body.answer?.text });
    if ("error" in v) return json({ error: v.error }, 400);
    // keep: the person may hold a standing answer to this one run
    // (the Inbox's "use this answer from now on", on by default).
    validatedAnswer = { ticketId: ticket.id, answer: v.answer, keep: body.answer?.keep !== false };
  }
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
  else if (entry === "answer") claim = claim.eq("status", claimFor("answer").from[0]);
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

  const args: ExecArgs = { req, run, user: { id: user.id, email: user.email ?? null }, jwt, admin, userDb, anthropicKey: anthropicKey ?? null, body, supabaseUrl, approvalMode, answer: validatedAnswer };
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
  // Run end destroys the run's workspace (coding PR1): per-run
  // disposal is the classification's premise, so it is not left to
  // the tick's reaper alone. Best effort — a failed destroy leaves
  // the record live and the reaper retries; it never fails the run.
  await closeRunWorkspace(admin, (k) => Deno.env.get(k), run.id, "run_failed", new Date()).catch(() => false);
  if (run.triggered_by) {
    await admin.from("notifications").insert({
      recipient_id: run.triggered_by, actor_name: "Alcon Agent", kind: "status_change", element_id: run.element_id,
      title: "エージェントの実行が失敗しました", body: message.slice(0, 200),
    }).then(() => {}, () => {});
  }
}

/** An error mid-run pauses it: the transcript saved so far stays, and its starter can resume. */
async function pauseOnError(admin: SupabaseClient, run: Run, message: string) {
  // What the person reads is what happened and who can put it right
  // (runErrorExplain.ts); the provider's raw answer stays on the step.
  const why = explainRunError(message);
  const known = why.cause !== "unknown";
  await addStep(admin, run.id, "error", why.title, known ? `${why.body}\n\n${message}` : message);
  await admin.from("agent_runs").update({ status: "paused", error: runErrorLine(message), continuation_token: null })
    .eq("id", run.id).eq("status", "running");
  if (run.triggered_by) {
    // A cause that stops every run (an empty balance, a dead key) is told
    // once while its notice still sits unread, not once per paused run.
    let told = false;
    if (known) {
      const { data } = await admin.from("notifications").select("id")
        .eq("recipient_id", run.triggered_by).eq("kind", "status_change").eq("title", why.title).eq("is_read", false)
        .gte("created_at", new Date(Date.now() - SAME_CAUSE_QUIET_MS).toISOString()).limit(1);
      told = (data ?? []).length > 0;
    }
    if (!told) {
      await admin.from("notifications").insert({
        recipient_id: run.triggered_by, actor_name: "Alcon Agent", kind: "status_change", element_id: run.element_id,
        title: known ? why.title : "エージェントがエラーで一時停止しました", body: why.body.slice(0, 200),
      }).then(() => {}, () => {});
    }
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
  /** A question ticket's answer, validated by serve() before the run
   *  was claimed (the ticket is this run's, still open, and the answer
   *  is one the ticket can take): the exact words the driver delivers
   *  as the ask_question call's tool result. Null for every other entry. */
  answer: { ticketId: string; answer: string; keep: boolean } | null;
}

async function execute(a: ExecArgs): Promise<void> {
  // Another invocation may have written steps since this isolate last ran.
  stepBase.delete(a.run.id);
  stepNext.delete(a.run.id);
  const { run, admin, userDb, user } = a;

  // A decision on a sealed plan (B8) is not a loop turn: approval starts the
  // apply run, rejection ends the matter with the plan preserved. serve()
  // has already verified the decision against the plan's hash.
  if (run.plan_mode && a.body.decision && readRunPlan(run.transcript?.plan)) {
    await decidePlan(a);
    return;
  }

  // The chain this run stands in (B10), from its row — the truth,
  // whoever's JWT carried this drive here (serve() refused a chain
  // claim that disagrees with it). Null is an unscoped root: a
  // person's own start, or every run born before B10. A malformed
  // record parses to the empty scope at full depth — the run can
  // still work with its own tools, but every integration call will
  // be refused at the gate, and its first slice says so on the
  // record rather than letting the refusals speak for themselves.
  const runScope = parseChainScope(run.chain_scope);
  if (!run.transcript) {
    if (chainScopeMalformed(run.chain_scope)) {
      await addStep(admin, run.id, "error", "連鎖の範囲の記録が読めなかったため、連携の操作はすべて拒否します", "範囲は実行の行に固定されていて書き換えられないため、直せるのは人が新しく開始し直すことだけです。");
    } else if (runScope) {
      await addStep(admin, run.id, "status", `連鎖実行として開始（深さ ${runScope.depth}/${runScope.maxDepth}、起点の実行 ${runScope.rootRunId}）`, `許可された操作は連携 ${runScope.integrations.length} 件・操作 ${runScope.actions.length} 件です。`);
    }
  }

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
    ? { id: null as string | null, name: run.transcript.rehearsalDefinition.name, body: run.transcript.rehearsalDefinition.body, scope: "element" as const }
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

  // ── Definition test replay (B14) ──────────────────────────────────
  // A test run carries only the fixture's reference; the fixture
  // itself is loaded here, at execution, from its row — a fixture
  // deleted or gone unreadable since launch ends the test before it
  // starts, rather than letting the run improvise live calls. The
  // transport is rebuilt per slice and restored from the
  // transcript's test block, so consumption survives continuations.
  const testFixtureRef = run.rehearsal ? run.transcript?.testFixture : undefined;
  let testTransport: ReplayTransport | null = null;
  let testEscalation: string | null = run.transcript?.test?.escalation ?? null;
  if (testFixtureRef) {
    const { data: testRow } = await admin.from("definition_tests")
      .select(DEFINITION_TEST_COLUMNS).eq("id", testFixtureRef.testId).maybeSingle();
    const fixture = testRow ? parseFixture((testRow as unknown as DefinitionTestRow).fixture) : null;
    if (!fixture) {
      await refuse("定義テストの記録（fixture）が読めなかったため、テストを実行できません。テストを記録し直してください。");
      return;
    }
    testTransport = new ReplayTransport(fixture, parseTranscriptTest(run.transcript?.test));
  }
  const isTestRun = testTransport !== null;

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
  // Credential capture (secure-login PR2): when this run learns a
  // token connection's credential is missing or was refused — a
  // server-side fact the driver itself just observed — the need
  // becomes a capture request: a step on this run (its card), and a
  // notice to the Space's owners, who are the only people who can
  // answer it (D1). The run goes on without the tool, as it does
  // today; the ask stands where a person can act on it, and the
  // starter's Resume is the continuation (§3.6's person-pressed
  // discipline). Dedup lives in the creator: one live ask per need.
  const noteCredentialNeed = async (row: CaptureIntegrationRow, failedTest?: { ok: false; code: string }) => {
    if (!run.activity_space_id) return;
    const fact = failedTest ? { ...row, last_test: failedTest } : row;
    const got = await ensureIntegrationCredentialRequest(admin, {
      spaceId: run.activity_space_id, userId: user.id, row: fact,
      waitingFor: "実行中の作業", runId: run.id,
    }).catch(() => null);
    if (!got?.created) return;
    await addStep(admin, run.id, CREDENTIAL_REQUEST_STEP, credentialRequestTitle(row.name), credentialStepDetail(got.request, row.name));
    await notifyCredentialRequestOwners(admin, {
      spaceId: run.activity_space_id, requesterId: user.id, label: row.name, waitingFor: "実行中の作業", always: true,
    }).catch(() => 0);
  };
  if (run.activity_space_id) {
    // The credential audit's name for this run's spends (secure-login
    // PR4, §3.8): every binding this assembly creates resolves under
    // it, so the trail can say which run spent which credential.
    const auditUse = { spaceId: run.activity_space_id, runId: run.id };
    const { data: rows } = await userDb.from("integrations")
      .select("id, preset, kind, name, description, endpoint, auth_type, auth_header, delegation, enabled, manifest, guide, updated_at, secret_id, external_account, last_test")
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
        // The one matching rule (integrationTools' connectorMatches):
        // B10's scope derivation reads definitions by the same names,
        // so what is offered and what a chain may touch cannot drift.
        const hits = wantedConnectors.filter((c) => connectorMatches(row, [c]));
        if (!hits.length) continue;
        for (const h of hits) matchedConnectors.add(h);
      }
      // B10 (§5.5, politeness): a scoped run is not OFFERED what its
      // fence excludes. The gate remains the boundary — a leaked
      // offer (a cached plan, a tool named from memory) is refused
      // there — but the offer stays honest, and a fenced-off row
      // costs no binding spend (a Drive secret, an MCP session).
      if (runScope && !runScope.integrations.includes(row.id)) continue;
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
      // OAuth is a sign-in this engine can complete (oauthRowOpens, shared
      // with the chat assembly): Google's — Drive's typed rows and any
      // Google profile's manifest rows, Gmail's included — or GitHub's.
      // Any other OAuth row has no way to authenticate and stays closed.
      if (!oauthRowOpens(row)) continue;
      const prefix = integrationPrefix(row.name, row.id);
      const fingerprint = await planFingerprint(row);
      const cached = cachedPlans.get(row.id);
      try {
        if (isGoogleDriveRow(row)) {
          if (isTestRun) {
            // A definition test (B14) never resolves a real binding:
            // Drive's tools are offered unbound — the assembly attach
            // below replaces every tool with the replay transport and
            // a refusing bind — so no Vault read, no credential-use
            // record and no sign-in ask can come out of a test run.
            for (const t of DRIVE_TOOLS) {
              if (integrationDefs.length >= MAX_TOOLS) break;
              const name = uniqueToolName(`${prefix}${INTEGRATION_SEPARATOR}${t.name}`, integrationTools);
              integrationTools.set(name, {
                integration: row, secret: null, session: null, drive: true,
                remote: { name: t.name, description: t.description, inputSchema: t.input_schema, readOnly: t.readOnly },
              });
              integrationDefs.push({ name, description: `[${row.name}] ${t.description}`.slice(0, 1024), input_schema: t.input_schema });
            }
            integrationSummary.push({ name: row.name, kind: "Google Drive", delegation: row.delegation, tools: DRIVE_TOOLS.length });
            continue;
          }
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
          // Drive binds eagerly: the resolution itself is this slice's
          // spend of the credential, recorded like a binding's (PR4).
          await recordIntegrationUse(admin, { ...auditUse, integrationId: row.id });
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
            offerPlanned(adoptPlannedTools(cached.plan, integrationTools), lazyBinding(admin, row, { consumeStash: true, auditUse }));
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
              // The refresh opened an authenticated session with the
              // credential: a spend, recorded like a binding's (PR4).
              if (secret) await recordIntegrationUse(admin, { ...auditUse, integrationId: row.id });
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
                await noteCredentialNeed(row as unknown as CaptureIntegrationRow, { ok: false, code: "auth_failed" });
                await recordIntegrationAuthFailure(admin, { spaceId: auditUse.spaceId, integrationId: row.id });
              }
            }
            if (refreshed) {
              await saveToolPlan(admin, row.id, fingerprint, refreshed.planned);
              const bound = refreshed.bound;
              offerPlanned(refreshed.planned, () => bound);
            } else if (cached) {
              offerPlanned(adoptPlannedTools(cached.plan, integrationTools), lazyBinding(admin, row, { consumeStash: true, auditUse }));
            }
          }
        } else if (manifest) {
          // An API with a manifest: its declared commands, never a raw
          // request. The plan is pure, so the cache only saves the
          // planning; the secret binds when a call runs.
          const bind = lazyBinding(admin, row, { consumeStash: true, auditUse });
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
          integrationTools.set(name, { integration: row, remote: null, bind: lazyBinding(admin, row, { consumeStash: true, auditUse }) });
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
          await noteCredentialNeed(row as unknown as CaptureIntegrationRow, { ok: false, code: "auth_failed" });
          await recordIntegrationAuthFailure(admin, { spaceId: auditUse.spaceId, integrationId: row.id });
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

  // A definition test run's tools (B14 §4.1, the assembly-side second
  // defence): every integration tool is re-pointed at the replay
  // transport, and its binding is replaced with a named refusal — so
  // even a path that resolved a binding outside the executor would
  // fail loudly instead of spending a credential. The executor's own
  // replay branch (integrationTools.ts) is the seam every dispatch
  // actually crosses; this attach makes the run's whole toolset
  // replay-shaped, eagerly held secrets included.
  if (testTransport) {
    const transport = testTransport;
    const replayOnlyBinding = (): Promise<never> =>
      Promise.reject(new Error("replay-only binding: a definition test run never resolves a real binding"));
    for (const [name, it] of integrationTools) {
      integrationTools.set(name, {
        ...it, replay: transport, bind: replayOnlyBinding,
        secret: undefined, session: undefined, binding: undefined,
      });
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
  // ── The machine (coding PR1): a workspace exists only where the
  // run's definition declares one — never merely because a shell
  // runner happens to be online. The declaration (parsedAll.machine)
  // is fulfilled by exactly one binding, recorded in run_workspaces:
  // a managed sandbox the server provisioned for THIS run (per-run,
  // destroyed at run end, egress the declared list, caps enforced),
  // or — only when the definition allows a standing machine — an
  // isolated runner on the person's own infrastructure. A runner the
  // server provisioned for another run never fulfils this one.
  // The binding's facts price the machine calls in kindOf below:
  // the old blanket "a disposable machine changes nothing outside
  // itself, therefore read" holds only while the invariants do.
  const machineReq = parsedAll?.machine ?? null;
  let machine: RunnerRow | null = null;
  let machineFacts: MachineBindingFacts | null = null;
  let machineOffered = false;
  let machineWorkspace: { deadlineMs: number | null } | null = null;
  if (machineReq && run.activity_space_id && run.triggered_by) {
    const getEnv = (k: string) => Deno.env.get(k);
    const rows = (runnerRows ?? []) as RunnerRow[];
    const assetOnline = (r: RunnerRow | null | undefined): r is RunnerRow =>
      !!r && !!r.last_seen_at && Date.now() - new Date(r.last_seen_at).getTime() <= RUNNER_ONLINE_MS;
    const fetchAsset = async (id: string): Promise<RunnerRow | null> => {
      const inRows = rows.find((r) => r.id === id);
      if (inRows) return inRows;
      const { data } = await admin.from("assets").select("id, name, manifest, last_seen_at").eq("id", id).maybeSingle();
      return (data as RunnerRow | null) ?? null;
    };
    const bindMachine = (asset: RunnerRow, facts: MachineBindingFacts, deadlineMs: number | null) => {
      machine = asset;
      machineFacts = facts;
      machineOffered = true;
      machineWorkspace = { deadlineMs };
      integrationSummary.push({ name: `使い捨ての仮想マシン（${asset.name}）`, kind: "VM", delegation: "full_delegation", tools: MACHINE_TOOLS.length });
    };
    let machineHandled = false;
    try {
      const live = await loadLiveWorkspace(admin, run.id).catch(() => null);
      if (live?.cls === "managed") {
        machineHandled = true;
        machineOffered = true;
        machineWorkspace = { deadlineMs: live.deadline ? new Date(live.deadline).getTime() : null };
        const asset = live.assetId ? await fetchAsset(live.assetId).catch(() => null) : null;
        if (assetOnline(asset)) {
          const ready = live.status === "ready"
            ? live
            : await markWorkspaceReady(admin, getEnv, a.supabaseUrl, live).catch(() => live);
          bindMachine(asset, {
            cls: "managed", credentialFree: "server",
            egressDeclared: ready.egressDeclared, egressEnforced: ready.egressEnforced,
          }, machineWorkspace.deadlineMs);
        } else if (!run.transcript) {
          await addStep(admin, run.id, "status", "ワークスペースを用意しています", "定義が宣言した実行環境（使い捨ての仮想マシン）をこの実行専用に用意しています。準備ができ次第、この実行の中で使えるようになります。");
        }
      } else if (live?.cls === "standing" && live.assetId) {
        machineHandled = true;
        const asset = await fetchAsset(live.assetId).catch(() => null);
        if (assetOnline(asset) && pickRunner([asset], Date.now(), "shell")) {
          bindMachine(asset, {
            cls: "standing", credentialFree: "self-reported",
            egressDeclared: live.egressDeclared, egressEnforced: false,
          }, null);
        }
      } else if (!live) {
        // A standing machine may fulfil the requirement when the
        // definition allows one. Provisioned assets are bound to
        // their own run and are never candidates here.
        const standing = machineReq.disposal === "any"
          ? pickRunner(rows.filter((r) => !provisionedRunIdOf(r.manifest)), Date.now(), "shell")
          : null;
        if (standing) {
          machineHandled = true;
          await recordStandingBinding(admin, {
            runId: run.id, spaceId: run.activity_space_id, assetId: standing.id, requirement: machineReq,
          }).catch(() => null);
          bindMachine(standing, {
            cls: "standing", credentialFree: "self-reported",
            egressDeclared: machineReq.egress, egressEnforced: false,
          }, null);
        } else if (!run.rehearsal) {
          machineHandled = true;
          // Managed provisioning. A rehearsal never mints a real
          // sandbox: its machine calls are recorded, not run, and a
          // trial must not spend the Space's sandbox budget.
          const ensured = await ensureManagedWorkspace(admin, getEnv, {
            runId: run.id, spaceId: run.activity_space_id, starterId: run.triggered_by,
            requirement: machineReq, supabaseUrl: a.supabaseUrl, now: new Date(),
          }).catch(() => null);
          if (!ensured) {
            integrationSummary.push(downIntegration("ワークスペース", "用意に失敗したため、この実行では仮想マシンを使えません"));
          } else if (ensured.state === "not_configured") {
            integrationSummary.push(downIntegration("ワークスペース", "サーバーにワークスペースの接続設定がないため使えません"));
            if (!run.transcript) await addStep(admin, run.id, "error", "定義が宣言したワークスペースを用意できません", "ワークスペースのサービスがサーバーに設定されていないため、この実行では仮想マシンを使えません（サーバー側の設定: SPRITES_API_TOKEN）。");
          } else if (ensured.state === "runner_bundle_missing") {
            integrationSummary.push(downIntegration("ワークスペース", "ランナーの配布先がサーバーに設定されていないため使えません"));
            if (!run.transcript) await addStep(admin, run.id, "error", "定義が宣言したワークスペースを用意できません", "ランナーの配布先がサーバーに設定されていないため、この実行では仮想マシンを使えません（サーバー側の設定: WORKSPACE_RUNNER_URL）。");
          } else if (ensured.state === "refused") {
            const why = ensured.reason === "concurrency"
              ? `この Space で同時に動いているワークスペースが上限（${DEFAULT_WORKSPACE_CAPS.maxConcurrentPerSpace}）に達しているため、新しいワークスペースは用意できませんでした。`
              : `この Space の今月のワークスペース費用が上限（$${DEFAULT_WORKSPACE_CAPS.monthlySpendCapUsd}）に達しているため、新しいワークスペースは用意できませんでした。`;
            integrationSummary.push(downIntegration("ワークスペース", why));
            if (!run.transcript) await addStep(admin, run.id, "error", "定義が宣言したワークスペースを用意できません", why);
          } else if (ensured.state === "failed") {
            integrationSummary.push(downIntegration("ワークスペース", "用意に失敗したため、この実行では仮想マシンを使えません"));
            if (!run.transcript) await addStep(admin, run.id, "error", "定義が宣言したワークスペースを用意できません", `ワークスペースの用意に失敗しました（理由コード: ${ensured.code}）。`);
          } else {
            // Provisioning is under way (or was, from an earlier
            // slice): the tools join the list now — the tool list
            // freezes at this slice — and a bounded wait gives the
            // runner a chance to answer before the run goes on.
            machineOffered = true;
            machineWorkspace = { deadlineMs: ensured.record.deadline ? new Date(ensured.record.deadline).getTime() : null };
            if (!run.transcript) await addStep(admin, run.id, "status", "ワークスペースを用意しています", "定義が宣言した実行環境（使い捨ての仮想マシン）をこの実行専用に用意しています。準備ができ次第、この実行の中で使えるようになります。");
            if (ensured.record.assetId) {
              const waitUntil = Date.now() + WORKSPACE_READY_WAIT_MS;
              let asset = await fetchAsset(ensured.record.assetId).catch(() => null);
              while (!assetOnline(asset) && Date.now() < waitUntil) {
                await new Promise((r) => setTimeout(r, 3_000));
                asset = await fetchAsset(ensured.record.assetId).catch(() => null);
              }
              if (assetOnline(asset)) {
                const ready = await markWorkspaceReady(admin, getEnv, a.supabaseUrl, ensured.record).catch(() => ensured.record);
                bindMachine(asset, {
                  cls: "managed", credentialFree: "server",
                  egressDeclared: ready.egressDeclared, egressEnforced: ready.egressEnforced,
                }, machineWorkspace.deadlineMs);
              }
            }
          }
        }
      }
    } catch (e) {
      // A workspace problem never breaks the run: it goes on
      // without the machine, and the record (or its absence) says why.
      console.error("run-agent: workspace resolution failed", errorMessage(e));
      machine = null;
      machineFacts = null;
    }
    // A record left by a provisioning that failed on an earlier
    // slice: the down-note stands, no second attempt this run.
    if (!machineHandled) {
      const latest = await loadLatestWorkspace(admin, run.id).catch(() => null);
      if (latest?.status === "failed") {
        integrationSummary.push(downIntegration("ワークスペース", "用意に失敗したため、この実行では仮想マシンを使えません"));
      }
    }
  }

  // A connection's tools load when the model searches for them, once there are many.
  const liveTools: RunToolDef[] = withDeferral(
    [...baseAgentTools(), ...(parsed?.metric ? [ROUND_TOOL] : []), ...(runner ? RUNNER_TOOLS : []), ...(machineOffered ? MACHINE_TOOLS : [])],
    integrationDefs,
  );
  const tools: RunToolDef[] = run.transcript?.tools?.length ? run.transcript.tools : liveTools;
  const kindOf = (name: string): ToolKind => {
    // A sign-in submits a form with a stored credential: an effect in
    // the world, not a read. It is the one runner call the approval
    // gate may hold (D6 — the ask mode's first-ever card; the gate
    // below decides, this only lets it be asked).
    if (name === SIGN_IN_TOOL) return "write";
    // A question files a ticket and rests the run (B12): its own
    // kind, so the loop can hold the turn for the person's answer
    // rather than for an approval.
    if (name === "ask_question") return "question";
    const base = baseKindOf(name);
    // A catalog tool whose calls may wait for approval (a Strategy write) goes
    // through the approval path; needsApproval decides each call.
    if (base === "board" && mayNeedApproval("element", name)) return "write";
    if (base) return base;
    // The browser runner only reads unless its owner started it to
    // write. A machine's calls are priced from the binding's
    // invariants (workspaces.ts machineCallKind): "read" only while
    // the workspace holds no credential, its egress is the
    // definition's declared list, and it is per-run disposable (or
    // the definition waived disposal). A binding that fails one
    // makes the calls ask like writes, judged one by one by the
    // approval machinery — the classification is re-earned per
    // binding, not inherited from the tool's shape.
    if (isMachineTool(name)) return machineFacts && machineReq ? machineCallKind(machineFacts, machineReq) : "read";
    if (isRunnerTool(name)) return "read";
    return "write"; // decided per call below
  };
  // Sign-in resolutions the D6 gate made for this slice's calls,
  // keyed by call id: the card is built from the same server facts
  // the gate judged, and the executor reuses the resolution instead
  // of probing twice in one turn. A decided call arrives in a later
  // invocation with an empty map — it resolves fresh and binds to
  // the card it rode on (callSignIn).
  const signInGate = new Map<string, SignInTarget>();

  /** What the approval card is told about one call — the shared builder in
   *  _shared/integrationTools.ts, so the run's card and the panel's agree. */
  const approvalDisplayFor = (c: ToolCall): ApprovalDisplay => {
    if (c.name === SIGN_IN_TOOL) {
      const t = signInGate.get(c.id);
      if (t?.stored) {
        return signInDisplayFor(c, { origin: t.origin, username: t.stored.username, runnerName: runner?.name ?? "PC のブラウザ" });
      }
    }
    return approvalDisplayForCall(integrationTools, c);
  };

  // ── The approval mode, composed over the policy's verdicts ───────────
  // The verdict and the mode composition live in _shared/approvalPolicy.ts;
  // what is gathered here, once per call and shared by the loop's gate and
  // its executor, is the facts this run has for the call. A deny the gate
  // answered is refused by the executor wrapper below; an ask the free
  // mode lifted is recorded there as a policy approval as it runs.
  const mode = a.approvalMode;
  // Graduated autonomy (B7): the Space's standing auto grants, loaded
  // once for the run and composed into each manifest call's facts —
  // a grant can only lift the one ask approvalPolicy's grantLiftable
  // names, and an unread grant table answers empty (no grant: the
  // safe side).
  const autonomyGrants = run.activity_space_id
    ? await loadAutonomyGrantFacts(admin, run.activity_space_id)
    : new Map<string, { lane: 1 | 2; clean: number }>();
  const verdicts = new Map<string, { base: ApprovalVerdict; final: ApprovalVerdict; lift: "track-record" | null }>();
  // B10: the calls this slice's fence refused — their ids, so the
  // deny delivery answers with the fence's own wording (the chain
  // reason is the recorded one when a call is refused twice over),
  // and their count, which the verdict record seals.
  const chainDeniedCalls = new Set<string>();
  let chainDeniedCount = 0;
  const factsForCall = (call: ToolCall, opts?: { noChain?: boolean }): ApprovalFacts => {
    // Alcon's own operations: the Element entry's policy decides each call.
    if (isCatalogTool(call.name)) {
      const tool = catalogTool(call.name);
      return { catalogDecision: tool ? decideCall("element", tool, call.input) : "allow", isWrite: true, isRead: false };
    }
    // The facts are gathered by the shared adapter (_shared/integrationTools.ts).
    const it = integrationTools.get(call.name);
    const facts = integrationApprovalFacts(it, call, kindOf(call.name) === "write");
    facts.autonomyGrant = grantFactFor(autonomyGrants, it?.integration.id, it?.command?.name);
    // B10: the chain fact, composed from the run's ROW scope for
    // every integration call — this composition point is the whole
    // enforcement: approvalVerdict judges it first, and nothing
    // downstream (mode, delegation, rule, grant, plan) can lift the
    // deny it returns. The compensation pass asks for noChain
    // verdicts (see compensationDeps): an undo is the clean-up of
    // an act already inside the fence, not a new act — its command
    // may legitimately sit outside the scope its write stood in.
    if (runScope && !opts?.noChain) {
      const chainFact = chainFactFor(runScope, it, call);
      if (chainFact) {
        facts.chain = chainFact;
        if (!chainFact.inScope) chainDeniedCalls.add(call.id);
      }
    }
    return facts;
  };
  const verdictForCall = (call: ToolCall, opts?: { noChain?: boolean }): { base: ApprovalVerdict; final: ApprovalVerdict; lift: "track-record" | null } => {
    const key = opts?.noChain ? `${call.id} (compensation)` : call.id;
    let v = verdicts.get(key);
    if (!v) {
      v = verdictWithAutonomy(factsForCall(call, opts), mode);
      verdicts.set(key, v);
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

  // The run's verify accounting (B2): every read-back a declared write
  // carries is counted here as it lands — the tally the verdict record
  // seals at the finish, beside the claim accounting.
  let verifyTally: VerifyTally = emptyVerifyTally();

  // The compensation context (B9): call id → the write_compensations
  // row this call compensates. Set for the calls a compensation pass
  // or a person's batch decision drives (the pass's executeUndo wraps
  // its call; a standing compensation pending seeds it at entry), so
  // the record stage below writes those executions as the rollback's
  // own rows — a compensation never earns a compensation.
  const compensationOfCall = new Map<string, string>();

  // ── Failure policy (B13) ─────────────────────────────────────────
  // The Space's installed exception entries, read at assembly beside
  // the integrations (§5.5): the enabled installs joined to their
  // catalog items, in the catalog's order (sort, then install time),
  // each payload read through parseExceptionEntry — an unreadable
  // payload is no entry at all (fail closed; the breakage is Alcon's
  // own content, so it is logged, never stepped onto the run). The
  // definition's exceptions section narrows the consulted set here,
  // once, so everything after — the call seam's retries, the
  // compensation seam, the settle — resolves over the same set, and
  // resolution from here to the settle is pure over it.
  const failureEntries: readonly InstalledExceptionEntry[] = await (async (): Promise<InstalledExceptionEntry[]> => {
    if (!run.activity_space_id) return [];
    try {
      const { data } = await admin.from("space_exception_installs")
        .select("catalog_item_id, version, created_at, catalog_items!inner(id, name, payload, sort)")
        .eq("activity_space_id", run.activity_space_id).eq("enabled", true);
      type InstallRow = {
        catalog_item_id: string; version: number; created_at: string;
        catalog_items: { id: string; name: string; payload: unknown; sort: number };
      };
      const rows = ((data ?? []) as unknown as InstallRow[])
        .sort((x, y) => (x.catalog_items.sort - y.catalog_items.sort) || x.created_at.localeCompare(y.created_at));
      const entries: InstalledExceptionEntry[] = [];
      for (const row of rows) {
        const parsed = parseExceptionEntry(row.catalog_items.payload);
        if (!parsed) {
          console.warn(`failure policy: exception entry ${row.catalog_items.id} has an unreadable payload; treated as not installed`);
          continue;
        }
        entries.push({
          id: row.catalog_items.id, name: row.catalog_items.name, version: row.version,
          match: parsed.match, rows: parsed.rows,
        });
      }
      return narrowEntriesByExceptions(parsedAll, entries);
    } catch {
      return [];
    }
  })();
  const failureSource = failurePolicySource({ definition: parsedAll, entries: failureEntries });

  // The run's failure counts by class — the give-up judgement's
  // material (§6.2). Seeded once from the call log's settled attempts
  // (the log's rows are per attempt, so the counts are per attempt
  // too) and grown in memory as each attempt settles, so a cap the
  // definition declares is a cap on the RUN's failures, across turns
  // and slices alike.
  const failureCounts = new Map<FailureClass, number>();
  {
    try {
      const { data } = await admin.from("integration_call_log")
        .select("failure_class").eq("run_id", run.id).eq("ok", false).limit(1000);
      for (const r of (data ?? []) as { failure_class: string | null }[]) {
        if (isFailureClass(r.failure_class)) {
          failureCounts.set(r.failure_class, (failureCounts.get(r.failure_class) ?? 0) + 1);
        }
      }
    } catch { /* the counts are a judgement's material, never the run's life */ }
  }
  let giveUpFired: { failureClass: FailureClass; count: number } | null = null;
  const currentGiveUp = (): { failureClass: string; detail: string } | null => {
    if (giveUpFired) {
      return {
        failureClass: giveUpFired.failureClass,
        detail: `失敗時の扱いにより諦めました: ${giveUpFired.failureClass} の失敗が ${giveUpFired.count} 回に達しました。`,
      };
    }
    for (const [cls, count] of failureCounts) {
      if (!count) continue;
      const policy = resolveFailurePolicy({ class: cls, definition: parsedAll, entries: failureEntries });
      if (policy.giveUpAfter != null && count >= policy.giveUpAfter) {
        giveUpFired = { failureClass: cls, count };
        return {
          failureClass: cls,
          detail: `失敗時の扱いにより諦めました: ${cls} の失敗が ${count} 回に達しました（上限 ${policy.giveUpAfter} 回 — ${POLICY_LAYER_LABEL[policy.source.giveUpAfter]}）。`,
        };
      }
    }
    return null;
  };

  const callIntegration = async (call: ToolCall): Promise<{ content: string; is_error?: boolean; verify?: VerifyCheck }> => {
    const it = integrationTools.get(call.name);
    if (!it) return { content: "Unknown tool.", is_error: true };
    // The call itself is the shared executor (deny rules re-checked at the
    // moment it runs, declared commands mapped to their requests); linking
    // the GitHub pulls it opened to this run's Element stays the run's own
    // post-step.
    //
    // ── B13: the failure record, and the engine's own retry ────────
    // Each attempt is dispatched, judged and recorded on its own: the
    // call log's rows are per attempt, so a retried call costs its
    // attempts against the breaker and the give-up count too. The
    // side effects below this loop — the compensation record, the
    // verify tally, the auth handling — belong to the call's OUTCOME:
    // they run once, on the final attempt, exactly as they did when
    // one dispatch was the whole story. The retry itself is floored
    // by the engine under any declared number: reads only (a write is
    // never re-run on a guess), never the connection's refusal, never
    // a write that verifiably landed — duplicate submission is the
    // failure a retry must never cause.
    const callEffect: "read" | "write" = integrationCallIsRead(it, call) ? "read" : "write";
    const failureMatch = {
      destination: [
        it.integration.name,
        (() => { try { return new URL(it.integration.endpoint).host; } catch { return null; } })(),
        it.command ? targetKeyOf(it.command, call.input) : null,
      ],
      tool: it.command?.name ?? it.remote?.name ?? null,
    };
    let r: { text: string; isError?: boolean; verify?: VerifyCheck; thrown?: boolean; replayed?: boolean } = { text: "", isError: true, thrown: true };
    let lastClass: CallFailureClass | null = null;
    let attempts = 0;
    while (true) {
      attempts++;
      try {
        r = await executeIntegrationTool(it, call);
      } catch (e) {
        // executeIntegrationTool answers failures as results; a throw
        // is a transport-level break (a refused binding, a rejected
        // egress) — the call's own failure result, judged like any
        // other. The result the model sees loses only the "Error: "
        // prefix the throw used to add; the fact is the same.
        r = { text: errorMessage(e), isError: true, thrown: true };
      }
      lastClass = classifyCallFailure({
        effect: callEffect, isError: !!r.isError, verify: r.verify ?? null,
        text: r.text, thrown: r.thrown === true,
      });
      // The record stage (B11): every dispatched manifest-command call
      // settles one row in the circuit breaker's evidence log — reads
      // and writes, landed or failed — before any later gate reads it
      // back. Verify read-backs never pass through here (they recurse
      // inside the executor), so a declared write counts once, as
      // itself. Best effort by construction (recordIntegrationCall
      // swallows its failures): the record is evidence, not the act.
      // A replayed answer (B14) records NOTHING here: the fixture's
      // exchanges are another run's past, and counting them would
      // feed the breakers, the autonomy track records and B13's
      // classification tallies a call that never reached a service.
      if (it.command && run.activity_space_id && !r.replayed) {
        await recordIntegrationCall(admin, {
          runId: run.id, spaceId: run.activity_space_id, integrationId: it.integration.id,
          commandName: it.command.name, isWrite: it.command.effect === "write", ok: !r.isError,
          targetKey: it.command.effect === "write" ? targetKeyOf(it.command, call.input) : null,
          failureClass: lastClass,
        });
      }
      if (lastClass) failureCounts.set(lastClass, (failureCounts.get(lastClass) ?? 0) + 1);
      if (!r.isError || !lastClass) break;
      const policy = resolveFailurePolicy({
        class: lastClass, definition: parsedAll, entries: failureEntries, match: failureMatch,
      });
      const mayRetry = callEffect === "read"
        && (FAILURE_RETRYABLE_CLASSES as readonly string[]).includes(lastClass)
        && attempts - 1 < policy.retry;
      if (!mayRetry) break;
      failureRetriesTotal++;
      if (attempts === 1) {
        // One step per call that retried, not per attempt: the run
        // reads as "this call was retried", the attempts live in the
        // call log.
        await addStep(admin, run.id, "action",
          `失敗した読み取りを再試行します: ${operationOf(it, call.input)}`,
          `失敗の種類: ${lastClass} — ${POLICY_LAYER_LABEL[policy.source.retry]}の再試行（最大 ${policy.retry} 回）に従い、もう一度試します。`);
      }
      const backoff = FAILURE_RETRY_BACKOFF_MS[Math.min(attempts - 1, FAILURE_RETRY_BACKOFF_MS.length - 1)];
      await new Promise((res) => setTimeout(res, backoff));
    }
    // The compensation record (B9): a write that landed and whose
    // command declares an undo leaves its payload here, resolved
    // from this call's actual arguments and result — bound at the
    // moment of the act, so a later failure rolls back from the
    // record, never from a re-derivation. A call driven BY a
    // compensation (its id is in compensationOfCall) leaves the
    // rollback's own record instead. A payload that could not be
    // recorded is said on the run, not silenced: a write its run
    // believes rollback-able must not quietly be otherwise. A
    // replayed result (B14) records nothing either: a test run lands
    // no writes, so its compensation set is empty by construction.
    if (it.command && it.command.effect === "write" && !r.replayed) {
      const compOf = compensationOfCall.get(call.id);
      if (compOf) {
        await recordCompensationExecution(admin, {
          runId: run.id, spaceId: run.activity_space_id, elementId: run.element_id,
          integrationId: it.integration.id, commandName: it.command.name, toolUseId: call.id,
          input: call.input, targetKey: targetKeyOf(it.command, call.input), compensatesId: compOf,
          ok: !r.isError, verify: r.verify,
          reason: r.isError ? `実行エラー: ${r.text.slice(0, 200)}` : null,
        });
      } else if (!r.isError && it.command.undo) {
        const recorded = await recordWriteCompensation(admin, {
          runId: run.id, spaceId: run.activity_space_id, elementId: run.element_id,
          integrationId: it.integration.id, command: it.command, manifest: it.manifest ?? null,
          toolUseId: call.id, writeInput: call.input, resultText: r.text, verify: r.verify,
        });
        if (!recorded) {
          await addStep(admin, run.id, "error", "補償の記録を残せませんでした",
            `${it.integration.name}: ${operationOf(it, call.input)} — この書き込みは、実行が失敗しても巻き戻しできません。`);
        }
      }
    }
    if (!r.replayed && r.isError && isAuthFailure(r.text)) {
      // A credential refused at call time is the connection's state,
      // not just this call's: record it on the row (assembly does the
      // same for its own refusals) and raise the capture need from
      // that fact — later calls to this connection fail the same way
      // until a person answers the card. The creator dedups, so a
      // run full of failing calls raises one ask. A REPLAYED auth
      // failure (B14) is none of this: it is a recorded past fact
      // about the source run, not the connection's current state —
      // acting on it would raise a live password ask out of a test.
      await admin.from("integrations").update({ last_test: { ok: false, at: new Date().toISOString(), code: "auth_failed", detail: r.text.slice(0, 300) } }).eq("id", it.integration.id);
      await noteCredentialNeed(it.integration as unknown as CaptureIntegrationRow, { ok: false, code: "auth_failed" });
      if (run.activity_space_id) {
        await recordIntegrationAuthFailure(admin, { spaceId: run.activity_space_id, integrationId: it.integration.id });
      }
    }
    if (r.verify) {
      // The read-back's outcome is a first-class entry in the run's
      // trace, whatever it found — match, mismatch, or unverifiable.
      verifyTally = tallyVerify(verifyTally, r.verify);
      const op = operationOf(it, call.input);
      if (r.verify.ok) {
        await addStep(admin, run.id, "action", `読み戻し確認: ${op}`, "書き込み後の状態が意図と一致しました。");
      } else if (r.verify.unverified) {
        await addStep(admin, run.id, "action", `読み戻し確認ができませんでした: ${op}`, r.verify.unverified);
      } else {
        await addStep(admin, run.id, "action", `読み戻し確認で不一致: ${op}`, verifyDiffText(r.verify.diff ?? []));
        // Graduated autonomy (B7): the mismatch is this command's
        // first incident — its earned grant is revoked here, in the
        // same flow that records the result, so the very next call
        // asks again. (The write itself stands; B2's rule — demotion
        // is about asking again, not undoing.)
        if (it.command && run.activity_space_id) {
          await revokeAutonomyForIncident(admin, {
            spaceId: run.activity_space_id, integrationId: it.integration.id, action: it.command.name,
            kind: "verify_mismatch", runId: run.id,
          });
        }
      }
    }
    if (!r.isError && isGithubRow(it.integration) && it.remote && /^(create|update)_pull_request$/i.test(it.remote.name)) {
      // The token the call ran with: bindingOf returns the binding the
      // executor just resolved (memoized on the tool for this slice).
      const binding = await bindingOf(it).catch(() => null);
      await linkOpenedPulls(r.text, binding?.secret ?? null);
    }
    // When retries happened and the call still failed, the model is
    // told so in the result itself: it must not re-issue the same
    // call on its own loop — the engine already spent the declared
    // patience on it.
    const retriesMade = attempts - 1;
    const content = r.isError && retriesMade > 0 && lastClass
      ? `${r.text}（失敗時の扱いにより ${retriesMade} 回再試行しました: ${lastClass}）`
      : r.text;
    return { content, ...(r.isError ? { is_error: true } : {}), ...(r.verify ? { verify: r.verify } : {}) };
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

  // The coding publish's landing, recorded (coding PR3, design §8):
  // the PR the publish opened becomes a created entity on the run —
  // the step carries the extractor's record (the code_changes row
  // the call seam just linked, read back by its identity), and the
  // run's panel draws the card from it, re-reading the row live for
  // the PR's state. The link step above already named the PR; this
  // step is its card. A landing whose link could not be read back
  // still names the PR by its URL — the publish happened; only the
  // card's live read is missing, and the step says which.
  const notePublishLanded = async (resultText: string): Promise<void> => {
    const ref = pullUrlsIn(resultText)[0];
    if (!ref) {
      await addStep(admin, run.id, "error", "PR の URL を公開結果から読み取れませんでした", resultText.slice(0, 300));
      return;
    }
    let entity: ReturnType<typeof pullRequestCreatedOf>;
    if (run.element_id) {
      const { data: change } = await admin.from("code_changes")
        .select("id, title, url, repo, number, state")
        .eq("element_id", run.element_id).eq("repo", ref.repo).eq("number", ref.number).maybeSingle();
      entity = change ? pullRequestCreatedOf(change as Record<string, unknown>) : undefined;
    }
    await addStep(admin, run.id, "pull_request", `PR を開きました: ${ref.repo}#${ref.number}`,
      entity ? JSON.stringify({ created: [entity] }) : `https://github.com/${ref.repo}/pull/${ref.number}`);
  };

  // A call to the person's PC: queued for its runner, answered within a
  // minute or given up (the runner may have gone offline since). The
  // queue and the wait are separate halves because a sign-in call is
  // staged between them (its payload is armed once the call exists).
  const queueAssetCall = async (target: RunnerRow, tool: string, input: Record<string, unknown>): Promise<{ ok: true; id: string } | { ok: false; content: string }> => {
    const { data: queued, error } = await admin.from("asset_calls")
      .insert({ asset_id: target.id, run_id: run.id, tool, input }).select("id").single();
    if (error || !queued) return { ok: false, content: `PC に依頼できませんでした: ${error?.message ?? "unknown"}` };
    return { ok: true, id: queued.id as string };
  };
  const awaitAssetCall = async (id: string): Promise<{ ok: true; result: unknown } | { ok: false; content: string }> => {
    // A page takes seconds; the slice's soft deadline may be near, but an
    // answer thrown away costs the runner's work, so wait it out (within the
    // platform's wall clock, which the slice deadline leaves room under).
    const until = Date.now() + 45_000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 700));
      const { data: c } = await admin.from("asset_calls").select("status, result, error").eq("id", id).maybeSingle();
      if (c?.status === "done") return { ok: true, result: c.result };
      if (c?.status === "failed") return { ok: false, content: `PC のブラウザで失敗しました: ${c.error ?? ""}` };
    }
    await admin.from("asset_calls").update({ status: "expired", finished_at: new Date().toISOString() }).eq("id", id).in("status", ["pending", "claimed"]);
    return { ok: false, content: "PC のブラウザから時間内に答えがありませんでした（PC が眠っているか、実行役が止まっている可能性）。" };
  };

  // A login wall the runner reported in a page result becomes a
  // capture ask when the origin has neither a stored credential nor
  // a one-time stash waiting — the runner-wall seam (credentialRequests.ts)
  // judges the stored half from the row; the stash half is checked
  // here, because a person who already handed over a one-time login
  // needs no second ask. The origin is the runner's own report,
  // never the model's text. Best-effort, deduped by the creator.
  const noteSignInWall = async (result: unknown): Promise<void> => {
    if (!run.activity_space_id) return;
    const origin = loginWallOf(result);
    if (!origin) return;
    try {
      if (await onceRequestForOrigin(admin, run.activity_space_id, origin)) return;
      const got = await createRunnerWallCredentialRequest(admin, {
        spaceId: run.activity_space_id, userId: user.id, origin,
        waitingFor: "実行中の作業", runId: run.id,
      });
      if (!got?.created) return;
      await addStep(admin, run.id, CREDENTIAL_REQUEST_STEP, credentialRequestTitle(origin), credentialStepDetail(got.request, origin));
      await notifyCredentialRequestOwners(admin, {
        spaceId: run.activity_space_id, requesterId: user.id, label: origin, waitingFor: "実行中の作業", always: true,
      }).catch(() => 0);
    } catch { /* the ask is a courtesy on top of the run; never its failure */ }
  };

  const callRunner = async (call: ToolCall, target: RunnerRow | null, read: (result: unknown) => string): Promise<{ content: string; is_error?: boolean }> => {
    if (!target) return { content: "この道具の実行役は今つながっていません。ほかの道具で進めるか、つながっていないことを報告してください。", is_error: true };
    // A pc_type step is written when the call lands, not before: only
    // the runner can say whether the field it filled was a password
    // field, and a step written first would carry the typed text into
    // the record before anyone could mask it. Masked unless the
    // runner affirmatively reported an ordinary field.
    const deferStep = call.name === "pc_type";
    if (!deferStep) await addStep(admin, run.id, "action", runnerStep(call.name, call.input));
    const queued = await queueAssetCall(target, runnerOperation(call.name), call.input);
    if (!queued.ok) return { content: queued.content, is_error: true };
    const settled = await awaitAssetCall(queued.id);
    if (deferStep) {
      await addStep(admin, run.id, "action", runnerStep(call.name, call.input, settled.ok ? passwordFieldOf(settled.result) !== false : true));
    }
    if (!settled.ok) return { content: settled.content, is_error: true };
    await noteSignInWall(settled.result);
    return { content: read(settled.result) };
  };

  /**
   * A machine call, behind the workspace's wall clock. The cap is
   * the server's, not the model's: a workspace past its deadline is
   * destroyed at this seam, so a run that keeps calling cannot
   * outlive its cap even if the tick's reaper has not come around
   * yet. A standing binding has no server wall clock (its caps are
   * the person's own machine's) and passes straight through.
   */
  const callMachine = async (call: ToolCall): Promise<{ content: string; is_error?: boolean }> => {
    if (machineWorkspace?.deadlineMs != null && Date.now() > machineWorkspace.deadlineMs) {
      await closeRunWorkspace(admin, (k) => Deno.env.get(k), run.id, "wall_clock", new Date()).catch(() => false);
      machine = null;
      return { content: "ワークスペースの時間上限に達したため、この実行の仮想マシンは終了しました。残りの作業はほかの道具で進めるか、時間が足りなかったことを報告してください。", is_error: true };
    }
    return await callRunner(call, machine, machineResultText);
  };

  /**
   * Where a sign-in would land, resolved from the runner's own mouth:
   * a probe read of its current page (a server-issued call, not a
   * model one), then the Space's rows for that page's origin. Null
   * when the page's address is not a site origin at all.
   */
  const resolveSignInTarget = async (call: ToolCall): Promise<{ target: SignInTarget; probe: unknown } | null> => {
    if (!runner || !run.activity_space_id) return null;
    const queued = await queueAssetCall(runner, "read", {});
    if (!queued.ok) return null;
    const settled = await awaitAssetCall(queued.id);
    if (!settled.ok) return null;
    const probeUrl = (settled.result as { url?: unknown } | null)?.url;
    if (typeof probeUrl !== "string" || !probeUrl) return null;
    const origin = normalizeSiteOrigin(probeUrl);
    if (!origin) return null;
    const [row, onceId] = await Promise.all([
      siteCredentialRowForOrigin(admin, run.activity_space_id, origin),
      onceRequestForOrigin(admin, run.activity_space_id, origin),
    ]);
    const target = signInTarget({
      probeUrl, probeWall: loginWallOf(settled.result) === origin, input: call.input, row, onceRequestId: onceId,
    });
    return target ? { target, probe: settled.result } : null;
  };

  /**
   * pc_sign_in: the only path a stored password ever travels. The
   * legs, in order — each one server-side, each refusal audited and
   * shown, the value itself in none of them:
   *
   *   1. resolve the target from the runner's reported page;
   *   2. the model's claimed origin, when it claims one, must equal
   *      the page's (a mismatch is refused before any value moves);
   *   3. a call riding a person's D6 decision must still match the
   *      card that was approved — origin and account alike;
   *   4. the pair is read (stored) or taken (use-once, single-take)
   *      only now, staged in the Vault under the call's id, and the
   *      relay delivers it at claim time into the runner's memory;
   *   5. the outcome is written where it belongs: the audit 'used'
   *      row, the credential's last_test, the run's step — origin
   *      and outcome only.
   *
   * No credential for the page is not an error of the world's: the
   * wall ask is raised (the runner-wall seam) and the run is told,
   * in the PR2 pattern — the starter's Resume is the continuation.
   */
  const callSignIn = async (call: ToolCall, approved: boolean): Promise<{ content: string; is_error?: boolean }> => {
    if (!runner) return { content: "この道具の実行役は今つながっていません。ほかの道具で進めるか、つながっていないことを報告してください。", is_error: true };
    if (!run.activity_space_id) return { content: "この実行は Space のものではないため、保存されたサインイン情報は使えません。", is_error: true };
    const spaceId = run.activity_space_id;
    const cached = signInGate.get(call.id);
    const resolved = cached ? { target: cached, probe: null } : await resolveSignInTarget(call).catch(() => null);
    if (!resolved) return { content: "ブラウザの今のページを確認できませんでした。pc_read でページを見てから、もう一度試してください。", is_error: true };
    const { target } = resolved;

    const refuse = async (detail: string, stepDetail: string, content: string) => {
      const credential = target.stored ? { kind: "site", id: target.stored.id } as const
        : target.onceRequestId ? { kind: "once" } as const : null;
      if (credential) {
        await recordSignInUse(admin, {
          spaceId, runId: run.id, event: "release_refused", origin: target.origin, detail, credential,
        }).catch(() => {});
      }
      await addStep(admin, run.id, "error", `PC: サインインを拒否しました ${target.origin}`, stepDetail);
      return { content, is_error: true as const };
    };

    // Leg 2: the claim. A model that believes it is somewhere it is
    // not gets nothing — and the refusal, not any value, is recorded.
    if (target.claimMismatch) {
      return await refuse("origin_mismatch",
        "申告されたサイトとブラウザの実際のページが一致しないため、資格情報は渡しませんでした。",
        `サインインしませんでした: ブラウザが実際に開いているのは ${target.origin} で、申告されたサイトと一致しません。pc_read で今のページを確認してください。`);
    }

    // Leg 3: a decided call is bound to its card — the origin and
    // the account the person saw. Either having moved since means
    // the consent no longer names this spend.
    if (approved) {
      const { data: actionRows } = await admin.from("agent_actions")
        .select("input").eq("run_id", run.id).eq("tool_use_id", call.id)
        .order("created_at", { ascending: false }).limit(5);
      const display = ((actionRows ?? []) as { input?: { display?: ApprovalDisplay[] } }[])
        .map((a) => a.input?.display?.[0]).find((d) => d?.operation === "sign_in");
      if (display) {
        const shownUsername = display.fields.find((f) => f.label === "Username")?.value ?? null;
        if (display.destination !== target.origin || (target.stored !== null && shownUsername !== target.stored.username)) {
          return await refuse("approval_mismatch",
            "承認されたサイト／アカウントと現在のページ・保存情報が一致しないため、資格情報は渡しませんでした。",
            "承認された内容（サイト／アカウント）と現在のページ・保存情報が一致しないため、サインインしませんでした。もう一度 pc_sign_in を呼ぶと、新しい確認が出ます。");
        }
      }
    }

    // The wall: nothing stored, nothing stashed. Raise the ask and
    // tell the run plainly; a person's capture is what unblocks it.
    if (!target.stored && !target.onceRequestId) {
      const got = await createRunnerWallCredentialRequest(admin, {
        spaceId, userId: user.id, origin: target.origin,
        waitingFor: "実行中の作業", runId: run.id, usernameHint: target.storedUsername,
      }).catch(() => null);
      if (got?.created) {
        await addStep(admin, run.id, CREDENTIAL_REQUEST_STEP, credentialRequestTitle(target.origin), credentialStepDetail(got.request, target.origin));
        await notifyCredentialRequestOwners(admin, {
          spaceId, requesterId: user.id, label: target.origin, waitingFor: "実行中の作業", always: true,
        }).catch(() => 0);
      }
      const page = resolved.probe ? `\n\n${runnerResultText(resolved.probe)}` : "";
      return {
        content: `${target.origin} へのサインイン情報はこの Space に保存されておらず、使う回数限定の預かりもありません。オーナーに資格情報の入力を求めました（この実行のカードに表示されます）。入力が済んだら、実行を再開すると続きから進めます。${page}`,
        is_error: true,
      };
    }

    // The call is queued before any value moves: its stored row
    // carries only the origin the fill must match, and the relay
    // will not deliver it until its payload is staged below.
    const queued = await queueAssetCall(runner, runnerOperation(call.name), { origin: target.origin });
    if (!queued.ok) return { content: queued.content, is_error: true };
    const dropQueued = async () => {
      await admin.from("asset_calls").update({ status: "expired", finished_at: new Date().toISOString() }).eq("id", queued.id).in("status", ["pending", "claimed"]);
    };

    // Leg 4: the pair exists in this process only from here to the
    // staging call. For a stash, the take IS the spend — it happens
    // only now, with every leg already passed and the call already
    // queued, so a failure from here spends nothing it cannot drop.
    let pair: SitePair | null = null;
    if (target.stored) {
      const { data: secretText } = await admin.rpc("get_site_credential", { p_site_credential_id: target.stored.id });
      pair = parseSitePair(secretText);
      if (!pair) {
        await dropQueued();
        return { content: "保存されたサインイン情報を読み解けませんでした。Settings › Customize の「サイトログイン」で入れ直してください。", is_error: true };
      }
    } else if (target.onceRequestId) {
      const { data: taken } = await admin.rpc("take_credential_once", { p_request_id: target.onceRequestId });
      pair = pairFromTakeRow((taken as unknown[] ?? [])[0]);
      if (!pair) {
        await dropQueued();
        return { content: "使う回数限定のサインイン情報が見つかりませんでした（期限切れか、使用済みの可能性があります）。", is_error: true };
      }
    }
    if (!pair) {
      await dropQueued();
      return { content: "サインイン情報を用意できませんでした。", is_error: true };
    }

    // The pair is staged in the Vault under the call's id; the relay
    // takes it — once — as it hands the call over to the runner.
    const { error: stageError } = await admin.rpc("stage_sign_in_payload", { p_call_id: queued.id, p_pair: JSON.stringify(pair) });
    pair = null;
    if (stageError) {
      await dropQueued();
      return { content: "サインイン情報を実行役に渡せませんでした。", is_error: true };
    }
    const settled = await awaitAssetCall(queued.id);
    // Burn an undelivered payload, whatever the outcome was: if the
    // relay delivered it, this take reads nothing; if it did not,
    // the value dies here instead of lingering past its call.
    await admin.rpc("take_sign_in_payload", { p_call_id: queued.id }).then(() => {}, () => {});
    if (!settled.ok) return { content: settled.content, is_error: true };

    // Leg 5: the records. Audit first (D6's memory), then the
    // credential's own state, then the run's step — origin and
    // outcome only, in every one of them.
    const outcome = signInOutcomeOf(settled.result);
    const outcomeLine = outcome.code === "signed_in" ? "サインインしました"
      : outcome.code === "still_walled" ? "ログイン画面が残りました（保存された情報が合っていない可能性があります）"
      : outcome.code === "page_moved" ? "ページが移動していたため、入力しませんでした"
      : outcome.code === "no_form" ? "入力欄が見つかりませんでした"
      : outcome.code === "no_pair" ? "資格情報が届きませんでした"
      : "サインインできませんでした";
    if (target.stored) {
      await recordSignInUse(admin, {
        spaceId, runId: run.id, event: "used", origin: target.origin, detail: outcome.code,
        credential: { kind: "site", id: target.stored.id },
      }).catch(() => {});
      if (outcome.ok) {
        await setSiteCredentialLastTest(admin, target.stored.id, { ok: true, at: new Date().toISOString() }).catch(() => {});
      } else if (outcome.code === "still_walled") {
        await setSiteCredentialLastTest(admin, target.stored.id, {
          ok: false, at: new Date().toISOString(), code: "auth_failed", detail: "the sign-in did not open the login wall",
        }).catch(() => {});
        // The audit's share of the same fact (PR4): the credential
        // was proven bad, in the event vocabulary the heartbeat's
        // repeated-failure signal counts.
        await recordSignInUse(admin, {
          spaceId, runId: run.id, event: "test_failed", origin: target.origin, detail: "auth_failed",
          credential: { kind: "site", id: target.stored.id },
        }).catch(() => {});
        // A refused password is a reauth need (§3.6): the card
        // reappears for the owners, prefilled, password empty.
        const got = await createSiteReauthCredentialRequest(admin, {
          spaceId, userId: user.id, origin: target.origin, siteCredentialId: target.stored.id,
          username: target.stored.username, waitingFor: "実行中の作業", runId: run.id,
        }).catch(() => null);
        if (got?.created) {
          await addStep(admin, run.id, CREDENTIAL_REQUEST_STEP, credentialRequestTitle(target.origin), credentialStepDetail(got.request, target.origin));
          await notifyCredentialRequestOwners(admin, {
            spaceId, requesterId: user.id, label: target.origin, waitingFor: "実行中の作業", always: true,
          }).catch(() => 0);
        }
      }
    } else if (target.onceRequestId) {
      // The take already wrote the 'used' row; name its run on it.
      await annotateOnceUseRun(admin, target.onceRequestId, run.id).catch(() => {});
    }
    if (outcome.ok) {
      await supersedePendingSiteRequests(admin, spaceId, target.origin).catch(() => {});
    }
    await addStep(admin, run.id, "action", signInStepTitle(target.origin), outcomeLine);
    return { content: signInResultText(settled.result), ...(outcome.ok ? {} : { is_error: true }) };
  };

  const executeCall = async (call: ToolCall, approved = false): Promise<{ content: string; is_error?: boolean; finish?: FinishPayload; verify?: VerifyCheck; question?: { ticketId: string } }> => {
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
        const claims = normalizeClaims(input.claims);
        const unconfirmed = normalizeUnconfirmed(input.unconfirmed);
        const finish: FinishPayload = {
          outcome, summary: String(input.summary ?? "").trim().slice(0, 300) || "完了", message: String(input.message ?? "").trim(),
          // Copied through unvalidated: the gate validates the proposals at
          // finish time, when the bound measures and the verdict are known.
          ...(Array.isArray(input.readings) ? { readings: input.readings as { measureId: string; value: number }[] } : {}),
          // The facts the finish states, typed (finishClaims.ts): the
          // mechanical check judges them at the gate; the record seals them.
          ...(claims.length ? { claims } : {}),
          ...(unconfirmed.length ? { unconfirmed } : {}),
        };
        return { content: "完了報告を受け取りました。", finish };
      }
      case "ask_question": {
        // Filing a question is a real act on the person's queue, so a
        // rehearsal never files one — what it cannot decide surfaces
        // in its own report as unconfirmed — and a plan run's
        // questions belong to the run that applies the plan, not to
        // the plan itself.
        if (run.rehearsal) return { content: "試走では質問は出せません。判断が要る点は、試走の報告に未確認として残してください。", is_error: true };
        if (planRun) return { content: "計画モードでは質問は出せません。判断が要る点は計画への注記として残し、実行時に質問してください。", is_error: true };
        const v = validateAskInput(input);
        if ("error" in v) return { content: v.error, is_error: true };
        if (!run.activity_space_id) return { content: "この実行には Space がないため、質問を出すことができません。", is_error: true };
        const { ticket, created } = await ensureQuestionTicket(admin, {
          spaceId: run.activity_space_id, runId: run.id, elementId: run.element_id,
          strategyId: recordScope?.strategyId ?? run.strategy_id ?? null,
          toolUseId: call.id, ask: v.value, now: new Date(),
        });
        // A slice retried after the filing (its outcome was never
        // saved) can meet a ticket that already ended: an answered
        // one hands its answer over as this call's result directly,
        // an expired one answers honestly — the run never rests on a
        // ticket that is not standing.
        if (ticket.status === "answered" && ticket.answer) return { content: ticket.answer };
        if (ticket.status === "expired") return { content: "その質問は、回答がないまま期限を過ぎました。状況を確認し、必要なら新しい質問として出し直してください。", is_error: true };
        await addStep(admin, run.id, "question", `質問: ${questionShortForm(ticket.question)}`,
          created ? "人の回答があるまで、この実行は休止します。" : "同じ質問がすでに出ているため、そのチケットで回答を待ちます。");
        return { content: "質問を登録しました。回答があるまで、この実行は休止します。", question: { ticketId: ticket.id } };
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
    if (call.name === SIGN_IN_TOOL) return await callSignIn(call, approved);
    if (isRunnerTool(call.name)) return await callRunner(call, runner, runnerResultText);
    if (isMachineTool(call.name)) return await callMachine(call);
    if (baseKindOf(call.name) === "board") {
      const r = await runCatalogTool(userDb, call.name, input, actor, { entry: "element", approved, spaceId: run.activity_space_id ?? null });
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

  // ── Compensation (B9) ─────────────────────────────────────────────
  // The driver's half of the compensation pass: an undo command
  // resolves to its tool in this run's assembly (deterministic names,
  // so a decision invocation resolves the same ones), the verdict is
  // this driver's own composition for the call, and execution rides
  // executeCall — with the call marked as compensating its payload
  // row, so the record stage writes the rollback's own row, never a
  // fresh payload.
  const compensationDeps = {
    resolveUndoTool: (integrationId: string, commandName: string): { toolName: string } | null => {
      for (const [toolName, it] of integrationTools) {
        if (it.integration.id === integrationId && it.command?.name === commandName) return { toolName };
      }
      return null;
    },
    // B10 (§6.4): compensation verdicts carry NO chain fact — the
    // deliberate asymmetry. An undo is the clean-up of an act that
    // already stood inside the fence, judged by B9's own policy
    // path; fencing it could strand a half-rollback behind a scope
    // the undo command was never part of.
    verdictOf: (call: ToolCall) => verdictForCall(call, { noChain: true }),
    executeUndo: async (call: ToolCall): Promise<{ ok: boolean; errorText?: string }> => {
      const rowId = call.id.startsWith("undo-") ? call.id.slice("undo-".length) : null;
      if (rowId) compensationOfCall.set(call.id, rowId);
      try {
        const r = await executeCall(call, true);
        return { ok: !r.is_error, ...(r.is_error ? { errorText: r.content } : {}) };
      } finally {
        if (rowId) compensationOfCall.delete(call.id);
      }
    },
    displayFor: (call: ToolCall) => approvalDisplayFor(call),
  };

  const runFailureCompensation = async (failureClass: FailureClass): Promise<CompensationPassOutcome> => {
    try {
      return await runCompensationPass(admin, {
        runId: run.id, elementId: run.element_id, definitionId: definition?.id ?? null,
        deps: compensationDeps,
        // B13: the settle's class and the failure policy's resolution
        // reach the pass through B9's seam — a definition row's or an
        // installed entry's compensate word governs this rollback.
        failureClass, policySource: failureSource,
      });
    } catch {
      // The pass failing must never take the failure settle down with
      // it: the report then reads from whatever the records hold (a
      // row left mid-claim reads as interrupted — state unknown —
      // which is the truth of it).
      const report = await loadCompensationReport(admin, run.id).catch((): CompensationReportData => ({
        compensated: [], failed: [], declined: [], offered: [], uncompensated: [], failedWrites: [],
      }));
      return { kind: "settled", report };
    }
  };

  /**
   * The escalation a settled failure fires (B13 §6.4) — once, at the
   * moment the settle finalizes, never while a compensation batch
   * still rests undecided (the run is not yet "failed" to report).
   * owner: every Space owner is told; strategy: the Strategy's
   * creator, falling back to the owners when they cannot be named —
   * and the fallback is said on the run (D4); inbox: no notification
   * at all — the heartbeat reads the run's failure_detail and raises
   * its failure_escalation instead of the plain failure. A run with
   * no Space tells the person who triggered it.
   */
  const fireFailureEscalation = async (failureClass: FailureClass, policy: ResolvedFailurePolicy): Promise<void> => {
    const target = policy.escalate;
    if (!target || target === "inbox") return;
    let recipients: string[] = [];
    let fellBack = false;
    if (target === "strategy" && run.strategy_id) {
      const { data: st } = await admin.from("strategies").select("created_by")
        .eq("id", run.strategy_id).maybeSingle();
      const createdBy = (st as { created_by: string | null } | null)?.created_by ?? null;
      if (createdBy) recipients = [createdBy];
    }
    if (!recipients.length) {
      if (target === "strategy") fellBack = true;
      if (run.activity_space_id) {
        const { data: owners } = await admin.from("activity_space_members")
          .select("user_id").eq("activity_space_id", run.activity_space_id).eq("role", "owner");
        recipients = ((owners ?? []) as { user_id: string }[]).map((o) => o.user_id);
      }
    }
    if (!recipients.length && run.triggered_by) recipients = [run.triggered_by];
    if (fellBack) {
      await addStep(admin, run.id, "status", "エスカレーションの宛先を切り替えました",
        "Strategy のオーナーを特定できなかったため、Space のオーナーに報告します。");
    }
    let elementTitle: string | null = null;
    if (run.element_id) {
      const { data: el } = await admin.from("elements").select("title").eq("id", run.element_id).maybeSingle();
      elementTitle = (el as { title: string } | null)?.title ?? null;
    }
    const title = `実行が失敗しました: ${elementTitle ?? agentName}`;
    const body = `失敗の種類: ${failureClass}（${POLICY_LAYER_LABEL[policy.source.escalate]}の規則によるエスカレーション）。実行の記録で詳細を確認できます。`;
    for (const recipient of [...new Set(recipients)]) {
      await admin.from("notifications").insert({
        recipient_id: recipient, actor_name: agentName, kind: "status_change", element_id: run.element_id,
        title, body,
      }).then(() => {}, () => {});
    }
  };

  /**
   * A failure settle's own record (B13 §6.5), written when the settle
   * FINALIZES — the finish sealed, the refusal sealed, or the
   * person's decision on a rested batch: the failure_detail on the
   * run (the audit's drill-down reads it), the step a person reads
   * in the trace, and then the escalation. A rehearsal settles
   * nothing here: a trial's failure is reported by its report, not
   * escalated to people (§6.6).
   */
  const finalizeFailureSettle = async (args: {
    failureClass: FailureClass;
    policy?: ResolvedFailurePolicy;
    giveUp?: { count: number } | null;
  }): Promise<void> => {
    if (run.rehearsal) {
      // A definition test run (B14 §6.2): the escalation is RESOLVED
      // — the same policy resolution a real run would deliver on —
      // and recorded as data on the run's test block, never
      // delivered. A test's failure reaching the real owner would be
      // noise; the resolution is the evidence the settle reports.
      // The terminal paths save the transcript before this settle,
      // so the resolution persists itself with a targeted merge.
      if (testTransport) {
        const resolved = args.policy ?? resolveFailurePolicy({
          class: args.failureClass, definition: parsedAll, entries: failureEntries,
        });
        if (resolved.escalate) {
          testEscalation = resolved.escalate;
          const { data: cur } = await admin.from("agent_runs")
            .select("transcript").eq("id", run.id).maybeSingle();
          const stored = (cur?.transcript ?? {}) as Transcript;
          await admin.from("agent_runs").update({
            transcript: {
              ...stored,
              test: { ...testTransport.state(), ...(stored.test ?? {}), escalation: resolved.escalate },
            },
          }).eq("id", run.id);
        }
      }
      return;
    }
    const policy = args.policy ?? resolveFailurePolicy({
      class: args.failureClass, definition: parsedAll, entries: failureEntries,
    });
    await sealFailureDetail(admin, run.id, failureDetailOf({
      failureClass: args.failureClass, policy, retries: failureRetriesTotal,
      giveUp: args.giveUp ?? null, at: new Date(),
    }));
    const compensateText = policy.compensate === "auto" ? "自動で巻き戻しました"
      : policy.compensate === "never" ? "巻き戻しません" : "確認のうえで判断します";
    await addStep(admin, run.id, "failure", `失敗の扱い: ${args.failureClass}`, [
      `補償は${compensateText}（${POLICY_LAYER_LABEL[policy.source.compensate]}）`,
      policy.escalate
        ? `エスカレーション: ${ESCALATE_TARGET_LABEL[policy.escalate]}（${POLICY_LAYER_LABEL[policy.source.escalate]}）`
        : "エスカレーション: なし",
      `この実行の再試行: ${failureRetriesTotal} 回`,
      ...(args.giveUp ? [`諦め: ${args.failureClass} の失敗 ${args.giveUp.count} 回で上限に達しました`] : []),
    ].join("。") + "。");
    await fireFailureEscalation(args.failureClass, policy);
  };

  /** Posts the compensation report where the failure's own report
   *  goes — the Element's thread — and onto the run's steps with its
   *  structured form. Silent when there is nothing to say. */
  const postCompensationReport = async (report: CompensationReportData): Promise<void> => {
    if (!compensationReportHasContent(report)) return;
    const text = compensationReportText(report);
    if (run.element_id) {
      await admin.from("element_comments").insert({
        element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
        content: text,
      });
    }
    await addStep(admin, run.id, "compensation", "補償（巻き戻し）の結果", `${text}\n\n${JSON.stringify(report)}`);
  };

  /**
   * A terminal finish's settle, shared by the finish that just
   * landed, the failure path that ran its compensation pass first,
   * and the decision that finalized a held rollback: the finishRun
   * itself (with the compensation outcome sealed into its record
   * when a pass ran), the report on the thread, and the memory
   * capture a sealed finish earns.
   */
  const settleFinish = async (
    finish: FinishPayload, verdict: RunVerdict | null, comp?: CompensationReportData,
  ): Promise<void> => {
    const sealed = await finishRun(a, run, agentName,
      comp ? { ...finish, compensation: compensationSummaryOf(comp) } : finish,
      undefined, verdict, boundMeasures);
    if (comp) await postCompensationReport(comp);
    // Memory: a sealed finish is distilled into episodes — the curated
    // layer above this run's sealed record. Best-effort by construction
    // (capture never throws); a run stopped meanwhile (not sealed)
    // teaches nothing, and an external-provider run is skipped (the
    // distillation calls are Anthropic-shaped). A rehearsal run is
    // skipped too: a trial's finish is evidence about a definition,
    // not work the person did, and its report is the record it leaves.
    // A plan run is skipped for the same reason: its finish is a plan
    // awaiting a decision, not completed work.
    if (sealed && !run.rehearsal && !planRun) {
      const { data: el } = await userDb.from("elements").select("title, description").eq("id", run.element_id).maybeSingle();
      await captureMemories({
        admin, userId: user.id,
        scope: captureScopeOf(run.activity_space_id), spaceId: run.activity_space_id,
        material: {
          finishSummary: finish.summary, finishMessage: finish.message,
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
  };

  /**
   * Parks a compensation batch as the run's one pending approval:
   * the batch rides the transcript with the failure it interrupted,
   * the action carries the compensation marker (the card's label),
   * and the person is told a rollback — not new work — waits. The
   * decision entry's hash check covers these calls exactly as it
   * covers a turn's.
   */
  const restCompensationBatch = async (
    outcome: Extract<CompensationPassOutcome, { kind: "rest" }>,
    failure: NonNullable<SavedPending["compensation"]>["failure"],
    failureSummary: string,
    // The failure's class and its resolved policy (B13): rested with
    // the batch, so the decision that finalizes this settle seals
    // the failure record and fires the escalation under exactly
    // these — never a re-resolution at decision time.
    settle: { failureClass: FailureClass; policy: ResolvedFailurePolicy },
  ): Promise<void> => {
    const compPending: SavedPending = {
      calls: outcome.calls, partial: [],
      compensation: {
        failure, entries: outcome.entries, report: outcome.report,
        failureClass: settle.failureClass, failurePolicy: settle.policy,
      },
    };
    await saveTranscript(compPending);
    const display = displaysUnderMode(outcome.displays, mode);
    const summary = `補償（巻き戻し）の承認待ち: ${approvalSummary(display)}`;
    const inputHash = await sha256(canonicalCalls(outcome.calls));
    const { data: waiting } = await admin.from("agent_runs").update({ status: "awaiting_approval", summary })
      .eq("id", run.id).eq("status", "running").select("id").maybeSingle();
    if (!waiting) return; // cancelled meanwhile
    const { data: action } = await admin.from("agent_actions").insert({
      run_id: run.id, element_id: run.element_id, tool_use_id: outcome.calls[0].id, tool: "batch",
      input: { calls: outcome.calls, display, compensation: { setSize: outcome.entries.length, failureSummary, failureClass: settle.failureClass, escalate: settle.policy.escalate } },
      input_hash: inputHash, summary,
      integration_id: integrationTools.get(outcome.calls[0].name)?.integration.id ?? null,
    }).select("id").single();
    await addStep(admin, run.id, "compensation", summary, compensationReportText(outcome.report));
    if (run.element_id) {
      await admin.from("element_comments").insert({
        element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
        content: `**補償（巻き戻し）の承認待ち** — 失敗した実行の書き込みを巻き戻します。\n\n${compensationReportText(outcome.report)}`,
      });
    }
    if (run.triggered_by) {
      await admin.from("notifications").insert({
        recipient_id: run.triggered_by, actor_name: agentName, kind: "approval_requested", element_id: run.element_id,
        agent_action_id: (action as { id: string } | null)?.id ?? null,
        title: `${agentName} が補償（巻き戻し）の承認を求めています`, body: summary,
      }).then(() => {}, () => {});
    }
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
    // A rehearsal never signs in: the fill is a real submit on a real
    // site, so it is planned like a machine write, never lived.
    if (call.name === SIGN_IN_TOOL) return await plan("PC: サインイン", true, null);
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
      // A definition test's planned write (B14 §4.6) must also match
      // the fixture: a match consumes the recorded write exchange; a
      // mismatch names the divergence in the plan's problem — the
      // classification reads it as write_plan_invalid, and the
      // transport's record carries it as data for the settle.
      if (testTransport) {
        const action = replayActionFor(it, call);
        const matched = await testTransport.matchWrite(action, call.input);
        if (!matched.valid) {
          const divergence = `write-divergence: ${action}（記録された書き込みと一致しません）`;
          problem = problem ? `${divergence} / ${problem}` : divergence;
        }
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

  // ── B8: a plan run's gate ──────────────────────────────────────────────
  // The rehearsal gate's recording sibling. Reads run live; every intended
  // write is recorded as a PlanCall with its exact arguments and the display
  // the approval machinery would show for it, and nothing is executed. The
  // differences from a rehearsal are the point of the piece: the record
  // keeps the ARGUMENTS (the plan is approvable as one unit), a call policy
  // would deny is marked denied at plan time (an approval cannot cover
  // it), a verify-declared write captures its expected post-state and its
  // pre-state baseline for the apply run's drift check, and runner actions
  // that would change the person's browser (open / click / type / back)
  // are planned rather than performed — a dry run does not drive the real
  // browser; pc_read still reads live.
  const planGate = async (call: ToolCall): Promise<{ content: string; is_error?: boolean; finish?: FinishPayload }> => {
    const planDisplay = (problem: string | null, denied: boolean, expected: PlanExpectedEffect | null): ApprovalDisplay => {
      const d = approvalDisplayFor(call);
      const fields = [...d.fields];
      if (expected) fields.push({ label: "読み戻し確認", value: expectedNote(expected) });
      if (denied) fields.push({ label: "ポリシー", value: "この引数では拒否されています。承認しても実行されません" });
      if (problem) fields.push({ label: "組み立て", value: problem });
      // A plan is approved as a whole; a per-call "remember" has no meaning.
      return { ...d, fields, rememberable: false };
    };
    const record = async (label: string, opts: {
      problem?: string | null; denied?: boolean; expected?: PlanExpectedEffect | null;
      critical?: PlanCall["critical"]; display?: ApprovalDisplay;
    } = {}): Promise<{ content: string }> => {
      const problem = opts.problem ?? null;
      const denied = opts.denied === true;
      const entry: PlanCall = {
        call, key: await planCallKey(call), label,
        display: opts.display ?? planDisplay(problem, denied, opts.expected ?? null),
        critical: opts.critical ?? null, denied, problem,
        expected: opts.expected ?? null,
      };
      planDraft.push(entry);
      await addStep(admin, run.id, "plan", `計画: 書き込み — ${label}`,
        denied ? "ポリシーで拒否される引数のため、承認しても実行されません。計画に記録しました（実行はしません）。"
          : problem ? `組み立てに問題があります: ${problem}（計画に記録しました。実行はしません）`
          : "実行はしません。計画に記録しました。");
      return {
        content: denied ? "計画のため、この書き込みは実行しません。なお、この引数ではポリシーで拒否されるため、承認されても実行されません。"
          : problem ? `計画のため、この書き込みは実行しません。なお組み立てに問題があります: ${problem}`
          : "計画のため、この書き込みは実行しません。計画に記録しました。手順を続けてください。",
      };
    };
    switch (call.name) {
      case "record_plan": case "log_progress": case "record_round": case "finish": case "save_artifact":
        return await executeCall(call);
      case "read_records": return await executeCall(call);
    }
    if (call.name === "save_records") {
      const problem = !recordScope
        ? "この Element は Strategy に属していないので、表は使えません"
        : typeof call.input.table !== "string" || !call.input.table
          || typeof call.input.key !== "string" || !call.input.key
          || !Array.isArray(call.input.records)
          ? "table / key / records の形が要ります"
          : null;
      return await record(`表に保存: ${String(call.input.table ?? "")}`, { problem });
    }
    if (call.name === "complete_subelement") {
      const ok = subelementIds.has(String(call.input.subelement_id ?? ""));
      return await record("サブ要素を完了", { problem: ok ? null : "この Element のサブ要素ではありません" });
    }
    if (call.name === SIGN_IN_TOOL) {
      const resolved = runner && run.activity_space_id ? await resolveSignInTarget(call).catch(() => null) : null;
      return await record("PC: サインイン", {
        display: resolved ? { ...signInDisplayFor(call, resolved.target), rememberable: false } : undefined,
      });
    }
    if (isRunnerTool(call.name)) {
      if (call.name === "pc_read") return await executeCall(call);
      return await record(`PC: ${runnerOperation(call.name)}`, {});
    }
    if (isMachineTool(call.name)) {
      if (call.name === "vm_read_file") return await executeCall(call);
      return await record(call.name === "vm_write_file" ? `ファイルに書く: ${String(call.input.path ?? "")}` : "コマンドを実行", {});
    }
    const pit = integrationTools.get(call.name);
    if (pit) {
      const label = `${pit.integration.name}: ${operationOf(pit, call.input)}`;
      // B10 (§5.3, record time): the fence is judged before a call
      // is recorded OR run live — an out-of-scope write never enters
      // the plan (a plan approval gathered over it could not cover
      // what the fence refuses anyway: an approval never widens a
      // binding), and a read the plan mode would run live is refused
      // here exactly as the gate would refuse it.
      if (runScope) {
        const chainFact = chainFactFor(runScope, pit, call);
        if (chainFact && !chainFact.inScope) {
          chainDeniedCount++;
          return { content: chainDenyRefusal(pit.integration.name, operationOf(pit, call.input)), is_error: true };
        }
      }
      if (integrationCallIsRead(pit, call)) return await executeCall(call);
      let problem: string | null = null;
      if (pit.command) {
        const req = requestFor(pit.command, call.input);
        if ("error" in req) problem = req.error;
      } else if (pit.remote) {
        const def = tools.find((t) => t.name === call.name);
        const required = ((def?.input_schema as { required?: unknown } | undefined)?.required ?? []) as string[];
        const missing = required.filter((f) => call.input[f] === undefined || call.input[f] === null || call.input[f] === "");
        if (missing.length) problem = `${missing.join("、")} が必要です`;
      }
      // Denied at plan time, on the policy's own verdict — the mode never
      // enters it: the plan approval is the consent being gathered, and a
      // denied call is shown as uncoverable rather than silently dropped.
      const denied = approvalVerdict(integrationApprovalFacts(pit, call, true)) === "deny";
      const expected = !problem && pit.command?.verify ? await capturePlanExpected(pit, call) : null;
      return await record(label, { problem, denied, expected, critical: criticalOfTool(pit) });
    }
    if (isCatalogTool(call.name)) {
      const tool = catalogTool(call.name)!;
      const label = `Alcon: ${catalogOperation(call.name, call.input)}`;
      if (effectOfCall(tool, call.input) === "read") return await executeCall(call);
      const decision = decideCall("element", tool, call.input);
      return await record(label, {
        problem: decision === "deny" ? catalogDenyRefusal(call.name, call.input) : null,
        denied: decision === "deny",
      });
    }
    return await executeCall(call);
  };

  // The measures this run may report readings for: those of the Strategies
  // its Element serves — the same set the verifier judges the finish
  // against. Loaded once: the task context lists them for the agent, and
  // finishRun gates the finish's proposals by them.
  const boundMeasures = await loadBoundMeasures(userDb, run.element_id);

  // B8 plan mode, both sides of the approval. A plan run accumulates its
  // plan here (the draft rides the transcript across slices, like the
  // rehearsal report); an apply run carries the approved plan it is
  // executing under, with consumption marked on the entries as covered
  // calls execute — also transcript-riding, so a slice boundary never
  // re-spends an approval on the same entry twice. Declared before the
  // run's state: the opening text already speaks of the plan.
  const planRun = run.plan_mode === true;
  const planDraft: PlanCall[] = planRun ? readPlanCalls(run.transcript?.planDraft) : [];
  const approvedPlan: RunPlan | null = !planRun ? readRunPlan(run.transcript?.approvedPlan) : null;
  // The iteration brief (coding PR4), transcript-riding like the
  // approved plan: parsed once here, re-spread by every save, and
  // consulted at delivery (the tree comes from the PR's head) and
  // at the finish (the patch goes back as an amend). A malformed
  // brief is no brief — the run is then an ordinary coding run.
  const codingAmendBrief: CodingAmendBrief | null = parseCodingAmend(run.transcript?.codingAmend);
  const planMatches = new Map<string, PlanCall>();
  let sealedPlan: RunPlan | null = null;

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
  // The question rest this run stands in, if any (B12): the paused
  // turn's unanswered ask_question calls and their tickets. It rides
  // the transcript across slices like the approval pending does, and
  // saveTranscript below reads this variable, so every save keeps it
  // until the answer application clears it.
  let question: SavedQuestion | undefined = run.transcript?.question;
  // The compensation rest this run stands in, if any (B9): a failed
  // run's rollback, offered as one pending batch. Captured before
  // applyDecision consumes the pending: the person's decision on it
  // finalizes the failure settle instead of resuming the loop. Its
  // calls are seeded into the compensation context now, so the
  // record stage writes their executions as the rollback's own rows.
  const standingCompensation = pending?.compensation;
  if (standingCompensation) {
    for (const e of standingCompensation.entries) compensationOfCall.set(e.callId, e.rowId);
  }
  // The publish rest this run stands in, if any (coding PR3): a
  // finished coding run's publish, offered as one batch. Captured
  // before applyDecision consumes the pending, like the compensation
  // rest above: the person's decision finalizes the finish the
  // publish interrupted instead of resuming the loop.
  const standingPublish = pending?.publish;
  if (run.transcript?.messages?.length) {
    state = { messages: run.transcript.messages, turns: run.transcript.turns ?? 0, nudges: run.transcript.nudges ?? 0, revisions: run.transcript.revisions ?? 0 };
    turnBudget = run.transcript.turnBudget ?? maxTotalTurns;
    // Resuming grants a fresh allowance on top of the turns already taken.
    if (a.body.resume) turnBudget = state.turns + maxTotalTurns;
  } else {
    const ctx = await loadContext(userDb, run, integrationSummary, null, boundMeasures);
    const task = taskMessage(ctx);
    // The injected bodies count as uses of those memories (PR3).
    if (ctx.memoryUsedIds?.length) await noteMemoryUse(admin, run.id, ctx.memoryUsedIds);
    // B6: the resolved definition's activated constraints render into
    // its effective body here, at resolution — computed from the
    // truth table, never written into the stored body, so
    // deactivating one takes effect on the next run and the person's
    // text is untouched. A rehearsal tries a draft body, not a row:
    // no constraints land on it.
    const defConstraints = !run.rehearsal && definition?.id
      ? await loadActiveConstraints(userDb, "definition", definition.id)
      : [];
    const effectiveBody = definition ? effectiveDefinitionText(definition.body, defConstraints) : "";
    const defText = definition && parsedAll
      ? definition.scope === "element"
        ? definitionPrompt(definition.name, effectiveBody, parsedAll)
        : `# Strategy の定義「${definition.name}」（この Strategy 全体の方針。依頼した人が定めたもので、従う。成果物の型とループはこの Element には課されない）\n${effectiveBody.slice(0, 40_000)}`
      : null;
    const opening = defText ? `${task}\n\n${defText}` : task;
    const openingText = run.rehearsal ? `${opening}\n\n${REHEARSAL_TASK_NOTICE}`
      : planRun ? `${opening}\n\n${PLAN_TASK_NOTICE}`
      : approvedPlan ? `${opening}\n\n${planApplyNotice(approvedPlan)}`
      : opening;
    state = { messages: [{ role: "user", content: openingText }], turns: 0, nudges: 0 };
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

  // The corrections this run's finishes have been sent back with so
  // far (B3): they ride the transcript across slices, and the
  // terminal finish seals them onto the verdict record — the run's
  // whole correction history, not just this slice's.
  const corrections: CorrectionEnvelope[] = parseCorrectionHistory(run.transcript?.corrections);

  // The run's total of engine retries (B13): accumulated here as the
  // call seam retries, carried across slices on the transcript, and
  // read by the settle's failure record — the run's own number.
  let failureRetriesTotal = run.transcript?.failureRetries ?? 0;

  const saveTranscript = async (p?: SavedPending) => {
    const transcript: Transcript = {
      messages: state.messages, turns: state.turns, nudges: state.nudges, revisions: state.revisions ?? 0, turnBudget, tools,
      ...(p ? { pending: p } : {}),
      ...(question ? { question } : {}),
      ...(corrections.length ? { corrections } : {}),
      ...(failureRetriesTotal ? { failureRetries: failureRetriesTotal } : {}),
      ...(run.rehearsal ? {
        rehearsal: rehearsalReport,
        ...(run.transcript?.rehearsalDefinition ? { rehearsalDefinition: run.transcript.rehearsalDefinition } : {}),
      } : {}),
      // A test run's replay state (B14 §6.3): consumption and
      // divergences as the transport holds them now, the fixture
      // reference carried so a continuation rebuilds the transport
      // from the row, and the escalation resolution when the run's
      // failure settled one (data only — §6.2).
      ...(testTransport ? {
        test: { ...testTransport.state(), ...(testEscalation ? { escalation: testEscalation } : {}) },
        ...(run.transcript?.testFixture ? { testFixture: run.transcript.testFixture } : {}),
      } : {}),
      // The sealed plan supersedes the draft that produced it.
      ...(planRun ? (sealedPlan ? { plan: sealedPlan } : { planDraft }) : {}),
      ...(approvedPlan ? { approvedPlan } : {}),
      ...(codingAmendBrief ? { codingAmend: codingAmendBrief } : {}),
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
    // A scoped run's next slice is driven under a FRESH chain token
    // minted from its row (B10): slices outlive the 300-second
    // carriage that brought this one here, so the hand-off re-mints
    // rather than forwarding a dying claim.
    const driveJwt = runScope ? await chainDriveJwt(user.id, runScope, run.id, a.jwt) : a.jwt;
    await fetch(`${a.supabaseUrl}/functions/v1/run-agent`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${driveJwt}` },
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

  // A run resting on question tickets takes only an answer (B12): any
  // other entry that reached here — a stale continuation, a resume —
  // must not run the loop over a turn whose tool calls still have no
  // results, so the run goes back to its rest, summary and all.
  if (question && !a.answer) {
    const standing = await loadQuestionTickets(admin, question.tickets.map((t) => t.ticketId));
    await admin.from("agent_runs").update({ status: "awaiting_input", summary: restingSummaryFor(standing) })
      .eq("id", run.id).eq("status", "running");
    return;
  }

  // ── An answer answers the paused turn first (B12) ─────────────────
  // serve() validated the answer against its ticket before claiming;
  // here the ticket is marked (the guarded transition races the
  // expiry sweep — the loser stops), and the resting set is re-read
  // from its rows, never from the transcript's memory of it.
  if (question && a.answer) {
    const q = question;
    const answer = a.answer;
    const marked = await markQuestionAnswered(admin, {
      ticketId: answer.ticketId, answer: answer.answer, answeredBy: user.id, now: new Date(),
    });
    const tickets = await loadQuestionTickets(admin, q.tickets.map((t) => t.ticketId));
    const byId = new Map(tickets.map((t) => [t.id, t]));
    // A standing answer is kept as the Space's durable fact — by the
    // engine, with the person's session, through the one memory writer
    // (a question is only ever asked from a Space's run). The agent
    // has no hand in the write, but it did name the topic, so the write
    // never replaces a fact the Space already holds under it: that
    // rule changes only where a person edits it (the memory settings).
    // A write that does not happen never holds the answer back — this
    // run still gets it — and the step says what stands for the next.
    const answeredTicket = marked ? byId.get(answer.ticketId) : undefined;
    const standing = answeredTicket && run.activity_space_id
      ? standingAnswerMemory(answeredTicket, answer.answer, answer.keep, new Date()) : null;
    if (standing && run.activity_space_id) {
      const kept = await writeDurableMemory(userDb, standing,
        { scope: "space", spaceId: run.activity_space_id }, user.id, { replace: false });
      if (kept.ok) {
        await addStep(admin, run.id, "status", `答えを次からも使う決まりとして残しました: ${standing.topic}`, standing.gist);
      } else if (kept.standing) {
        await addStep(admin, run.id, "status", `この話題にはすでに決まりがあるため、変えていません: ${standing.topic}`,
          "今回の答えは、この仕事にだけ使います。決まりを変えるときは、設定の記憶から直してください。");
      } else {
        await addStep(admin, run.id, "error", `答えを決まりとして残せませんでした: ${standing.topic}`, kept.error);
      }
    }
    const expired = tickets.filter((t) => t.status === "expired");
    if (!marked || expired.length) {
      // The expiry took this ticket (or a sibling) between serve's
      // check and the marking: the run ends blocked on the questions
      // that went unanswered, exactly as the tick settles it.
      await settleRunBlockedByQuestions(admin, {
        run, tickets: expired.length ? expired : tickets, expectStatus: "running",
        agentName, actorUserId: user.id, now: new Date(),
      });
      return;
    }
    const stillOpen = tickets.filter((t) => t.status === "open");
    if (stillOpen.length) {
      // One rest, several questions: the run goes back to waiting on
      // the ones still unanswered. Nothing is appended to the
      // transcript yet — the paused turn is answered in ONE message
      // when the last answer lands, so every tool_use still gets
      // exactly one tool_result in the message that follows it.
      await saveTranscript(pending);
      await admin.from("agent_runs").update({ status: "awaiting_input", summary: restingSummaryFor(stillOpen) })
        .eq("id", run.id).eq("status", "running");
      await addStep(admin, run.id, "question", "回答を受け取りました", `残りの質問（${stillOpen.length} 件）の回答を待っています。`);
      return;
    }
    // Every question answered: the answers are the calls' results —
    // the person's words verbatim, read from the ticket rows — in the
    // one message that answers the paused turn, the decision path's
    // own discipline (appendDecisionResults).
    const answerResults: ToolResult[] = q.calls.map((c) => {
      const ticketId = q.tickets.find((x) => x.callId === c.id)?.ticketId ?? "";
      return { type: "tool_result", tool_use_id: c.id, content: byId.get(ticketId)?.answer ?? "" };
    });
    appendDecisionResults(state, q, answerResults);
    question = undefined;
    await addStep(admin, run.id, "question", "回答を受け取りました", "質問への回答を受けて、作業を再開します。");
    await saveTranscript(pending);
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
    // Graduated autonomy (B7): a rejection revokes the rejected
    // commands' earned grants in the same flow that records it, so
    // the next call to the command asks again.
    onRejected: async (_action, calls) => {
      // A compensation batch's rejection is not an incident against
      // the undo command (B9 §7.2): the person declined a rollback,
      // they did not judge the command — its earned grant stands.
      if (standingCompensation) return;
      // A publish batch's rejection is the same shape (coding PR3):
      // the person declined this PR, they did not judge the publish
      // commands — the batch was the server's composition of the
      // run's patch, not the agent's chosen act.
      if (standingPublish) return;
      if (!run.activity_space_id) return;
      const seen = new Set<string>();
      for (const c of calls) {
        const it = integrationTools.get(c.name);
        if (!it?.command) continue;
        const key = `${it.integration.id}:${it.command.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await revokeAutonomyForIncident(admin, {
          spaceId: run.activity_space_id, integrationId: it.integration.id, action: it.command.name,
          kind: "rejection", runId: run.id,
        });
      }
    },
    // Under the ask mode nothing is rememberable: every write asks again,
    // so a decision's "from now on" is not accepted, as the card never
    // offered it.
    rememberApproval: mode === "ask" ? undefined : rememberApproval, scheduleContinuation, deadline,
  });
  if (decisionOutcome.decided) {
    // A decision answers any circuit-breaker hold this run rested on
    // (B11): the trip is acknowledged by the answer itself — approved
    // or rejected, a person has now seen what tripped and judged it.
    // Nothing else acknowledges a trip, and nothing auto-resumes one:
    // this update only follows a person's recorded decision.
    await admin.from("breaker_trips").update({
      status: "acknowledged", acknowledged_by: user.id, acknowledged_at: new Date().toISOString(),
    }).eq("run_id", run.id).eq("status", "open").then(() => {}, () => {});
  }
  if (decisionOutcome.continued) return;
  pending = decisionOutcome.pending;

  // A decision on a compensation batch finalizes the failure settle
  // the batch interrupted (B9): the batch's outcomes seal its payload
  // rows, the merged report posts, and the original failure — the
  // finish with its verdict, or the refusal — settles exactly as it
  // would have, with the compensation outcome in its record. The
  // loop never resumes: the model is done, there is no live turn.
  if (standingCompensation && decisionOutcome.decided && !decisionOutcome.continued) {
    const decided = decisionOutcome.decided;
    const outcomes = new Map<string, { ok: boolean; reason?: string }>();
    for (const e of standingCompensation.entries) {
      const res = decided.results.find((r) => r.tool_use_id === e.callId);
      outcomes.set(e.rowId, {
        ok: !!res && !res.is_error,
        ...(res?.is_error ? { reason: COMPENSATION_REASONS.executionError(res.content) } : {}),
      });
    }
    for (const e of standingCompensation.entries) {
      const o = outcomes.get(e.rowId)!;
      await settleWriteCompensation(admin, e.rowId,
        decided.approved ? (o.ok ? "compensated" : "compensation_failed") : "declined",
        decided.approved ? (o.ok ? null : (o.reason ?? COMPENSATION_REASONS.resultMissing)) : null);
    }
    const report = mergeCompensationBatchOutcome(standingCompensation.report, { approved: decided.approved, outcomes });
    if (standingCompensation.failure.kind === "finish") {
      await settleFinish(standingCompensation.failure.finish, standingCompensation.failure.verdict, report);
    } else {
      await postCompensationReport(report);
      await failRun(admin, run, standingCompensation.failure.message);
    }
    // The decision finalizes the failure settle too (B13): its
    // record seals and its escalation fires now — under the class
    // and the policy the rest carried, not a re-resolution.
    await finalizeFailureSettle({
      failureClass: isFailureClass(standingCompensation.failureClass) ? standingCompensation.failureClass : "run_failure",
      ...(standingCompensation.failurePolicy ? { policy: standingCompensation.failurePolicy } : {}),
    });
    return;
  }

  // A decision on a publish batch finalizes the finish the publish
  // interrupted (coding PR3): the batch has already executed through
  // applyDecision when approved — its create_pull_request landed
  // through the call seam, which linked the PR to the Element and
  // wrote its steps — or it was rejected, and no call ran. Either
  // way the finish now seals exactly as it would have, with the
  // publish's outcome said on the run and on the Element's thread:
  // the PR the batch opened (read back from the code_changes link
  // the seam wrote), the decline, or the failure that stopped it.
  // An amend rest (PR4) settles the same way under its own words:
  // the PR updated, the decline, or the failure. The loop never
  // resumes: the model is done, there is no live turn.
  if (standingPublish && decisionOutcome.decided && !decisionOutcome.continued) {
    const decided = decisionOutcome.decided;
    const amendRest = standingPublish.amend;
    if (decided.approved) {
      const prResult = decided.results.find((r) => r.tool_use_id === standingPublish.prCallId);
      const failed = decided.results.filter((r) => r.is_error).length;
      if (amendRest) {
        // An amend has no PR call to land: the batch is the commit,
        // and it landed whole or it did not (PR4).
        if (failed === 0 && decided.results.length > 0) {
          await noteAmendLanded(amendRest);
        } else {
          await addStep(admin, run.id, "error", "修正が完了しませんでした",
            `承認された修正のうち ${failed} 件の呼び出しが失敗し、PR は更新されていません。パッチは成果物として残っています。`);
          if (run.element_id) {
            await admin.from("element_comments").insert({
              element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
              content: "**修正が完了しませんでした** — 承認された修正の一部が失敗し、PR は更新されていません。変更パッチは実行の成果物として残っています。",
            });
          }
        }
      } else if (prResult && !prResult.is_error) {
        await notePublishLanded(prResult.content);
      } else {
        await addStep(admin, run.id, "error", "公開が完了しませんでした",
          `承認された公開のうち ${failed} 件の呼び出しが失敗し、PR は開かれていません。パッチは成果物として残っています。`);
        if (run.element_id) {
          await admin.from("element_comments").insert({
            element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
            content: "**公開が完了しませんでした** — 承認された公開の一部が失敗し、PR は開かれていません。変更パッチは実行の成果物として残っています。",
          });
        }
      }
    } else if (amendRest) {
      await addStep(admin, run.id, "approval", "修正は却下されました", "PR は更新されていません。変更パッチは実行の成果物として残っています。");
      if (run.element_id) {
        await admin.from("element_comments").insert({
          element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
          content: "**修正は却下されました** — PR は更新されていません。変更パッチは実行の成果物として残っています。",
        });
      }
    } else {
      await addStep(admin, run.id, "approval", "公開は却下されました", "PR は開かれていません。変更パッチは実行の成果物として残っています。");
      if (run.element_id) {
        await admin.from("element_comments").insert({
          element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
          content: "**公開は却下されました** — PR は開かれていません。変更パッチは実行の成果物として残っています。",
        });
      }
    }
    await settleFinish(standingPublish.finish, standingPublish.verdict);
    return;
  }

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

  // Which check is sending a finish back, and what it read (B3): the
  // correction envelope is assembled from this at revision time. The
  // two checks below record their provenance as they answer; the
  // loop's revision hook reads it in the same turn, so it always
  // names the check that actually returned the finish.
  let returnProvenance: { source: CorrectionSource; verifyStepIdx: number | null; artifactIds: string[] } | null = null;
  let elementTitleCache: string | null = null;
  const elementTitle = async (): Promise<string> => {
    if (elementTitleCache !== null) return elementTitleCache;
    try {
      const { data: el } = await userDb.from("elements").select("title").eq("id", run.element_id).maybeSingle();
      elementTitleCache = el?.title ?? "Element";
    } catch { elementTitleCache = "Element"; }
    return elementTitleCache;
  };

  // The return the agent receives is the correction envelope (B3):
  // unit, verdict, reason, evidence, scope — assembled here, kept in
  // `corrections` for the record, and formatted as the message.
  const revisionMessage = async (verdict: Verdict, revision: number): Promise<string | null> => {
    if (!returnProvenance) return null;
    const envelope = correctionEnvelopeOf({
      unit: { id: run.element_id, title: await elementTitle() },
      source: returnProvenance.source,
      reason: verdict.gaps,
      evidence: returnProvenance,
      attempt: revision,
    });
    corrections.push(envelope);
    return formatCorrectionEnvelope(envelope);
  };

  // The mechanical check of a finish's claims, run by code at the gate
  // before the verifier is consulted (finishClaims.ts): a claim's source
  // and freshness are facts code can settle, so the model never grades
  // them. The holder keeps the latest attempt's counts — verifyFinish
  // hands them to the verifier as data, and the terminal finishRun seals
  // them into the verdict record.
  let attemptCheck: ClaimCheck | null = null;
  const freshness = freshnessTableOf(parsedAll);
  const usedReadsOf = (): boolean => state.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => {
    if (b.type === "server_tool_use") return true; // web search / fetch
    if (b.type !== "tool_use" || !b.name) return false;
    const it = integrationTools.get(b.name);
    return it ? integrationCallIsRead(it, { id: "", name: b.name, input: (b.input ?? {}) as Record<string, unknown> }) : false;
  }));
  const checkClaimsOf = (finish: FinishPayload): ClaimCheck =>
    checkFinishClaims(finish.claims ?? [], { usedReads: usedReadsOf(), freshness, now: Date.now() });
  const mechanicalCheck = async (finish: FinishPayload) => {
    attemptCheck = checkClaimsOf(finish);
    returnProvenance = { source: "mechanical", verifyStepIdx: null, artifactIds: [] };
    const gaps = [...attemptCheck.gaps];
    // The coding gate (PR2): a coding finish is judged against the
    // run's own records — the declared test command's step record and
    // the change set captured from the workspace — by the same
    // mechanical path, before any verifier is consulted. The facts
    // are gathered by the coding block below (its closures read the
    // run's asset_calls and, for the change set, its workspace).
    if (codingDecl && !run.rehearsal && !planRun) {
      const evidence = await codingEvidence().catch(() => ({ state: "missing" }) as TestEvidence);
      const changeSet = codingSession?.delivered ? await captureChangeSet().catch(() => null) : null;
      gaps.push(...codingFinishGaps({
        decl: codingDecl, outcome: finish.outcome, claims: finish.claims, summary: finish.summary,
        delivered: !!codingSession?.delivered, evidence, changeSet,
      }));
    }
    return { gaps };
  };

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
        messages: [{ role: "user", content: verifyPrompt({ element: el, intents, finish, artifacts: (arts ?? []) as { id: string; title: string; content: string }[], usedWeb, definition: definition?.body ?? null, claimCheck: attemptCheck, checksItems: parsedAll?.checks.items ?? [], outputShape: parsedAll?.output ?? null }) }],
        output_config: { effort: "low", format: { type: "json_schema", schema: VERDICT_SCHEMA } },
      // deno-lint-ignore no-explicit-any
      } as any, { signal: sliceSignal() });
      await recordUsage(res.usage ?? {});
      const text = (res.content ?? []).find((b: { type: string }) => b.type === "text")?.text ?? "";
      const verdict = readVerdict(text);
      if (verdict) {
        const stepIdx = await addStep(admin, run.id, "thought", verdict.pass ? "検証: 合格" : `検証: 不足 ${verdict.gaps.length} 点`, verdict.gaps.join("\n") || null);
        const artifactRows = (arts ?? []) as { id: string; title: string }[];
        lastCheck = {
          pass: verdict.pass, gaps: verdict.gaps, model, checkedAt: new Date().toISOString(), verifyStepIdx: stepIdx,
          artifactIds: artifactRows.map((art) => art.id),
          // v3: the same answer's scoring, aligned by code to the
          // declared Checks items and the artifacts actually shown —
          // the seal (buildRunVerdict) derives any declared item this
          // left unscored. Absent blocks stay absent here.
          checksItems: parsedAll?.checks.items ?? [],
          ...alignVerdictScoring(verdict, { checksItems: parsedAll?.checks.items ?? [], artifacts: artifactRows }),
        };
        returnProvenance = { source: "verifier", verifyStepIdx: lastCheck.verifyStepIdx, artifactIds: lastCheck.artifactIds };
      }
      return verdict;
    } catch (e) {
      console.error("run-agent: verify failed", errorMessage(e));
      return null;
    }
  };

  // B8: plan coverage at apply time. A call is covered when its canonical
  // argument key matches an unconsumed, coverable entry of the approved
  // plan — and, for every call but a sign-in, policy's own verdict is not
  // deny (a denied call is never covered, whatever the plan says: the
  // plan gate already marked it, and this is the second wall). The claim
  // happens in the gate (needsApproval), before anything in the turn
  // executes, and consumption is marked on the plan itself, which
  // saveTranscript persists — so across slices an entry covers exactly
  // one execution. A call whose arguments drifted from the plan simply
  // finds no entry and asks on its own.
  const claimPlanCover = async (call: ToolCall): Promise<PlanCall | null> => {
    if (!approvedPlan) return null;
    if (call.name !== SIGN_IN_TOOL && verdictForCall(call).base === "deny") return null;
    const key = await planCallKey(call);
    const entry = matchPlanCall(approvedPlan, key);
    if (!entry) return null;
    entry.consumed = true;
    planMatches.set(call.id, entry);
    return entry;
  };

  // Circuit breakers (B11): the pre-write check the loop consults
  // before the approval gate — §6's ordering, after manifest deny and
  // before the approval composition (plan cover, sign-in, verdicts).
  // Only manifest-command writes are judged: they are the calls with
  // a target, a quota and a record. The check reads settled call
  // records only (the log callIntegration settles at the record
  // stage), and no verdict fact is consulted — not the mode, not a
  // delegation, not a standing rule, not a track record — so none of
  // them can lift a trip. A rehearsal plans its writes and a plan run
  // records them; neither dispatches, so neither can trip.
  const breakerTripsByCallId = new Map<string, BreakerTrip>();
  const breakerHold = async (call: ToolCall): Promise<{ reason: string } | null> => {
    if (run.rehearsal || planRun || !run.activity_space_id) return null;
    const it = integrationTools.get(call.name);
    if (!it?.command || it.command.effect !== "write") return null;
    // A denied call is the policy's refusal, never the breaker's
    // question: deny stands earlier in §6's ordering and the executor
    // answers it as a refusal.
    if (verdictForCall(call).base === "deny") return null;
    const targetKey = targetKeyOf(it.command, call.input);
    const counts = await loadBreakerCounts(admin, {
      spaceId: run.activity_space_id, runId: run.id, integrationId: it.integration.id,
      targetKey, now: new Date(),
    });
    const trip = evaluateBreakers(
      { integrationId: it.integration.id, integrationName: it.integration.name, command: it.command, targetKey },
      counts,
    );
    if (!trip) return null;
    breakerTripsByCallId.set(call.id, trip);
    return { reason: trip.reason };
  };

  // ── The coding loop (PR2): tree delivery, gate facts, the patch ──
  // A run whose definition declares a code change (parsedAll.coding)
  // and bound a workspace (PR1) receives its target repository's tree
  // in that workspace before the loop starts: the server resolves
  // repo + base branch → base SHA through the Space's GitHub
  // connection and delivers a snapshot the runner unpacks
  // (codingDelivery.ts); no credential ever enters the box. Delivery
  // is once per run — its step is the record a later slice reads
  // back instead of re-delivering (the branch may have moved; the
  // patch is against the delivered base). A rehearsal never receives
  // a tree (its machine calls are recorded, not run) and a plan run's
  // coding belongs to its apply run.
  const codingDecl = parsedAll?.coding ?? null;
  // A follow-up run (PR4) carries its amend brief on the session:
  // the tree then comes from the PR's head, and the finish publishes
  // back onto the same branch instead of opening a new PR.
  let codingSession: { target: CodingTarget; baseSha: string; delivered: boolean; amend: CodingAmendBrief | null } | null = null;

  /** A server-issued shell call into the run's bound machine, on the
   *  same asset_calls queue the model's own calls travel — one path
   *  (#7). Waits a little past the runner's own per-call cap: the
   *  command itself cannot outlive it. */
  const runCodingShell = async (command: string): Promise<{ ok: boolean; exitCode: number | null; stdout: string; stderr: string }> => {
    if (!machine) return { ok: false, exitCode: null, stdout: "", stderr: "ワークスペースがつながっていません" };
    const queued = await queueAssetCall(machine, "shell", { command });
    if (!queued.ok) return { ok: false, exitCode: null, stdout: "", stderr: queued.content };
    const until = Date.now() + 55_000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 700));
      const { data: c } = await admin.from("asset_calls").select("status, result, error").eq("id", queued.id).maybeSingle();
      if (c?.status === "done") {
        const r = (c.result ?? {}) as { exit_code?: unknown; stdout?: unknown; stderr?: unknown };
        return { ok: true, exitCode: typeof r.exit_code === "number" ? r.exit_code : null, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "") };
      }
      if (c?.status === "failed") return { ok: false, exitCode: null, stdout: "", stderr: String(c.error ?? "実行役で失敗しました") };
    }
    await admin.from("asset_calls").update({ status: "expired", finished_at: new Date().toISOString() }).eq("id", queued.id).in("status", ["pending", "claimed"]);
    return { ok: false, exitCode: null, stdout: "", stderr: "時間内に答えがありませんでした" };
  };

  /** The finish gate's test evidence: this run's settled shell calls,
   *  read from asset_calls — the record, never the model's word. */
  const codingEvidence = async (): Promise<TestEvidence> => {
    const { data } = await admin.from("asset_calls").select("id, input, result, status, created_at")
      .eq("run_id", run.id).eq("tool", "shell").order("created_at", { ascending: true });
    const records: ShellCallRecord[] = ((data ?? []) as { id: string; input: unknown; result: unknown; status: string; created_at: string }[])
      .map((r) => {
        const exit = (r.result as { exit_code?: unknown } | null)?.exit_code;
        return {
          id: r.id,
          command: String((r.input as { command?: unknown } | null)?.command ?? ""),
          status: r.status,
          exitCode: typeof exit === "number" ? exit : null,
          at: r.created_at,
        };
      });
    return testEvidenceOf(records, codingDecl?.testCommand ?? null);
  };

  /** The change set, captured from the workspace at the gate / at
   *  the finish: null when the capture itself could not be read. */
  const captureChangeSet = async () => {
    const res = await runCodingShell(captureCommand());
    return res.ok ? parseChangeSet(res.stdout) : null;
  };

  /** The loop's end (design §4.2 step 6, §8): capture the change set,
   *  put its summary in the run record, and save the patch as the
   *  run's artifact — through the existing artifact machinery, not a
   *  new store. Once per run: a step of its title is the record. The
   *  change set is returned either way (a re-drive that finds the
   *  step already written re-captures without re-saving), because
   *  the publish (PR3) composes from the same capture. */
  const produceCodingPatch = async (): Promise<ChangeSet | null> => {
    if (!codingSession?.delivered || !codingDecl) return null;
    const { data: prior } = await admin.from("agent_run_steps").select("id")
      .eq("run_id", run.id).like("title", "変更パッチを保存:%").limit(1);
    const cs = await captureChangeSet().catch(() => null);
    if (!cs) {
      await addStep(admin, run.id, "error", "変更を読み取れませんでした", "ワークスペースから変更セットを読み取れなかったため、パッチは保存されませんでした。");
      return null;
    }
    if (prior?.length) return cs;
    const evidence = await codingEvidence().catch(() => ({ state: "missing" }) as TestEvidence);
    const summary = changeSetSummaryText({
      target: codingSession.target, baseSha: codingSession.baseSha, changeSet: cs, evidence,
      testCommand: codingDecl.testCommand,
    });
    if (cs.empty) {
      await addStep(admin, run.id, "artifact", "変更はありませんでした", summary);
      return cs;
    }
    const title = patchArtifactTitle(codingSession.target);
    const { data: existing } = await admin.from("agent_artifacts").select("id")
      .eq("element_id", run.element_id).eq("title", title).maybeSingle();
    const res = existing
      ? await admin.from("agent_artifacts").update({ content: cs.patch, format: "text", run_id: run.id, updated_at: new Date().toISOString() }).eq("id", existing.id).select("id").single()
      : await admin.from("agent_artifacts").insert({ element_id: run.element_id, run_id: run.id, title, content: cs.patch, format: "text", author_name: agentName }).select("id").single();
    await addStep(admin, run.id, "artifact", `変更パッチを保存: ${codingSession.target.repo}`,
      res.error ? `${summary}\n（パッチ本体の保存に失敗しました: ${res.error.message}）` : summary);
    return cs;
  };

  // ── The publish (PR3): the patch leaves through the connection ──
  // Design §4.2 step 7, §6 outbound, §7: the server composes the
  // run's verified patch into governed calls on the Space's GitHub
  // connection — branch at the delivered base, one tree commit of
  // the whole change set, the manifest's create_pull_request with
  // its verify read-back — and judges them with this run's own
  // machinery (breakerHold before verdicts, verdictForCall's
  // composition of manifest, mode, delegation and track record).
  // The calls then run through executeCall, so the call log, the
  // compensation record, the verify tally and the PR's link to the
  // Element (callIntegration's own post-step) all apply exactly as
  // for a call the model made. Nothing here is a model-facing tool,
  // and no credential enters the box: the box produced a patch, the
  // server applies it. When any call must ask — or a breaker holds
  // the batch, or the target sits outside the definition's declared
  // set (the critical class, §7) — the whole publish rests as ONE
  // pending approval carrying the finish (decision.ts' publish
  // rest), and the finish seals at the person's decision.
  type PublishOutcome = { kind: "landed" | "rested" | "refused" | "failed" };

  /** Parks the publish batch as the run's one pending approval —
   *  the compensation rest's shape (B9), for the same reason: the
   *  finish it interrupts rides with it, because the decision
   *  finalizes that settle instead of resuming a finished loop. */
  const restPublishBatch = async (
    calls: ToolCall[],
    settle: { finish: FinishPayload; verdict: RunVerdict | null; prCallId: string; amend?: { codeChangeId: string; repo: string; number: number; branch: string } },
    opts: { critical: boolean; trip: BreakerTrip | null },
  ): Promise<void> => {
    const pubPending: SavedPending = { calls, partial: [], publish: settle };
    await saveTranscript(pubPending);
    const display = displaysUnderMode(calls.map((c) => approvalDisplayFor(c)), mode);
    const trip = opts.trip;
    // An amend rests under its own name (PR4): the batch adds a
    // commit to an existing PR rather than opening one, and the
    // person judging it should read that, not "publish".
    const amend = settle.amend;
    const summary = trip ? trip.reason : `${amend ? "修正" : "公開"}の承認待ち: ${approvalSummary(display)}`;
    const inputHash = await sha256(canonicalCalls(calls));
    const { data: waiting } = await admin.from("agent_runs").update({ status: "awaiting_approval", summary })
      .eq("id", run.id).eq("status", "running").select("id").maybeSingle();
    if (!waiting) return; // cancelled meanwhile
    const { data: action } = await admin.from("agent_actions").insert({
      run_id: run.id, element_id: run.element_id, tool_use_id: calls[0].id, tool: "batch",
      input: {
        calls, display,
        publish: {
          repo: codingSession?.target.repo ?? "", critical: opts.critical,
          ...(amend ? { amend: { number: amend.number, branch: amend.branch } } : {}),
          ...(trip ? { breaker: { rule: trip.rule, target: trip.targetKey, evidence: trip.evidence } } : {}),
        },
      },
      input_hash: inputHash, summary,
      integration_id: integrationTools.get(calls[0].name)?.integration.id ?? null,
    }).select("id").single();
    if (trip) {
      // The trip's audit row, as the loop's own hold writes it: the
      // decision that answers this rest acknowledges it (the generic
      // acknowledgement in the decision path covers this run's trips).
      await admin.from("breaker_trips").insert({
        run_id: run.id, element_id: run.element_id, activity_space_id: run.activity_space_id,
        action_id: (action as { id: string } | null)?.id ?? null, rule: trip.rule,
        integration_id: trip.integrationId, integration_name: trip.integrationName,
        command_name: trip.commandName, target_key: trip.targetKey,
        evidence: trip.evidence, reason: trip.reason,
      }).then(() => {}, () => {});
    }
    await addStep(admin, run.id, "approval", summary,
      opts.critical && codingDecl ? publishCriticalReason(codingDecl, codingSession?.target.repo ?? "") : null);
    if (run.element_id) {
      await admin.from("element_comments").insert({
        element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
        content: amend
          ? `**修正の承認待ち** — ${summary}。承認すると、検証済みのパッチが GitHub 接続経由で PR ${amend.repo}#${amend.number} のブランチへ追加されます。`
          : `**公開の承認待ち** — ${summary}。承認すると、検証済みのパッチが GitHub 接続経由で適用され、PR が開かれます。`,
      });
    }
    if (run.triggered_by) {
      await admin.from("notifications").insert({
        recipient_id: run.triggered_by, actor_name: agentName, kind: "approval_requested", element_id: run.element_id,
        agent_action_id: (action as { id: string } | null)?.id ?? null,
        title: `${agentName} が${amend ? "修正" : "公開"}の承認を求めています`, body: summary,
      }).then(() => {}, () => {});
    }
  };

  /** The governed calls of a publish, resolved against the
   *  connection's declared commands: a publish exists only as the
   *  manifest declares it. Shared by the first publish and an
   *  iteration's amend (PR4) — one resolver, one route (#7). */
  const publishToolFor = (kind: PublishCommand) => {
    for (const [name, it] of integrationTools) {
      if (!isGithubRow(it.integration)) continue;
      if (publishCommandKind(it.command) === kind) return { name, it };
    }
    return null;
  };

  /**
   * Publishes one completed coding finish's patch. Every refusal is
   * a stated result on the run (and the Element's thread), never a
   * silent skip and never a partial tree: the base must not have
   * moved since delivery, the patch must prove itself whole against
   * the change set, and every base file it touches must read back
   * at the delivered base.
   */
  const publishCodingChange = async (input: {
    finish: FinishPayload; verdict: RunVerdict | null; changeSet: ChangeSet;
  }): Promise<PublishOutcome> => {
    if (!codingSession?.delivered || !codingDecl) return { kind: "refused" };
    const target = codingSession.target;
    const baseSha = codingSession.baseSha;
    // Once per run: a step of any of these titles is the record an
    // earlier attempt of this same finish already left.
    const { data: priorPublish } = await admin.from("agent_run_steps").select("id")
      .eq("run_id", run.id)
      .or("title.like.PR を開きました:%,title.like.公開の承認待ち:%,title.like.公開を止めました:%")
      .limit(1);
    if (priorPublish?.length) return { kind: "landed" };
    const refuse = async (reason: string): Promise<PublishOutcome> => {
      await addStep(admin, run.id, "error", "公開を止めました", reason);
      if (run.element_id) {
        await admin.from("element_comments").insert({
          element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
          content: `**PR は開かれていません** — ${reason}。変更パッチは実行の成果物として残っています。`,
        });
      }
      return { kind: "refused" };
    };
    if (!run.element_id) return refuse("この実行には Element がないため、PR の紐付け先がありません");
    if (input.changeSet.empty) return { kind: "refused" };

    // The base must be where delivery left it: the patch was
    // computed against that tree, and applying it over a moved base
    // would silently revert the base's own newer changes to the
    // files it touches.
    const tokens = await githubTokens(admin, run.activity_space_id).catch(() => [null] as (string | null)[]);
    let currentBase: string;
    try {
      currentBase = await fetchBaseSha(tokens, target);
    } catch (e) {
      return refuse(`ベースの現在位置を確認できませんでした: ${errorMessage(e)}`);
    }
    if (currentBase !== baseSha) {
      return refuse(`ベースブランチ ${target.baseBranch} が、ツリーを届けた時点（${baseSha.slice(0, 7)}）から ${currentBase.slice(0, 7)} へ動いています。古いベースに対するパッチを新しいベースへ公開はしません。実行し直してください`);
    }
    const patchFiles = parsePatchFiles(input.changeSet.patch);
    const baseFiles = new Map<string, { content: string; blobSha: string } | null>();
    for (const pf of patchFiles) {
      if (!pf.oldPath || pf.kind === "add") continue;
      const got = await fetchRepoFileAtSha(tokens, target, pf.oldPath, baseSha).catch(() => null);
      if (!got) return refuse(`${pf.oldPath} のベース内容を取得できませんでした`);
      if (!got.ok) {
        return refuse(got.code === "binary"
          ? `${pf.oldPath} はバイナリファイルのため、この公開では扱えません`
          : got.code === "too_large"
            ? `${pf.oldPath} が大きすぎて読み取れず、パッチを適用できません`
            : `${pf.oldPath} がベース（${baseSha.slice(0, 7)}）に見つかりませんでした`);
      }
      baseFiles.set(pf.oldPath, { content: got.content, blobSha: got.blobSha });
    }

    const title = pullRequestTitle(await elementTitle(), input.finish.summary);
    const evidence = await codingEvidence().catch(() => ({ state: "missing" }) as TestEvidence);
    const changeSummary = changeSetSummaryText({
      target, baseSha, changeSet: input.changeSet, evidence, testCommand: codingDecl.testCommand,
    });
    const composed = composePublish({
      target, branch: branchNameForRun(run.id), changeSet: input.changeSet, patchFiles, baseFiles,
      commitMessage: title,
      prTitle: title,
      prBody: pullRequestBody({ finishSummary: input.finish.summary, finishMessage: input.finish.message, changeSummary }),
    });
    if (!composed.ok) return refuse(composed.reason);
    const plan = composed.plan;

    // The governed calls, resolved against the connection's declared
    // commands: the publish exists only as the manifest declares it.
    const branchTool = publishToolFor("create_branch");
    const pushTool = plan.writes.length ? publishToolFor("push_files") : null;
    const deleteTool = plan.deletes.length ? publishToolFor("delete_file") : null;
    const prTool = publishToolFor("create_pull_request");
    if (!branchTool || !prTool || (plan.writes.length && !pushTool) || (plan.deletes.length && !deleteTool)) {
      return refuse("GitHub 接続の宣言に、公開に必要なコマンド（ブランチ作成・ファイルの一括反映・PR 作成）が揃っていません。接続テストでコマンドが宣言されているか確認してください");
    }
    const [owner, ...repoParts] = target.repo.split("/");
    const repoName = repoParts.join("/");
    const calls: ToolCall[] = [];
    const addCall = (toolName: string, callInput: Record<string, unknown>) =>
      calls.push({ id: `publish-${calls.length + 1}`, name: toolName, input: callInput });
    addCall(branchTool.name, { owner, repo: repoName, branch: plan.branch, from_branch: target.baseBranch });
    if (pushTool) {
      addCall(pushTool.name, {
        owner, repo: repoName, branch: plan.branch, files: plan.writes, message: plan.commitMessage,
      });
    }
    if (deleteTool) {
      for (const d of plan.deletes) {
        addCall(deleteTool.name, { owner, repo: repoName, path: d.path, message: plan.commitMessage, branch: plan.branch, sha: d.sha });
      }
    }
    addCall(prTool.name, {
      owner, repo: repoName, title: plan.pr.title, body: plan.pr.body, head: plan.pr.head, base: plan.pr.base,
    });
    const prCallId = calls[calls.length - 1].id;

    // Judged as any manifest write is judged — the breaker before
    // the verdict, the verdict the run's own composition — plus the
    // one class that is this seam's own: a target outside the
    // definition's declared set always rests (design §7), whatever
    // the mode, the delegation or the track record says.
    const critical = publishIsCritical(codingDecl, target.repo);
    let trip: BreakerTrip | null = null;
    let mustRest = critical;
    for (const call of calls) {
      const hold = await breakerHold(call);
      if (hold && !trip) trip = breakerTripsByCallId.get(call.id) ?? null;
      const v = verdictForCall(call);
      if (v.base === "deny") {
        const it = integrationTools.get(call.name);
        const refusal = chainDeniedCalls.has(call.id)
          ? chainDenyRefusal(it?.integration.name ?? call.name, it ? operationOf(it, call.input) : call.name)
          : it?.command ? manifestDenyRefusal(it.command.name) : "公開の呼び出しがポリシーで拒否されました";
        return refuse(`公開の呼び出しが拒否されました: ${refusal}`);
      }
      if (v.final === "ask") mustRest = true;
    }
    if (trip) mustRest = true;
    if (mustRest) {
      await restPublishBatch(calls, { finish: input.finish, verdict: input.verdict, prCallId }, { critical, trip });
      return { kind: "rested" };
    }

    // Nothing held the batch: it runs now, with the loop's own
    // bookkeeping for the asks it lifts — a policy approval for the
    // mode's or the track record's lift, the delegation disclosure
    // for full delegation's.
    const landed: string[] = [];
    for (const call of calls) {
      const it = integrationTools.get(call.name);
      const v = verdictForCall(call);
      let publishPolicyActionId: string | null = null;
      if (v.base === "ask" && (mode === "free" || v.lift === "track-record")) {
        const display = approvalDisplayFor(call);
        publishPolicyActionId = await recordPolicyApproval(admin, {
          runId: run.id, elementId: run.element_id, call, display, mode,
          integrationId: it?.integration.id ?? null,
          ...(v.lift === "track-record" ? { source: "track-record" as const } : {}),
        });
        await addStep(admin, run.id, "approval", `ポリシー承認で実行: ${approvalSummary([display])}`,
          v.lift === "track-record"
            ? "この公開の呼び出しは、これまで問題なく完了した実績により、承認を求めずに実行しました。記録はポリシー承認（実績）として残ります。"
            : "Space の承認モード（自由行動）により、承認を求めずに実行しました。");
      } else if (v.final === "allow" && liftOf(factsForCall(call)) === "delegation") {
        liftedDisplays.push(approvalDisplayFor(call));
      }
      const r = await executeCall(call);
      if (publishPolicyActionId) await settlePolicyApproval(admin, publishPolicyActionId, !r.is_error, r.verify);
      if (r.is_error) {
        await flushLifted();
        const doneText = landed.length ? `すでに実行された呼び出し: ${landed.join("、")}。` : "";
        await addStep(admin, run.id, "error", "公開が完了しませんでした",
          `${it?.integration.name ?? ""}: ${operationOf(it, call.input)} が失敗しました: ${r.content.slice(0, 300)}。${doneText}パッチは成果物として残っています。`);
        if (run.element_id) {
          await admin.from("element_comments").insert({
            element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
            content: `**公開が完了しませんでした** — ${operationOf(it, call.input)} が失敗しました。${doneText}変更パッチは実行の成果物として残っています。`,
          });
        }
        return { kind: "failed" };
      }
      landed.push(operationOf(it, call.input));
      if (publishCommandKind(it?.command) === "create_pull_request") {
        await notePublishLanded(r.content);
      }
    }
    await flushLifted();
    return { kind: "landed" };
  };

  /** Records an amend that landed: the code_changes row is read
   *  back from GitHub (its head moved to the amend's commit, its
   *  counts are the PR's new truth) and the run's step names the
   *  update. A read-back that fails does not unland the commit —
   *  the step then stands on the push's own result, and says so. */
  const noteAmendLanded = async (brief: { repo: string; number: number; branch: string }): Promise<void> => {
    const ref: PullRef = { repo: brief.repo, number: brief.number };
    let refreshed = false;
    if (run.element_id) {
      try {
        const tokens = await githubTokens(admin, run.activity_space_id).catch(() => [null] as (string | null)[]);
        const pull = await withGithubToken(tokens, (t) => fetchPull(ref, t));
        await upsertCodeChange(admin, run.element_id, ref, pull, { linkedBy: user.id, via: "agent", runId: run.id });
        refreshed = true;
      } catch (e) {
        console.error("run-agent: amend read-back failed", errorMessage(e));
      }
    }
    await addStep(admin, run.id, "pull_request", `PR を更新しました: ${brief.repo}#${brief.number}`,
      refreshed
        ? `検証済みのパッチを、PR のブランチ ${brief.branch} への追加コミットとして公開しました。PR の記録を読み戻して更新しています。`
        : `検証済みのパッチを、PR のブランチ ${brief.branch} への追加コミットとして公開しました（PR の記録の読み戻しはできませんでした）。`);
  };

  /**
   * Publishes one follow-up finish's patch as an added commit on
   * its PR's existing branch (coding PR4). The same publish path as
   * the first publish — the same patch-integrity composition
   * (composeAmend shares resolvePublishWrites), the same manifest
   * calls resolved the same way, the same judging (breaker before
   * verdict, the critical law for a target outside the declared
   * set), the same rest when a call must ask — with the differences
   * the shape itself dictates: no branch is created and no PR is
   * opened; the base the patch applies against is the PR head the
   * tree was delivered at, and the head must not have moved since.
   */
  const publishCodingAmend = async (input: {
    finish: FinishPayload; verdict: RunVerdict | null; changeSet: ChangeSet;
  }): Promise<PublishOutcome> => {
    const brief = codingSession?.amend ?? null;
    if (!codingSession?.delivered || !codingDecl || !brief) return { kind: "refused" };
    const target = codingSession.target;
    const headSha = codingSession.baseSha;
    // Once per run, as the first publish's guard: a step of any of
    // these titles is the record an earlier attempt already left.
    const { data: priorAmend } = await admin.from("agent_run_steps").select("id")
      .eq("run_id", run.id)
      .or("title.like.PR を更新しました:%,title.like.修正の承認待ち:%,title.like.修正を止めました:%")
      .limit(1);
    if (priorAmend?.length) return { kind: "landed" };
    const refuse = async (reason: string): Promise<PublishOutcome> => {
      await addStep(admin, run.id, "error", "修正を止めました", reason);
      if (run.element_id) {
        await admin.from("element_comments").insert({
          element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
          content: `**PR は更新されていません** — ${reason}。変更パッチは実行の成果物として残っています。`,
        });
      }
      return { kind: "refused" };
    };
    if (!run.element_id) return refuse("この実行には Element がないため、PR の紐付け先がありません");
    if (input.changeSet.empty) return { kind: "refused" };

    // The head must be where delivery left it: the patch was
    // computed against the head's tree, and a head that moved (a
    // person's own push, another amend) makes this patch a stranger
    // to the branch it would land on.
    const tokens = await githubTokens(admin, run.activity_space_id).catch(() => [null] as (string | null)[]);
    const ref: PullRef = { repo: brief.repo, number: brief.number };
    let pull: GithubPull;
    try {
      pull = await withGithubToken(tokens, (t) => fetchPull(ref, t));
    } catch (e) {
      return refuse(`PR の現在の状態を確認できませんでした: ${errorMessage(e)}`);
    }
    if (pull.state !== "open") {
      return refuse(`PR ${brief.repo}#${brief.number} はすでに ${pull.state === "merged" ? "マージ" : "クローズ"}されているため、修正は追加しません`);
    }
    if (pull.head_sha !== headSha) {
      return refuse(`PR のヘッドが、ツリーを届けた時点（${headSha.slice(0, 7)}）から ${pull.head_sha?.slice(0, 7) ?? "不明"} へ動いています。古いヘッドに対するパッチを新しいヘッドへは追加しません。実行し直してください`);
    }
    if (pull.head_ref !== brief.branch) {
      return refuse(`PR のブランチが、届けた時点の ${brief.branch} から ${pull.head_ref ?? "不明"} へ変わっています`);
    }
    const patchFiles = parsePatchFiles(input.changeSet.patch);
    const baseFiles = new Map<string, { content: string; blobSha: string } | null>();
    for (const pf of patchFiles) {
      if (!pf.oldPath || pf.kind === "add") continue;
      const got = await fetchRepoFileAtSha(tokens, target, pf.oldPath, headSha).catch(() => null);
      if (!got) return refuse(`${pf.oldPath} のヘッド内容を取得できませんでした`);
      if (!got.ok) {
        return refuse(got.code === "binary"
          ? `${pf.oldPath} はバイナリファイルのため、この修正では扱えません`
          : got.code === "too_large"
            ? `${pf.oldPath} が大きすぎて読み取れず、パッチを適用できません`
            : `${pf.oldPath} がヘッド（${headSha.slice(0, 7)}）に見つかりませんでした`);
      }
      baseFiles.set(pf.oldPath, { content: got.content, blobSha: got.blobSha });
    }

    const composed = composeAmend({ changeSet: input.changeSet, patchFiles, baseFiles });
    if (!composed.ok) return refuse(composed.reason);
    const plan = composed.plan;

    const pushTool = plan.writes.length ? publishToolFor("push_files") : null;
    const deleteTool = plan.deletes.length ? publishToolFor("delete_file") : null;
    if ((plan.writes.length && !pushTool) || (plan.deletes.length && !deleteTool)) {
      return refuse("GitHub 接続の宣言に、修正に必要なコマンド（ファイルの一括反映・削除）が揃っていません。接続テストでコマンドが宣言されているか確認してください");
    }
    const [owner, ...repoParts] = target.repo.split("/");
    const repoName = repoParts.join("/");
    const message = amendCommitMessage(await elementTitle(), brief.number);
    const calls: ToolCall[] = [];
    const addCall = (toolName: string, callInput: Record<string, unknown>) =>
      calls.push({ id: `publish-${calls.length + 1}`, name: toolName, input: callInput });
    if (pushTool) {
      addCall(pushTool.name, {
        owner, repo: repoName, branch: brief.branch, files: plan.writes, message,
      });
    }
    if (deleteTool) {
      for (const d of plan.deletes) {
        addCall(deleteTool.name, { owner, repo: repoName, path: d.path, message, branch: brief.branch, sha: d.sha });
      }
    }
    const firstCallId = calls[0].id;

    // Judged exactly as the first publish is judged — the breaker
    // before the verdict, the verdict the run's own composition,
    // and the critical law over both.
    const critical = publishIsCritical(codingDecl, target.repo);
    let trip: BreakerTrip | null = null;
    let mustRest = critical;
    for (const call of calls) {
      const hold = await breakerHold(call);
      if (hold && !trip) trip = breakerTripsByCallId.get(call.id) ?? null;
      const v = verdictForCall(call);
      if (v.base === "deny") {
        const it = integrationTools.get(call.name);
        const refusal = chainDeniedCalls.has(call.id)
          ? chainDenyRefusal(it?.integration.name ?? call.name, it ? operationOf(it, call.input) : call.name)
          : it?.command ? manifestDenyRefusal(it.command.name) : "修正の呼び出しがポリシーで拒否されました";
        return refuse(`修正の呼び出しが拒否されました: ${refusal}`);
      }
      if (v.final === "ask") mustRest = true;
    }
    if (trip) mustRest = true;
    if (mustRest) {
      await restPublishBatch(calls, {
        finish: input.finish, verdict: input.verdict, prCallId: firstCallId,
        amend: { codeChangeId: brief.codeChangeId, repo: brief.repo, number: brief.number, branch: brief.branch },
      }, { critical, trip });
      return { kind: "rested" };
    }

    const landed: string[] = [];
    for (const call of calls) {
      const it = integrationTools.get(call.name);
      const v = verdictForCall(call);
      let publishPolicyActionId: string | null = null;
      if (v.base === "ask" && (mode === "free" || v.lift === "track-record")) {
        const display = approvalDisplayFor(call);
        publishPolicyActionId = await recordPolicyApproval(admin, {
          runId: run.id, elementId: run.element_id, call, display, mode,
          integrationId: it?.integration.id ?? null,
          ...(v.lift === "track-record" ? { source: "track-record" as const } : {}),
        });
        await addStep(admin, run.id, "approval", `ポリシー承認で実行: ${approvalSummary([display])}`,
          v.lift === "track-record"
            ? "この修正の呼び出しは、これまで問題なく完了した実績により、承認を求めずに実行しました。記録はポリシー承認（実績）として残ります。"
            : "Space の承認モード（自由行動）により、承認を求めずに実行しました。");
      } else if (v.final === "allow" && liftOf(factsForCall(call)) === "delegation") {
        liftedDisplays.push(approvalDisplayFor(call));
      }
      const r = await executeCall(call);
      if (publishPolicyActionId) await settlePolicyApproval(admin, publishPolicyActionId, !r.is_error, r.verify);
      if (r.is_error) {
        await flushLifted();
        const doneText = landed.length ? `すでに実行された呼び出し: ${landed.join("、")}。` : "";
        await addStep(admin, run.id, "error", "修正が完了しませんでした",
          `${it?.integration.name ?? ""}: ${operationOf(it, call.input)} が失敗しました: ${r.content.slice(0, 300)}。${doneText}パッチは成果物として残っています。`);
        if (run.element_id) {
          await admin.from("element_comments").insert({
            element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
            content: `**修正が完了しませんでした** — ${operationOf(it, call.input)} が失敗しました。${doneText}変更パッチは実行の成果物として残っています。`,
          });
        }
        return { kind: "failed" };
      }
      landed.push(operationOf(it, call.input));
    }
    await flushLifted();
    await noteAmendLanded(brief);
    return { kind: "landed" };
  };

  if (codingDecl && machine && !run.rehearsal && !planRun) {
    try {
      const { data: priorSteps } = await admin.from("agent_run_steps").select("detail")
        .eq("run_id", run.id).like("title", "コードを受け取りました:%")
        .order("idx", { ascending: false }).limit(1);
      const prior = parseDeliveryDetail((priorSteps?.[0] as { detail?: string | null } | undefined)?.detail);
      if (prior) {
        codingSession = { target: { repo: prior.repo, baseBranch: prior.baseBranch }, baseSha: prior.baseSha, delivered: true, amend: codingAmendBrief };
      } else if (codingAmendBrief) {
        // A follow-up run's delivery (PR4): the target is the brief's
        // PR, the tree is its head's as the router recorded it — the
        // declared set still governs (a definition changed since the
        // PR opened narrows this run exactly as it would a first
        // run), and the SHA is fixed, never re-resolved to wherever
        // the branch has moved since.
        const brief = codingAmendBrief;
        const inSet = codingDecl.repositories.some((r) => r.toLowerCase() === brief.repo.toLowerCase());
        if (!inSet) {
          await addStep(admin, run.id, "error", "コードを届けられませんでした", targetRefusalText("repo_outside_set", codingDecl));
        } else {
          const target: CodingTarget = { repo: brief.repo, baseBranch: brief.branch };
          const out = await deliverTreeAtShaToWorkspace({
            admin, runId: run.id, spaceId: run.activity_space_id, target, sha: brief.headSha, runShell: runCodingShell,
          });
          if (out.ok) {
            codingSession = { target, baseSha: out.baseSha, delivered: true, amend: brief };
            await addStep(admin, run.id, "action", deliveryStepTitle(target, out.baseSha),
              [`repo=${target.repo}`, `base=${target.baseBranch}`, `sha=${out.baseSha}`, `amend=${brief.codeChangeId}`, `pr=${brief.number}`, `event=${brief.eventKind}`, out.files != null ? `${out.files} ファイル` : ""].filter(Boolean).join("\n"));
          } else {
            await addStep(admin, run.id, "error", "コードを届けられませんでした",
              `${target.repo}（${target.baseBranch}）のツリー取得に失敗しました（理由コード: ${out.code}）。${out.detail}`);
          }
        }
      } else {
        const texts: string[] = [];
        if (run.element_id) {
          const { data: el } = await userDb.from("elements").select("title, description").eq("id", run.element_id).maybeSingle();
          if (el) texts.push(`${(el as { title?: string }).title ?? ""}\n${(el as { description?: string | null }).description ?? ""}`);
        }
        const resolved = resolveCodingTarget(codingDecl, texts);
        if (!resolved.ok) {
          await addStep(admin, run.id, "error", "コードを届けられませんでした", targetRefusalText(resolved.reason, codingDecl));
        } else {
          const out = await deliverTreeToWorkspace({
            admin, runId: run.id, spaceId: run.activity_space_id, target: resolved.target, runShell: runCodingShell,
          });
          if (out.ok) {
            codingSession = { target: resolved.target, baseSha: out.baseSha, delivered: true, amend: null };
            await addStep(admin, run.id, "action", deliveryStepTitle(resolved.target, out.baseSha),
              [`repo=${resolved.target.repo}`, `base=${resolved.target.baseBranch}`, `sha=${out.baseSha}`, out.files != null ? `${out.files} ファイル` : ""].filter(Boolean).join("\n"));
          } else {
            await addStep(admin, run.id, "error", "コードを届けられませんでした",
              `${resolved.target.repo}（${resolved.target.baseBranch}）のツリー取得に失敗しました（理由コード: ${out.code}）。${out.detail}`);
          }
        }
      }
    } catch (e) {
      // A delivery problem never breaks the run: it goes on without a
      // tree, and the finish gate refuses its "completed" in the open.
      console.error("run-agent: coding delivery failed", errorMessage(e));
    }
  }

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
    breakerHold,
    // The give-up judgement (B13): the run's failure counts against
    // the declared caps, asked at every loop head. A plan run's calls
    // are records, not executions, so its patience is never spent.
    ...(planRun ? {} : { giveUp: currentGiveUp }),
    // A rehearsal never asks: its writes are blocked, not approved, so
    // nothing waits for a person mid-trial. A plan run never asks either:
    // its writes are recorded, not approved, and the plan as a whole is
    // the approval the person gives. An apply run asks for anything the
    // approved plan does not cover (claimPlanCover).
    needsApproval: async (call) => {
      if (run.rehearsal || planRun) return false;
      if (approvedPlan && (await claimPlanCover(call))) return false;
      if (call.name === SIGN_IN_TOOL) {
        // D6: only the ask mode ever holds a sign-in, and only a
        // stored credential's first-ever use. The verdict machinery's
        // facts cannot see this — it rests on the runner's page and
        // the audit trail — so it is judged here, from the same
        // server-side resolution the executor will use, and cached
        // for the card and the call. An unreadable trail reads as
        // never-used: when consent cannot be disproven, it is asked.
        if (mode !== "ask" || !runner || !run.activity_space_id) return false;
        const resolved = await resolveSignInTarget(call).catch(() => null);
        if (!resolved) return false;
        signInGate.set(call.id, resolved.target);
        const usedBefore = resolved.target.stored
          ? await hasSignInUse(admin, resolved.target.stored.id).catch(() => false)
          : false;
        return signInNeedsAsk({ mode, target: resolved.target, usedBefore });
      }
      return verdictForCall(call).final === "ask";
    },
    execute: async (call) => {
      // The rehearsal gate stands in front of every executor: a call in
      // a rehearsal run can only ever read, plan, or keep the run's own
      // books — the approval composition below is never reached.
      if (run.rehearsal) return await rehearsalGate(call);
      // The plan gate, likewise: a plan run's writes are recorded, never
      // executed, and the approval composition is never reached.
      if (planRun) return await planGate(call);
      // B8: a call the approved plan covers. Its premise is re-checked
      // first where the plan recorded one: the verify pre-state is
      // re-read, and a drifted premise fails the call closed with the
      // diff on the record — the plan was approved against the state it
      // saw. The execution itself is recorded as a plan approval (the
      // policy-approval discipline: the only code that lifts an ask
      // writes its row first), settled with the call's outcome.
      const covered = planMatches.get(call.id);
      if (covered) {
        const cit = integrationTools.get(call.name);
        // B10 (§5.3, apply time): the covered call is asserted
        // against the fence before it runs. The scope is immutable,
        // so this holds by construction — claimPlanCover already
        // refused to cover a call whose base verdict is a deny —
        // but an approval must never be able to widen a binding, so
        // the assert is made here too, and if it is ever reached it
        // fails closed the way a drifted premise does.
        if (runScope && cit) {
          const chainFact = chainFactFor(runScope, cit, call);
          if (chainFact && !chainFact.inScope) {
            const text = chainDenyRefusal(cit.integration.name, operationOf(cit, call.input));
            const chainActionId = await recordPlanApproval(admin, {
              runId: run.id, elementId: run.element_id, call, display: covered.display,
              planActionId: approvedPlan?.actionId ?? null,
              integrationId: cit.integration.id, decidedBy: run.triggered_by,
            });
            if (chainActionId) await settlePlanApproval(admin, chainActionId, false, { chainDenied: true });
            await addStep(admin, run.id, "approval", `連鎖の範囲外のため実行しません: ${covered.label}`, text);
            chainDeniedCount++;
            return { content: text, is_error: true };
          }
        }
        if (cit && covered.expected) {
          const drift = await checkPlanDrift(cit, call, covered.expected);
          if (drift && drift.length) {
            const text = `計画の前提が変わっています（${verifyDiffText(drift)}）。計画は計画時の状態に対して承認されたため、この呼び出しは実行しません。現在の状態を確認し、必要なら計画を立て直してください。`;
            const driftActionId = await recordPlanApproval(admin, {
              runId: run.id, elementId: run.element_id, call, display: covered.display,
              planActionId: approvedPlan?.actionId ?? null,
              integrationId: cit.integration.id, decidedBy: run.triggered_by,
            });
            if (driftActionId) await settlePlanApproval(admin, driftActionId, false, { drift });
            await addStep(admin, run.id, "approval", `計画の前提が変化: ${covered.label}`, text);
            return { content: text, is_error: true };
          }
        }
        const planActionId = await recordPlanApproval(admin, {
          runId: run.id, elementId: run.element_id, call, display: covered.display,
          planActionId: approvedPlan?.actionId ?? null,
          integrationId: cit?.integration.id ?? null, decidedBy: run.triggered_by,
        });
        await addStep(admin, run.id, "approval", `計画により自動実行: ${covered.label}`,
          "承認済みの計画に挙がった呼び出し（引数が一致）のため、承認を求めずに実行しました。");
        const r = await executeCall(call);
        if (planActionId) await settlePlanApproval(admin, planActionId, !r.is_error, { verify: r.verify });
        return r;
      }
      const v = verdicts.get(call.id);
      // A deny verdict is refused here, by the policy itself: the call is
      // never dispatched, so no executor path can grow around the
      // refusal. (Each executor still rechecks at the moment it runs —
      // an approval given before a rule denied these arguments must not
      // carry them through the decision path, which never passes here.)
      if (v?.final === "deny") {
        // B10: the fence's refusal, worded as the fence's. When a
        // call is refused twice over (the fence and the manifest),
        // the chain reason is the recorded one — it was judged
        // first, and it is the one that tells the model the truth:
        // no argument change inside this run can move it.
        if (chainDeniedCalls.has(call.id)) {
          const deniedTool = integrationTools.get(call.name);
          const refusal = chainDenyRefusal(
            deniedTool?.integration.name ?? call.name,
            deniedTool ? operationOf(deniedTool, call.input) : call.name,
          );
          await addStep(admin, run.id, "action", `${deniedTool?.integration.name ?? call.name}: ${deniedTool ? operationOf(deniedTool, call.input) : call.name}`, refusal.slice(0, 500));
          chainDeniedCount++;
          return { content: refusal, is_error: true };
        }
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
      // The free mode lifted this call's ask — or its earned track
      // record did (B7): either way it runs as a policy approval —
      // recorded before it runs, settled when it lands, and announced
      // when the call is critical, so what ran unasked is as visible
      // as what a person approved. The record's decision_source names
      // which lift it was: the mode's, or the action's own record.
      let policyActionId: string | null = null;
      if (v && v.base === "ask" && (mode === "free" || v.lift === "track-record")) {
        const display = approvalDisplayFor(call);
        const summary = approvalSummary([display]);
        const byTrackRecord = v.lift === "track-record";
        policyActionId = await recordPolicyApproval(admin, {
          runId: run.id, elementId: run.element_id, call, display, mode,
          integrationId: integrationTools.get(call.name)?.integration.id ?? null,
          ...(byTrackRecord ? { source: "track-record" as const } : {}),
        });
        if (byTrackRecord) {
          const it = integrationTools.get(call.name);
          const clean = grantFactFor(autonomyGrants, it?.integration.id, it?.command?.name)?.clean ?? 0;
          await addStep(admin, run.id, "approval", `実績により自動実行: ${summary}`,
            `この操作は、これまで問題なく完了した実績（${clean} 回）により、承認を求めずに実行しました。記録はポリシー承認（実績）として残ります。`);
        } else {
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
      if (policyActionId) await settlePolicyApproval(admin, policyActionId, !r.is_error, r.verify);
      return r;
    },
    onUsage: recordUsage,
    verify: run.mode === "reply" || external || planRun ? undefined : verifyFinish,
    mechanicalCheck: run.mode === "reply" || external || planRun ? undefined : mechanicalCheck,
    revisionMessage: run.mode === "reply" || external || planRun ? undefined : revisionMessage,
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
      // Coding PR2: the loop ends in a patch — before the finish
      // seals (whichever settle path it takes below), the change set
      // is captured and the patch lands as the run's artifact, with
      // its summary in the record. Best effort like every record
      // here: a failed production says so on a step, never unmakes
      // the finish. The capture is kept: the publish (PR3) composes
      // from the same change set.
      let codingChangeSet: ChangeSet | null = null;
      if (codingSession?.delivered && codingDecl && !planRun && !run.rehearsal) {
        codingChangeSet = await produceCodingPatch().catch((e) => {
          console.error("run-agent: patch production failed", errorMessage(e));
          return null;
        });
      }
      // B8: a plan run that recorded writes seals its plan as ONE approval
      // unit and waits for the person's decision on the whole — the plan
      // is the deliverable, so there is no verdict and no Element move.
      // An empty plan (the work needed no writes) settles as a normal
      // finish below, with a null verdict like a reply run's.
      if (planRun && planDraft.length) {
        const displays = planDraft.map((p) => p.display);
        const summary = `計画: ${approvalSummary(displays)}`;
        const hash = await planHashOf(planDraft.map((p) => p.call));
        const { data: planAction, error: planErr } = await admin.from("agent_actions").insert({
          run_id: run.id, element_id: run.element_id, tool_use_id: "plan", tool: "plan",
          input: { calls: planDraft.map((p) => p.call), display: displays, plan: true },
          input_hash: hash, summary,
          integration_id: planDraft.map((p) => integrationTools.get(p.call.name)?.integration.id).find((x) => x) ?? null,
        }).select("id").single();
        if (planErr || !planAction) throw new Error(`計画を保存できませんでした: ${planErr?.message ?? "unknown"}`);
        sealedPlan = { v: 1, planRunId: run.id, actionId: (planAction as { id: string }).id, hash, calls: planDraft };
        await saveTranscript();
        const { data: waiting } = await admin.from("agent_runs").update({ status: "awaiting_approval", summary: "計画の承認待ち" }).eq("id", run.id).eq("status", "running").select("id").maybeSingle();
        if (!waiting) return; // cancelled meanwhile
        await addStep(admin, run.id, "approval", `計画の承認待ち: ${approvalSummary(displays)}`,
          planDraft.map((p, i) => `${i + 1}. ${p.label}${p.denied ? "（ポリシーで拒否 — 承認しても実行されません）" : ""}${p.problem ? `（組み立ての問題: ${p.problem}）` : ""}`).join("\n"));
        await admin.from("element_comments").insert({
          element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
          content: `**計画の承認待ち** — ${approvalSummary(displays)}。計画全体を確認して、承認すれば計画どおりに適用します。`,
        });
        if (run.triggered_by) {
          await admin.from("notifications").insert({
            recipient_id: run.triggered_by, actor_name: agentName, kind: "approval_requested", element_id: run.element_id,
            title: `${agentName} が計画の承認を求めています`, body: summary,
          }).then(() => {}, () => {});
        }
        return;
      }
      await saveTranscript();
      // A reply run's finish is a reply, not checked work: its verdict stays
      // null. Any other run's record is built from the verifier's holder —
      // a checked pass/fail, or an honest "unchecked" with its reason. The
      // claim accounting is recomputed from the standing finish itself:
      // the counts describe that finish, whatever path it took to stand.
      // The record also seals the run's correction history (B3) and the
      // hash of the Element's inputs as they stand at this finish — the
      // pair the unit-return rule later compares at dispatch.
      let inputsHash: string | null = null;
      if (run.mode !== "reply" && run.element_id) {
        const { data: elNow } = await userDb.from("elements").select("title, description").eq("id", run.element_id).maybeSingle();
        if (elNow) {
          inputsHash = await sha256(elementInputsCanonical({
            title: elNow.title as string, description: (elNow.description as string | null) ?? null,
            definitionBody: definition?.body ?? null,
          }));
        }
      }
      const verdict = run.mode === "reply" || planRun ? null : buildRunVerdict({
        lastCheck, checkAttempted, revisions: state.revisions ?? 0, finish: outcome.finish, external,
        claimCheck: checkClaimsOf(outcome.finish),
        verifyTally,
        corrections,
        inputsHash,
        // B10: the fence's refusals in this slice, counted as they
        // were delivered — the record carries the block only when
        // the fence actually refused something.
        chainDenied: chainDeniedCount,
      });
      // The compensation pass (B9): a finish that failed — a partial
      // or blocked outcome, or a completed one the verifier marked
      // fail — settles its landed writes before the finish seals.
      // The pass runs the rollback now (auto), holds it as one batch
      // (ask: the run rests here, and the person's decision finalizes
      // this settle), or only reports it (never); the finish then
      // seals with the outcome in its record. A rehearsal landed no
      // real writes, and a plan run's finish is a plan, not a failure
      // (its apply run compensates its own failures) — neither fires.
      if ((outcome.finish.outcome !== "completed" || verdict?.result === "fail") && !run.rehearsal && !planRun) {
        // The settle's class (B13 §2.2): a failing verdict is judged
        // by its claims; a finish that merely fell short reads the
        // run's own call records. The class and its policy govern
        // the pass, and — once the settle finalizes — its record
        // and its escalation.
        const failureClass = await classifySettledFailure(admin, {
          runId: run.id, path: "finish",
          verdictResult: verdict?.result ?? null,
          claimsStale: checkClaimsOf(outcome.finish).counts.stale,
        });
        const failurePolicy = resolveFailurePolicy({ class: failureClass, definition: parsedAll, entries: failureEntries });
        const compOutcome = await runFailureCompensation(failureClass);
        if (compOutcome.kind === "rest") {
          await restCompensationBatch(compOutcome,
            { kind: "finish", finish: outcome.finish, verdict }, outcome.finish.summary,
            { failureClass, policy: failurePolicy });
          return;
        }
        await settleFinish(outcome.finish, verdict, compOutcome.report);
        await finalizeFailureSettle({ failureClass, policy: failurePolicy });
        return;
      }
      // Coding PR3: a completed coding finish (the only kind that
      // reaches here — a shortfall or a failed verdict settles
      // through the compensation branch above) publishes its patch
      // through the GitHub connection before it seals: the PR is
      // the run's output (design §4.2 step 7). A publish that must
      // ask rests the run on its batch, and the finish seals at the
      // person's decision instead (the publish rest's finalize,
      // before the loop). A refused or failed publish is a stated
      // result on the run; the finish seals regardless — the work
      // stands, its patch artifact remains.
      if (codingSession?.delivered && codingDecl && codingChangeSet && !codingChangeSet.empty) {
        // A follow-up run's finish amends its PR instead (PR4): the
        // same patch, the same governance, an added commit on the
        // PR's branch rather than a new PR.
        const pub = await (codingSession.amend
          ? publishCodingAmend({ finish: outcome.finish, verdict, changeSet: codingChangeSet })
          : publishCodingChange({ finish: outcome.finish, verdict, changeSet: codingChangeSet }))
          .catch((e) => {
            console.error("run-agent: publish failed", errorMessage(e));
            return null;
          });
        if (pub?.kind === "rested") return;
      }
      await settleFinish(outcome.finish, verdict);
      return;
    }

    case "approval": {
      await flushLifted();
      await saveTranscript(outcome.pending);
      const calls = outcome.pending.calls;
      // A circuit-breaker trip rests exactly like an approval wait —
      // the same pending decision, the same answer path — but what the
      // person is told is the trip: its reason is the action's summary
      // and the run's one line, one breaker_trips row records it for
      // audit, and the marker rides the action's input so every
      // surface (and the heartbeat, which skips these actions in
      // favour of the trip signal) knows this wait is a breaker hold.
      const breakerTrip = outcome.breaker ? breakerTripsByCallId.get(outcome.breaker.call.id) ?? null : null;
      const display = displaysUnderMode(calls.map((c) => approvalDisplayFor(c)), mode);
      const summary = breakerTrip ? breakerTrip.reason : approvalSummary(display);
      const inputHash = await sha256(canonicalCalls(calls));
      const { data: waiting } = await admin.from("agent_runs").update(
        breakerTrip ? { status: "awaiting_approval", summary } : { status: "awaiting_approval" },
      ).eq("id", run.id).eq("status", "running").select("id").maybeSingle();
      if (!waiting) return; // cancelled meanwhile
      const actionRow = {
        run_id: run.id, element_id: run.element_id, tool_use_id: calls[0].id, tool: calls.length === 1 ? calls[0].name : "batch",
        input: breakerTrip
          ? { calls, display, breaker: { rule: breakerTrip.rule, target: breakerTrip.targetKey, evidence: breakerTrip.evidence } }
          : { calls, display },
        input_hash: inputHash, summary, integration_id: integrationTools.get(calls[0].name)?.integration.id ?? null,
      };
      let actionId: string | null = null;
      if (breakerTrip) {
        const { data: inserted } = await admin.from("agent_actions").insert(actionRow).select("id").single();
        actionId = (inserted as { id: string } | null)?.id ?? null;
        // The trip's audit row. Best effort like the notification
        // below: the wait itself already stands, and a missing row
        // loses the drill-down, never the pause.
        await admin.from("breaker_trips").insert({
          run_id: run.id, element_id: run.element_id, activity_space_id: run.activity_space_id,
          action_id: actionId, rule: breakerTrip.rule, integration_id: breakerTrip.integrationId,
          integration_name: breakerTrip.integrationName, command_name: breakerTrip.commandName,
          target_key: breakerTrip.targetKey, evidence: breakerTrip.evidence, reason: breakerTrip.reason,
        }).then(() => {}, () => {});
        await addStep(admin, run.id, "approval", summary,
          "承認すれば、このターンの書き込みをそのまま続行します。却下すれば、このターンの書き込みは実行されません。");
        await admin.from("element_comments").insert({
          element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
          content: `**サーキットブレーカーで停止** — ${summary}。内容を確認して、承認すれば続行、却下すれば停止します。`,
        });
        if (run.triggered_by) {
          await admin.from("notifications").insert({
            recipient_id: run.triggered_by, actor_name: agentName, kind: "approval_requested", element_id: run.element_id,
            agent_action_id: actionId, title: `${agentName} がサーキットブレーカーで停止しました`, body: summary,
          }).then(() => {}, () => {});
        }
        return;
      }
      await admin.from("agent_actions").insert(actionRow);
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

    case "question": {
      await flushLifted();
      // The run rests on its question ticket(s) (B12): the paused
      // turn rides the transcript with the ticket each call filed,
      // the run's one line is the question's short form (what the
      // Chain's waiting display reads), and each ticket raises its
      // own Inbox item — the question, its options as tappable
      // answers, its context — because two questions are two asks,
      // and neither may be lost in the other's shadow. Dependents
      // wait by the graph's own rule: this run has not completed.
      const q: SavedQuestion = { calls: outcome.pending.calls, partial: outcome.pending.partial, tickets: outcome.tickets };
      question = q;
      await saveTranscript(pending);
      const tickets = await loadQuestionTickets(admin, q.tickets.map((t) => t.ticketId));
      const summary = restingSummaryFor(tickets);
      const { data: waiting } = await admin.from("agent_runs").update({ status: "awaiting_input", summary })
        .eq("id", run.id).eq("status", "running").select("id").maybeSingle();
      if (!waiting) return; // cancelled meanwhile
      await addStep(admin, run.id, "question", `回答待ち: ${summary}`,
        tickets.map((t, i) => `${i + 1}. ${t.question}`).join("\n"));
      await admin.from("element_comments").insert({
        element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: agentName,
        content: `**回答待ち** — ${tickets.map((t) => t.question).join(" / ")}\n\nInbox で回答すると、この実行は続きから再開します。`,
      });
      if (run.triggered_by) {
        for (const t of tickets) {
          await admin.from("notifications").insert({
            recipient_id: run.triggered_by, actor_name: agentName, kind: "question",
            agent_run_id: run.id, question_ticket_id: t.id,
            title: questionShortForm(t.question), body: ticketContextOf(t.context).decision ?? t.question,
          }).then(() => {}, () => {});
        }
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

    case "cancelled": {
      await saveTranscript();
      // Compensation on a stop (B9, D4): a person stopped this run —
      // the rollback is never executed and never offered (the stop
      // may itself be the judgment that the writes stand), but the
      // landed writes are named on the record as not rolled back,
      // never silently dropped.
      if (!run.rehearsal) {
        const report = await loadCompensationReport(admin, run.id).catch(() => null);
        if (report && compensationReportHasContent(report)) {
          await addStep(admin, run.id, "compensation", "補償は実行されませんでした",
            `${compensationReportText(report)}\n\n${JSON.stringify(report)}`);
        }
      }
      await addStep(admin, run.id, "status", "停止しました");
      return;
    }

    case "refusal": {
      await saveTranscript();
      const refusalMessage = `モデルがこの依頼を断りました: ${outcome.detail.slice(0, 300)}`;
      // A refusal after writes landed is a terminal failure like any
      // other (B9): the pass fires before the run seals failed — or
      // rests the run on the rollback batch, and the refusal settles
      // when the person decides. A rehearsal landed nothing real.
      // Its failure class is its own (B13): model_refusal.
      const failurePolicy = resolveFailurePolicy({ class: "model_refusal", definition: parsedAll, entries: failureEntries });
      if (!run.rehearsal) {
        const compOutcome = await runFailureCompensation("model_refusal");
        if (compOutcome.kind === "rest") {
          await restCompensationBatch(compOutcome, { kind: "fail", message: refusalMessage }, refusalMessage,
            { failureClass: "model_refusal", policy: failurePolicy });
          return;
        }
        await postCompensationReport(compOutcome.report);
      }
      await failRun(admin, run, refusalMessage);
      await finalizeFailureSettle({ failureClass: "model_refusal", policy: failurePolicy });
      return;
    }

    case "giveup": {
      await saveTranscript();
      // A give-up (B13): the declared patience for this failure class
      // ran out — a terminal failure like a refusal, settled the
      // same way, under the class that fired it; the message names
      // the class and the count.
      const failureClass: FailureClass = isFailureClass(outcome.failureClass) ? outcome.failureClass : "run_failure";
      const failurePolicy = resolveFailurePolicy({ class: failureClass, definition: parsedAll, entries: failureEntries });
      if (!run.rehearsal) {
        const compOutcome = await runFailureCompensation(failureClass);
        if (compOutcome.kind === "rest") {
          await restCompensationBatch(compOutcome, { kind: "fail", message: outcome.detail }, outcome.detail,
            { failureClass, policy: failurePolicy });
          return;
        }
        await postCompensationReport(compOutcome.report);
      }
      await failRun(admin, run, outcome.detail);
      await finalizeFailureSettle({
        failureClass, policy: failurePolicy,
        giveUp: giveUpFired ? { count: giveUpFired.count } : null,
      });
      return;
    }
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
    // B6: the constraint offer, once per draft (the promotion
    // pattern): an awaiting-review draft in this Space that has
    // never been offered rides the opening as a possibility the
    // agent may raise once — the stamp is claimed first, so two
    // conversations cannot both offer it.
    if (run.activity_space_id) {
      const offer = await constraintOfferForConversation(userDb, admin, run.activity_space_id).catch(() => null);
      if (offer) ctx.offer = offer;
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
      // Credential capture (secure-login PR2) rides the same event:
      // the creators judge the Space's rows from server-side facts —
      // a named token connection with an empty or refused slot gets a
      // capture request and its card, in this conversation too. The
      // model named connectors; it cannot name a destination or a
      // credential. Creation never fails the proposal.
      const credWaitingFor = r.kind === "proposed"
        ? r.waitingFor
        : (typeof call.input?.waitingFor === "string" ? call.input.waitingFor.trim().slice(0, 300) : "");
      let credMade: Awaited<ReturnType<typeof createCredentialRequestsForNames>> = [];
      if (run.activity_space_id && credWaitingFor) {
        credMade = await createCredentialRequestsForNames(admin, {
          spaceId: run.activity_space_id, userId: user.id,
          names: r.kind === "proposed" ? r.names : r.asked, waitingFor: credWaitingFor,
        }).catch(() => []);
        for (const m of credMade) {
          await addStep(admin, run.id, CREDENTIAL_REQUEST_STEP, credentialRequestTitle(m.row.name), credentialStepDetail(m.request, m.row.name));
          if (m.created) {
            await notifyCredentialRequestOwners(admin, {
              spaceId: run.activity_space_id, requesterId: user.id, label: m.row.name, waitingFor: credWaitingFor,
            }).catch(() => 0);
          }
        }
      }
      if (r.kind === "already") {
        return {
          content: credMade.length
            ? `${r.asked.join("、")} は接続されていますが、認証情報が入っていない（または拒否された）ため、会話に入力のカードを出しました。入力されたとは言わないでください。`
            : `${r.asked.join("、")} はすでに接続されています。接続の提案は要りません。`,
        };
      }
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
    const r = await runCatalogTool(userDb, call.name, call.input, actor, { entry: "conversation", spaceId: run.activity_space_id ?? null });
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

  if (d.source_kind === "builder") {
    // A builder draft (Automation builder PR4) has no memory or run
    // behind it: its material is the seed the builder wrote on the
    // row — the name, the body the zone picks filled, the binding —
    // and the drafter drafts around that seed, taking a hand-edited
    // body verbatim when it freezes (the standing revised rule).
    if (!d.body || !d.name) return { missing: "ビルダーの下書きに、名前と本文の種がありません。" };
    parts.push("## ビルダーで組み立てた種");
    take("person", d.requester_id ?? d.id, "ビルダーの種（名前と本文）", `${d.name}\n\n${d.body}`);
    return {
      text: parts.join("\n\n"), sources,
      sourceLine: `自動化ビルダーで組み立てた「${d.name}」（種は本人が置いた）`,
    };
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
    // A reviewer's canvas edits (P4, design §5.3) the conversation
    // has not seen enter it once: the current body, verbatim, with
    // the one instruction that matters — propose THIS text, do not
    // rewrite it — so the freeze and the new rehearsal re-test
    // exactly what the person approved on the canvas.
    if (d.status === "drafting" && d.body) {
      const revised = [...(Array.isArray(d.events) ? d.events : [])].reverse()
        .find((e) => e && e.kind === "revised");
      if (revised?.at) {
        const marker = `【レビューでの編集 ${revised.at}】`;
        const seen = state.messages.some((m) => typeof m.content === "string" && m.content.includes(marker));
        if (!seen) {
          state.messages.push({
            role: "user",
            content: `${marker}\n審査のキャンバスで定義本文が編集されました。現在の本文は次のとおりです。内容を変えず、この本文をそのまま propose_package で提案し、finish_promotion（ready）で試走に進めてください。\n\n${d.body}`,
          });
        }
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
    userDb.from("agent_actions").select("id, element_id, summary, created_at, expires_at, input")
      .eq("status", "pending").order("created_at", { ascending: true }).limit(40),
    [] as { id: string; element_id: string | null; summary: string; created_at: string; expires_at: string | null; input: unknown }[],
  );
  const actionTitles = await titleOf(actions.map((x) => x.element_id));
  for (const x of actions) {
    // A circuit-breaker hold (B11) waits as a pending action too, but
    // it speaks through its own signal below — the one that carries
    // the trip's reason — never as a plain approval wait as well.
    const heldInput = x.input && typeof x.input === "object" && !Array.isArray(x.input)
      ? (x.input as Record<string, unknown>) : null;
    if (heldInput?.breaker) continue;
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
    userDb.from("agent_runs").select("id, status, element_id, summary, proposed_readings, verdict, failure_detail, updated_at, finished_at")
      .eq("activity_space_id", spaceId)
      .in("status", ["awaiting_input", "awaiting_review", "paused", "failed", "completed"])
      .order("updated_at", { ascending: true }).limit(60),
    [] as { id: string; status: string; element_id: string | null; summary: string | null; proposed_readings: unknown; verdict: unknown; failure_detail: unknown; updated_at: string; finished_at: string | null }[],
  );
  const runTitles = await titleOf(runs.map((r) => r.element_id));
  const exhaustedFacts: ExhaustedRunFact[] = [];
  for (const r of runs) {
    const label = (r.element_id ? runTitles.get(r.element_id) : null) ?? r.summary ?? "実行";
    // A settled failure whose rule escalated to the Inbox (B13): the
    // heartbeat is its delivery — raised as failure_escalation,
    // INSTEAD of the plain run_failed for a failed run, and also for
    // a run that sealed completed or rests in review with a failed
    // verdict, whose failure no other signal would carry.
    const fd = r.failure_detail && typeof r.failure_detail === "object" && !Array.isArray(r.failure_detail)
      ? r.failure_detail as { class?: unknown; escalate?: { target?: unknown } | null } : null;
    const inboxEscalation = fd?.escalate?.target === "inbox" && typeof fd.class === "string"
      ? { failureClass: fd.class } : null;
    if (r.status === "awaiting_input") {
      signals.push({ kind: "run_answer", id: r.id, since: r.updated_at, version: r.updated_at, label, place: "会話で答えられます" });
    } else if (r.status === "awaiting_review") {
      signals.push({ kind: "run_review", id: r.id, since: r.updated_at, label, place: "Element の実行パネルで確認できます" });
    } else if (r.status === "paused") {
      signals.push({ kind: "run_paused", id: r.id, since: r.updated_at, version: r.updated_at, label, place: "Element の実行パネルで再開できます" });
    } else if (r.status === "failed") {
      if (inboxEscalation) {
        signals.push({ kind: "failure_escalation", id: r.id, since: r.finished_at ?? r.updated_at, label: `${label}: ${inboxEscalation.failureClass}`, place: "Element の実行パネルで確認できます" });
      } else {
        signals.push({ kind: "run_failed", id: r.id, since: r.finished_at ?? r.updated_at, label, place: "Element の実行パネルで確認できます" });
      }
    }
    if (inboxEscalation && (r.status === "completed" || r.status === "awaiting_review")) {
      signals.push({ kind: "failure_escalation", id: r.id, since: r.finished_at ?? r.updated_at, label: `${label}: ${inboxEscalation.failureClass}`, place: "Element の実行パネルで確認できます" });
    }
    const held = parseProposedReadings(r.proposed_readings)
      ?.some((p) => !p.applied && p.heldReason === "awaiting-acceptance");
    if (held) {
      signals.push({ kind: "readings", id: r.id, since: r.finished_at ?? r.updated_at, label, place: "Element の仕事を受け入れると反映されます" });
    }
    // A run whose revisions ran out (B3) is collected here and judged
    // by the pure builder below: its finish stood failed, so the wait
    // is not on the unit but on the plan that produced it.
    if ((r.status === "completed" || r.status === "awaiting_review") && r.element_id) {
      exhaustedFacts.push({
        runId: r.id, elementId: r.element_id,
        elementTitle: runTitles.get(r.element_id) ?? null,
        verdict: parseRunVerdict(r.verdict),
        finishedAt: r.finished_at, updatedAt: r.updated_at,
      });
    }
  }
  signals.push(...correctionExhaustedSignals(exhaustedFacts));

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

  // ── Credential anomalies (secure-login PR4) ──
  // The credential trail is owner-readable only; the heartbeat reads
  // as the enabling owner, so a Space whose heartbeat owner cannot
  // read the trail yields no rows and no signals — never an error.
  // The derivation is the shared pure one (credentialAnomalies.ts):
  // repeated release refusals, repeated auth failures, credentials
  // stored and never spent, one-time spends no run claimed. Like
  // every heartbeat signal these are candidates for a telling, not
  // an action: nothing here touches a credential.
  const credentialUses = await guard(
    userDb.from("credential_uses").select("id, credential_kind, integration_id, site_credential_id, event, run_id, origin, created_at")
      .eq("activity_space_id", spaceId).order("created_at", { ascending: false }).limit(500),
    [] as CredentialUseFact[],
  );
  if (credentialUses.length) {
    const conns = await guard(
      userDb.from("integrations").select("id, name").eq("activity_space_id", spaceId),
      [] as { id: string; name: string }[],
    );
    const sites = await guard(
      userDb.from("site_credentials").select("id, origin").eq("activity_space_id", spaceId),
      [] as { id: string; origin: string }[],
    );
    signals.push(...credentialAnomalySignals(credentialUses, {
      integrationName: new Map(conns.map((c) => [c.id, c.name])),
      siteOrigin: new Map(sites.map((s) => [s.id, s.origin])),
    }, new Date()));
  }

  // ── Definition-revision candidates (B5 calibration) ──
  // The tick evaluator opens these where a definition's verifier and
  // its humans systematically disagree; the wait is the person's
  // revision decision, standing since the candidate opened. The rows
  // are member-readable and the heartbeat reads as the enabling
  // owner, so the field of view is the Space's own. The shaping is
  // the shared pure one (verifierCalibration.ts); the heartbeat can
  // only tell about a candidate — resolving one is the owner's act
  // in the harness's drill-down, through the owner-checked RPC.
  const revisionCandidates = await guard(
    userDb.from("definition_revision_candidates").select("id, definition_id, reason, rate, pairs, created_at")
      .eq("activity_space_id", spaceId).eq("status", "open")
      .order("created_at", { ascending: true }).limit(20),
    [] as { id: string; definition_id: string; reason: string; rate: number | string; pairs: number; created_at: string }[],
  );
  if (revisionCandidates.length) {
    const defs = await guard(
      userDb.from("definitions").select("id, name").in("id", revisionCandidates.map((c) => c.definition_id)),
      [] as { id: string; name: string }[],
    );
    const facts: CalibrationCandidateFact[] = revisionCandidates.map((c) => ({
      id: c.id, definitionId: c.definition_id, reason: c.reason,
      rate: Number(c.rate), pairs: c.pairs, createdAt: c.created_at,
    }));
    signals.push(...calibrationCandidateSignals(facts, new Map(defs.map((d) => [d.id, d.name]))));
  }

  // ── Constraint drafts waiting for review (B6) ──
  // The tick's derivation drafts these from outcome clusters; the
  // wait is the owner's activation decision, standing since the
  // draft was written. The shaping is the shared pure one
  // (constraintDrafts.ts): the heartbeat can only tell about a
  // draft — activating one is the owner's act in the harness queue,
  // through the owner-checked RPC.
  const constraintDraftRows = await guard(
    userDb.from("constraint_drafts").select("id, constraint_text, target_definition_id, target_strategy_id, created_at, expires_at")
      .eq("activity_space_id", spaceId).eq("status", "awaiting_review")
      .order("created_at", { ascending: true }).limit(20),
    [] as { id: string; constraint_text: string | null; target_definition_id: string | null; target_strategy_id: string | null; created_at: string; expires_at: string | null }[],
  );
  if (constraintDraftRows.length) {
    const nameOf = new Map<string, string>();
    const defIds = [...new Set(constraintDraftRows.map((d) => d.target_definition_id).filter((x): x is string => !!x))];
    const stratIds = [...new Set(constraintDraftRows.map((d) => d.target_strategy_id).filter((x): x is string => !!x))];
    if (defIds.length) {
      const defs = await guard(userDb.from("definitions").select("id, name").in("id", defIds), [] as { id: string; name: string }[]);
      for (const d of defs) nameOf.set(d.id, d.name);
    }
    if (stratIds.length) {
      const strats = await guard(userDb.from("strategies").select("id, name").in("id", stratIds), [] as { id: string; name: string }[]);
      for (const s of strats) nameOf.set(s.id, s.name);
    }
    signals.push(...constraintDraftSignals(constraintDraftRows.map((d) => ({
      id: d.id,
      text: d.constraint_text ?? "",
      targetName: (d.target_definition_id ? nameOf.get(d.target_definition_id) : d.target_strategy_id ? nameOf.get(d.target_strategy_id) : undefined) ?? "対象",
      createdAt: d.created_at,
      expiresAt: d.expires_at,
    }))));
  }

  // ── Circuit-breaker holds (B11) ──
  // A trip rests its run on a pending decision; the wait that matters
  // is the trip itself, whose reason line carries the rule, the target
  // and the count. Only trips whose run still rests are signals — a
  // trip a person already answered is acknowledged on its row, and a
  // run that was cancelled out from under its hold no longer waits.
  const tripRows = await guard(
    userDb.from("breaker_trips").select("id, run_id, reason, created_at")
      .eq("activity_space_id", spaceId).eq("status", "open")
      .order("created_at", { ascending: true }).limit(20),
    [] as { id: string; run_id: string; reason: string; created_at: string }[],
  );
  if (tripRows.length) {
    const resting = await guard(
      userDb.from("agent_runs").select("id").eq("activity_space_id", spaceId).eq("status", "awaiting_approval")
        .in("id", tripRows.map((t) => t.run_id)),
      [] as { id: string }[],
    );
    const restingIds = new Set(resting.map((r) => r.id));
    for (const t of tripRows) {
      if (!restingIds.has(t.run_id)) continue;
      signals.push({ kind: "breaker_trip", id: t.id, since: t.created_at, label: t.reason, place: "Element の実行パネルで承認か却下を判断できます" });
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
  // Credential capture requests this turn's proposals created: recorded
  // as credential_request steps and kept with the turn's message, the
  // same two-medium discipline as the proposals themselves.
  const credentialAsks: { requestId: string; label: string; waitingFor: string }[] = [];
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
    userDb, admin, context, supabaseUrl: a.supabaseUrl, approvalMode: turnMode, runId: run.id,
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
          // What the call created rides the event into the kept message
          // whole (the record), and into the step detail capped (the
          // live display) — the panel draws the turn's cards from both.
          ...(r.created?.length ? { created: r.created } : {}),
        });
        if (r.credentialRequests?.length) {
          // A capture ask is recorded the same way: its own step kind,
          // carrying the request id the card re-reads — never a value,
          // which exists in no step, event or message by construction.
          for (const c of r.credentialRequests) {
            credentialAsks.push(c);
            stepLater(CREDENTIAL_REQUEST_STEP, credentialRequestTitle(c.label),
              credentialStepDetail({ id: c.requestId }, c.label));
          }
        }
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
          toolStepDetail({
            ...(call ? { input: call.input } : {}),
            ...(r.rows !== undefined ? { rows: r.rows } : {}),
            ...(r.error ? { error: r.error } : {}),
            ...(r.created?.length ? { created: r.created } : {}),
          }),
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
    // Graduated autonomy (B7): a rejection revokes the rejected
    // commands' earned grants in the same flow that records it, so
    // the next call to the command asks again.
    onRejected: async (_action, calls) => {
      const spaceId = context.spaceId ?? run.activity_space_id;
      if (!spaceId) return;
      const tools = turn.toolset?.tools ?? new Map();
      const seen = new Set<string>();
      for (const c of calls) {
        const it = tools.get(c.name);
        if (!it?.command) continue;
        const key = `${it.integration.id}:${it.command.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await revokeAutonomyForIncident(admin, {
          spaceId, integrationId: it.integration.id, action: it.command.name,
          kind: "rejection", runId: run.id,
        });
      }
    },
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

  // The loop's executor: a call the free mode let through — or one an
  // earned track-record grant let through (B7) — records its policy
  // approval as it runs (policyApproval.ts), settled when it lands;
  // the record's decision_source names which lift it was. The decision
  // path above runs its approved calls through the plain executor, a
  // person's approval already being their record.
  const loopExecute = async (call: ToolCall) => {
    const v = turn.verdictOf(call);
    let policyActionId: string | null = null;
    if (v && v.base === "ask" && (turnMode === "free" || v.lift === "track-record")) {
      const display = approvalDisplayForCall(turn.toolset?.tools ?? new Map(), call);
      const summary = approvalSummary([display]);
      const byTrackRecord = v.lift === "track-record";
      policyActionId = await recordPolicyApproval(admin, {
        runId: run.id, elementId: null, call, display, mode: turnMode,
        integrationId: turn.toolset?.tools.get(call.name)?.integration.id ?? null,
        ...(byTrackRecord ? { source: "track-record" as const } : {}),
      });
      if (byTrackRecord) {
        const clean = turn.grantOf(call)?.clean ?? 0;
        await bound("approval", `実績により自動実行: ${summary}`,
          `この操作は、これまで問題なく完了した実績（${clean} 回）により、承認を求めずに実行しました。記録はポリシー承認（実績）として残ります。`);
      } else {
        await bound("approval", `ポリシー承認で実行: ${summary}`, "Space の承認モード（自由行動）により、承認を求めずに実行しました。");
        if (display.critical && run.triggered_by) {
          await admin.from("notifications").insert({
            recipient_id: run.triggered_by, actor_name: COPILOT_AGENT_NAME, kind: "status_change",
            agent_action_id: policyActionId, title: "重要な操作をポリシー承認で実行しました", body: summary,
          }).then(() => {}, () => {});
        }
      }
    }
    if (!policyActionId && v?.final === "allow" && turn.liftOf(call) === "delegation") {
      liftedDisplays.push(approvalDisplayForCall(turn.toolset?.tools ?? new Map(), call));
    }
    const r = await execute(call);
    if (policyActionId) await settlePolicyApproval(admin, policyActionId, !r.is_error, r.verify);
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
        resumedAssistantMessage({ text, toolEvents, connections: connectProposals, credentials: credentialAsks })]);
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
          text: lastWords(), toolEvents, connections: connectProposals, credentials: credentialAsks,
          approval: { calls: p.calls, inputHash: persisted.inputHash, status: "pending", runId: run.id, actionId: persisted.actionId },
        })]);
      await bound("approval", "承認待ち", persisted.summary);
      return;
    }
    case "yield":
      await saveTranscript();
      await scheduleContinuation();
      return;
    case "cancelled": {
      // A person's stop: the turn is kept, marked stopped — its words
      // and steps as they stood when the stop landed — so the record
      // (and the context the next turn seeds from) says the turn
      // happened and was stopped, instead of the person's message
      // standing with no answer at all. Everything the turn already
      // created stands; the kept events are its record.
      await flushLifted();
      await saveTranscript();
      await updateCopilotSessionMessages(admin, sessionId, (messages) => [...messages,
        stoppedAssistantMessage({ text: lastWords(), toolEvents, connections: connectProposals, credentials: credentialAsks })]);
      await bound("status", "停止しました");
      return;
    }
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
        resumedAssistantMessage({ text: note, toolEvents, connections: connectProposals, credentials: credentialAsks })]);
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
  // B6: the activated constraints land here too — the Strategy's own
  // as a section, and the conversation definition's as a block under
  // its body — through the same driver-context channel Memory uses,
  // never the cached system prompt.
  const strategyConstraints = await loadActiveConstraints(userDb, "strategy", strategyId);
  const defConstraints = definitionId ? await loadActiveConstraints(userDb, "definition", definitionId) : [];
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
    constraints: strategyConstraints.length ? strategyConstraintSection(strategyConstraints) : undefined,
    definitionConstraints: defConstraints.length ? definitionConstraintBlock(defConstraints) : undefined,
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
    // terminal finish only, and never updated afterwards. So is the finish
    // itself, typed: its claims and unconfirmed list (finishClaims.ts), the
    // record the verdict's accounting counts and the Reviews filter reads.
    ...(verdict ? { verdict } : {}),
    ...(status === undefined ? { finish_detail: finishDetailOf(finish) } : {}),
    ...(proposals ? { proposed_readings: proposals } : {}),
  }).eq("id", run.id).eq("status", "running").select("id").maybeSingle();
  if (!closed) return false;

  // A terminal finish (not a pause — a paused run resumes into the
  // same workspace) destroys the run's workspace (coding PR1):
  // per-run disposal is the classification's premise. Best effort,
  // like failRun's close; the tick's reaper is the backstop.
  if (status === undefined) {
    await closeRunWorkspace(admin, (k) => Deno.env.get(k), run.id, "run_finished", new Date()).catch(() => false);
  }

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
      const { started, skipped, startedLines } = await advanceFrom(a, run.element_id, {
        id: run.id, chain_scope: run.chain_scope, activity_space_id: run.activity_space_id, triggered_by: run.triggered_by,
      });
      if (started.length) await addStep(admin, run.id, "status", `次の作業を ${started.length} 件開始しました`, startedLines.length ? startedLines.join("\n") : null);
      if (skipped.length) await addStep(admin, run.id, "status", `合格済みの ${skipped.length} 件は再実行しませんでした`, "前回の実行で合格（または受け入れ済み）で、Element と定義が変わっていないためです。");
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

/** The active constraints on one target (B6's landing reads): the
 *  truth table, read through the caller's client — member RLS is the
 *  field of view, and a read failure (or a database without the
 *  table yet) yields none rather than failing work about to start. */
async function loadActiveConstraints(
  db: SupabaseClient, scope: "definition" | "strategy", targetId: string,
): Promise<ActiveConstraintFact[]> {
  try {
    const column = scope === "definition" ? "target_definition_id" : "target_strategy_id";
    const { data, error } = await db.from("planning_constraints")
      .select("id, draft_id, constraint_text, signature, derived_from, activated_at")
      .eq("status", "active").eq(column, targetId)
      .order("activated_at", { ascending: true });
    if (error) return [];
    return ((data ?? []) as { id: string; draft_id: string; constraint_text: string; signature: string; derived_from: string; activated_at: string }[])
      .map((r) => ({
        id: r.id, draftId: r.draft_id, text: r.constraint_text, signature: r.signature,
        derivedFrom: r.derived_from as ActiveConstraintFact["derivedFrom"], activatedAt: r.activated_at,
      }));
  } catch { return []; }
}

/**
 * B6's conversational offer, once per draft (the promotion pattern):
 * the Space's oldest awaiting-review, never-offered draft is claimed
 * by stamping offered_at first — the update wins or the offer is
 * not made — so two conversations cannot both raise the same draft.
 * Returns the offer text for the opening, or null.
 */
async function constraintOfferForConversation(
  userDb: SupabaseClient, admin: SupabaseClient, spaceId: string,
): Promise<string | null> {
  const { data } = await userDb.from("constraint_drafts")
    .select("id, constraint_text, target_definition_id, target_strategy_id, offered_at, created_at")
    .eq("activity_space_id", spaceId).eq("status", "awaiting_review").is("offered_at", null)
    .order("created_at", { ascending: true }).limit(5);
  const rows = (data ?? []) as { id: string; constraint_text: string | null; target_definition_id: string | null; target_strategy_id: string | null; offered_at: string | null; created_at: string }[];
  if (!rows.length) return null;
  const nameOf = new Map<string, string>();
  const defIds = [...new Set(rows.map((r) => r.target_definition_id).filter((x): x is string => !!x))];
  const stratIds = [...new Set(rows.map((r) => r.target_strategy_id).filter((x): x is string => !!x))];
  if (defIds.length) {
    const { data: defs } = await userDb.from("definitions").select("id, name").in("id", defIds);
    for (const d of (defs ?? []) as { id: string; name: string }[]) nameOf.set(d.id, d.name);
  }
  if (stratIds.length) {
    const { data: strats } = await userDb.from("strategies").select("id, name").in("id", stratIds);
    for (const s of (strats ?? []) as { id: string; name: string }[]) nameOf.set(s.id, s.name);
  }
  const candidate = constraintOfferCandidate(rows.map((r) => ({
    id: r.id,
    text: r.constraint_text ?? "",
    targetName: (r.target_definition_id ? nameOf.get(r.target_definition_id) : r.target_strategy_id ? nameOf.get(r.target_strategy_id) : undefined) ?? "対象",
    offeredAt: r.offered_at,
  })));
  if (!candidate) return null;
  const { data: stamped } = await admin.from("constraint_drafts")
    .update({ offered_at: new Date().toISOString() })
    .eq("id", candidate.id).is("offered_at", null).select("id").maybeSingle();
  if (!stamped) return null;
  return constraintOfferText(candidate);
}

/** The definition an Element follows: its own, else the first enabled of its
 *  Strategies'. A disabled definition is skipped as if its slot were empty;
 *  the skipped names come back so the run can say it went on without them. */
async function loadDefinition(userDb: SupabaseClient, elementId: string): Promise<{ definition: { id: string; name: string; body: string; scope: "element" | "strategy" } | null; skippedDisabled: string[] }> {
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
  return { definition: { id, ...(d as { name: string; body: string }), scope: id === ownId ? "element" : "strategy" }, skippedDisabled };
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
 * B8: a person's decision on a sealed plan. serve() has already verified
 * the decision against the plan's hash; the run was claimed from
 * awaiting_approval into running for this drive.
 *
 * Rejection ends the matter: the action is marked rejected, the run
 * failed with the reason, and the plan itself stays on the record (the
 * action row and the transcript) — nothing in it runs, ever.
 *
 * Approval starts the apply run: a fresh run on the same Element, as the
 * approver, carrying the approved plan in its transcript. The plan
 * action names the apply run in its result, so the audit reads
 * plan -> decision -> apply run in one hop. If the apply run cannot be
 * created, the approval is NOT settled — the plan goes back to waiting
 * and the failure is on the trace, rather than an approval whose apply
 * silently never happened. If the hand-off fetch fails after creation,
 * the apply run stays queued for its starter to drive (an approved plan
 * is never cancelled by a transport failure).
 */
async function decidePlan(a: ExecArgs): Promise<void> {
  const { run, admin, userDb, user } = a;
  const decision = a.body.decision!;
  const plan = readRunPlan(run.transcript?.plan);
  const { data: action } = await admin.from("agent_actions").select("id, status, summary").eq("id", decision.actionId ?? "").eq("run_id", run.id).maybeSingle();
  if (!plan || !action || action.status !== "pending") return; // settled meanwhile; serve() refused mismatches
  const summary = typeof action.summary === "string" ? action.summary : "計画";
  const note = decision.note?.trim() ? decision.note.trim() : null;

  if (!decision.approve) {
    await admin.from("agent_actions").update({
      status: "rejected", decided_by: user.id, decided_at: new Date().toISOString(), decision_note: note,
    }).eq("id", action.id);
    await addStep(admin, run.id, "approval", "計画が却下されました", note);
    await admin.from("element_comments").insert({
      element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: "Alcon Agent",
      content: `**計画が却下されました** — ${summary}${note ? `\n\n${note}` : ""}`,
    });
    // The plan run ends failed: the work was not done and the Element does
    // not move. finishRun is deliberately not used — it moves Elements.
    await admin.from("agent_runs").update({
      status: "failed", error: `計画が却下されました${note ? `: ${note}` : ""}`, summary: "計画が却下されました",
      finished_at: new Date().toISOString(), continuation_token: null,
    }).eq("id", run.id).eq("status", "running");
    if (run.triggered_by) {
      await admin.from("notifications").insert({
        recipient_id: run.triggered_by, actor_name: "Alcon Agent", kind: "status_change", element_id: run.element_id,
        title: "計画が却下されました", body: summary,
      }).then(() => {}, () => {});
    }
    return;
  }

  // B10: an apply run inherits its plan run's scope verbatim — plan
  // and apply are ONE chain link, the pair consuming no depth; the
  // copy differs from the original only in whose child it is. An
  // unscoped plan run's apply run is unscoped and starts as today.
  const planScope = parseChainScope(run.chain_scope);
  let applyScope: ChainScope | null = planScope ? { ...planScope, parentRunId: run.id } : null;
  let inserted = await (applyScope ? admin : userDb).from("agent_runs").insert({
    element_id: run.element_id, domain_id: run.domain_id, worker_id: run.worker_id,
    triggered_from: "plan", triggered_by: user.id, status: "queued", mode: run.mode,
    prompt: run.prompt,
    ...(applyScope ? { id: crypto.randomUUID(), chain_scope: applyScope } : {}),
  }).select("id").single();
  if ((inserted.error || !inserted.data) && applyScope) {
    // A database whose chain_scope column has not landed yet (the
    // production catch-up is still behind): the apply run starts
    // unscoped — pre-B10 behaviour — rather than not starting at all.
    console.error("run-agent: apply run scope insert failed; starting unscoped", inserted.error?.message);
    applyScope = null;
    inserted = await userDb.from("agent_runs").insert({
      element_id: run.element_id, domain_id: run.domain_id, worker_id: run.worker_id,
      triggered_from: "plan", triggered_by: user.id, status: "queued", mode: run.mode,
      prompt: run.prompt,
    }).select("id").single();
  }
  const { data: next, error } = inserted;
  if (error || !next) {
    await addStep(admin, run.id, "error", "適用 run を開始できませんでした", error?.message ?? null);
    await admin.from("agent_runs").update({ status: "awaiting_approval" }).eq("id", run.id).eq("status", "running");
    return;
  }
  const applyRunId = (next as { id: string }).id;
  // The approved plan rides the apply run's transcript from its first
  // drive — written before the run is handed over, so the run can never
  // start without its coverage record in place.
  await admin.from("agent_runs").update({
    transcript: { messages: [], turns: 0, nudges: 0, approvedPlan: { ...plan, actionId: action.id as string } },
  }).eq("id", applyRunId);
  await admin.from("agent_actions").update({
    status: "approved", decided_by: user.id, decided_at: new Date().toISOString(), decision_note: note,
    result: { apply_run_id: applyRunId },
  }).eq("id", action.id);
  await addStep(admin, run.id, "approval", "計画が承認されました — 適用を開始します", summary);
  await admin.from("agent_runs").update({
    status: "completed", summary: "計画が承認され、適用を開始しました",
    result: `${summary}（承認済み — 適用 run が計画の書き込みを実行します）`,
    finished_at: new Date().toISOString(), continuation_token: null,
  }).eq("id", run.id).eq("status", "running");
  await admin.from("element_comments").insert({
    element_id: run.element_id, author_id: user.id, author_kind: "ai_agent", author_name: "Alcon Agent",
    content: `**計画が承認されました** — ${summary}。適用 run が計画どおりに実行します。`,
  });
  // Drive the apply run as the approver (advanceFrom's pattern) —
  // under a fresh chain token when the plan run was scoped (B10).
  const driveJwt = applyScope ? await chainDriveJwt(user.id, applyScope, applyRunId, a.jwt) : a.jwt;
  await fetch(`${a.supabaseUrl}/functions/v1/run-agent`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${driveJwt}` },
    body: JSON.stringify({ runId: applyRunId }),
  }).then(async (res) => {
    if (!res.ok) {
      await res.body?.cancel();
      await addStep(admin, run.id, "error", "適用 run の開始に失敗しました（実行パネルから再開できます）", `HTTP ${res.status}`);
    }
  }).catch(async (e) => {
    await addStep(admin, run.id, "error", "適用 run の開始に失敗しました（実行パネルから再開できます）", errorMessage(e));
  });
}

/**
 * Starts the AI Elements that `doneId` unblocks, as the same person, each as
 * its own run. Everything is read with that person's JWT, so the chain only
 * reaches what they could start by hand. A JWT that has expired meanwhile
 * fails the start; the Elements stay ready on the Execution tab.
 *
 * The unit-return rule (B3) stands in the dispatch: an Element whose
 * standing verdict is a pass — or whose readings a person accepted —
 * over inputs provably unchanged since is not re-run, and the skip is
 * reported beside the starts. A person's own explicit start (the web's
 * startElementRun) is not the dispatcher and is never gated by this.
 *
 * Every child born here is born scoped (B10): its chain scope is
 * minted at the insert below from settled records alone — the
 * parent run's row scope, the child's own resolved definition, the
 * Space's connection rows and their tested manifests — and written
 * by the service role, the only writer the row allows. A child past
 * the depth cap is not created at all: its Element stays ready, and
 * the cap is said on the parent's trace, on the Element's thread,
 * and to the parent run's starter.
 */
async function advanceFrom(
  a: Pick<ExecArgs, "admin" | "userDb" | "user" | "jwt" | "supabaseUrl">,
  doneId: string,
  parentRun?: { id: string; chain_scope?: unknown; activity_space_id: string | null; triggered_by: string | null } | null,
): Promise<{ started: string[]; skipped: string[]; startedLines: string[]; capped: { elementId: string; title: string }[] }> {
  const { admin, userDb, user } = a;
  const { data: out } = await userDb.from("element_edges").select("from_element, to_element").eq("from_element", doneId).eq("edge_type", "depends_on");
  const downIds = [...new Set(((out ?? []) as { to_element: string }[]).map((e) => e.to_element))];
  if (downIds.length === 0) return { started: [], skipped: [], startedLines: [], capped: [] };
  const [{ data: inEdges }, { data: els }, { data: assignees }, { data: open }] = await Promise.all([
    userDb.from("element_edges").select("from_element, to_element").in("to_element", downIds).eq("edge_type", "depends_on"),
    userDb.from("elements").select("id, status, title, description, object_id, objects(domain_id)").in("id", downIds),
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
  type ElementRow = { id: string; status: string | null; title: string; description: string | null; object_id: string | null; objects: { domain_id: string | null } | null };
  const rows = (els ?? []) as unknown as ElementRow[];

  // The standing record behind the unit-return rule: the Element's
  // latest verdict-bearing terminal run — a rehearsal's verdict
  // judges a draft definition, never the work, so it cannot stand
  // for it — judged against the inputs as they stand now, hashed
  // here at dispatch (loadDefinition resolves the definition the
  // driver's way, so the two hashes speak of the same inputs).
  const standingPassOf = async (e: ElementRow): Promise<boolean> => {
    const { data: last } = await admin.from("agent_runs")
      .select("verdict, proposed_readings")
      .eq("element_id", e.id).eq("rehearsal", false)
      .in("status", ["completed", "awaiting_review"])
      .not("verdict", "is", null)
      .order("finished_at", { ascending: false }).limit(1);
    const row = (last ?? [])[0] as { verdict: unknown; proposed_readings: unknown } | undefined;
    if (!row) return false;
    const verdict = parseRunVerdict(row.verdict);
    if (!verdict?.inputsHash) return false;
    const readingsLanded = parseProposedReadings(row.proposed_readings)?.some((p) => p.applied) ?? false;
    if (verdict.result !== "pass" && !readingsLanded) return false;
    const { definition: defNow } = await loadDefinition(userDb, e.id);
    const currentInputsHash = await sha256(elementInputsCanonical({
      title: e.title, description: e.description, definitionBody: defNow?.body ?? null,
    }));
    return standingSkipReason({ verdict, readingsLanded, currentInputsHash }) !== null;
  };
  const standing = new Map<string, boolean>();
  for (const e of rows) standing.set(e.id, await standingPassOf(e));

  const candidates: AdvanceCandidate[] = rows.map((e) => ({
    id: e.id, status: e.status, ai: isAi(e.id), openRun: busy.has(e.id), standingPass: standing.get(e.id) ?? false,
  }));
  const allEdges = [...((out ?? []) as { from_element: string; to_element: string }[]), ...edges];
  const ready = readyDownstream({ doneId, edges: allEdges, candidates, statusOf });
  // What the rule held back, exactly: ready by every other measure,
  // and not started. (The decision runs twice over the same pure
  // inputs; the sets are a chain's next layer, a handful at most.)
  const wouldStart = readyDownstream({ doneId, edges: allEdges, candidates: candidates.map((c) => ({ ...c, standingPass: false })), statusOf });
  const skipped = wouldStart.filter((id) => !ready.includes(id));

  // The parent run every child born here descends from (B10):
  // finishRun hands over the run whose finish this is; a person
  // closing the Element by hand has no run in flight, so the parent
  // is that Element's latest verdict-bearing run — the completed one
  // itself; and when no run exists at all, the children are their
  // own roots. The parent's Space comes from its row; a spaceless
  // chain (a personal graph) has no connections to fence and its
  // children are born unscoped, exactly as before B10.
  type ParentInfo = { id: string; scope: ChainScope | null; spaceId: string | null; triggeredBy: string | null };
  let parent: ParentInfo | null = null;
  if (parentRun) {
    parent = { id: parentRun.id, scope: parseChainScope(parentRun.chain_scope), spaceId: parentRun.activity_space_id, triggeredBy: parentRun.triggered_by };
  } else {
    const { data: last } = await admin.from("agent_runs")
      .select("id, chain_scope, activity_space_id, triggered_by")
      .eq("element_id", doneId).eq("rehearsal", false)
      .in("status", ["completed", "awaiting_review"])
      .order("finished_at", { ascending: false, nullsFirst: false }).limit(1);
    const row0 = (last ?? [])[0] as { id: string; chain_scope?: unknown; activity_space_id: string | null; triggered_by: string | null } | undefined;
    if (row0) parent = { id: row0.id, scope: parseChainScope(row0.chain_scope), spaceId: row0.activity_space_id, triggeredBy: row0.triggered_by };
  }
  const spaceByDomain = new Map<string, string | null>();
  const spaceFor = async (domainId: string | null): Promise<string | null> => {
    if (!domainId) return parent?.spaceId ?? null;
    if (!spaceByDomain.has(domainId)) {
      const { data: d } = await admin.from("domains").select("activity_space_id").eq("id", domainId).maybeSingle();
      spaceByDomain.set(domainId, (d as { activity_space_id?: string | null } | null)?.activity_space_id ?? null);
    }
    return spaceByDomain.get(domainId) ?? null;
  };
  const derivationBySpace = new Map<string, DerivationIntegration[]>();
  const derivationFor = async (spaceId: string): Promise<DerivationIntegration[]> => {
    if (!derivationBySpace.has(spaceId)) {
      derivationBySpace.set(spaceId, await loadDerivationIntegrations(admin, spaceId).catch(() => []));
    }
    return derivationBySpace.get(spaceId)!;
  };

  const started: string[] = [];
  const startedLines: string[] = [];
  const capped: { elementId: string; title: string }[] = [];
  for (const id of ready) {
    const el = rows.find((e) => e.id === id);
    const domainId = el?.objects?.domain_id ?? null;
    // The child's scope, minted here from settled records: capped
    // children are not created (their Element stays ready — the
    // same resting place an expired drive leaves today — and the
    // cap surfaces below say why).
    let scope: ChainScope | null = null;
    let scopedInsertId: string | null = null;
    const spaceId = await spaceFor(domainId);
    if (spaceId) {
      if (parent && chainDepthFor({ parent: parent.scope, hasParentRun: true }).capped) {
        capped.push({ elementId: id, title: el?.title ?? id });
        continue;
      }
      // The child's run id is fixed before its scope is minted: a
      // root's scope names its own run as root and parent.
      const childRunId = crypto.randomUUID();
      const { definition: childDef } = await loadDefinition(userDb, id);
      const derived = deriveScopeFromDefinition({
        connectors: childDef ? parseDefinition(childDef.body).connectors : [],
        integrations: await derivationFor(spaceId),
        strategyId: null,
      });
      const strategyId = await strategyIdForObject(admin, el?.object_id ?? null);
      scope = parent
        ? deriveChildScope({ parent: parent.scope, parentRunId: parent.id, derived, strategyId })
        : rootChainScope({ runId: childRunId, derived, strategyId });
      scopedInsertId = childRunId;
    }
    const insertRow = {
      element_id: id, domain_id: domainId, triggered_from: "board", triggered_by: user.id, status: "queued", mode: "execute",
      ...(scope ? { id: scopedInsertId!, chain_scope: scope } : {}),
    };
    let inserted = await (scope ? admin : userDb).from("agent_runs").insert(insertRow).select("id").single();
    if ((inserted.error || !inserted.data) && scope) {
      // A database whose chain_scope column has not landed yet (the
      // production catch-up is still behind): the child starts
      // unscoped — pre-B10 behaviour — rather than not starting.
      console.error("run-agent: chain scope insert failed; starting unscoped", inserted.error?.message);
      scope = null;
      inserted = await userDb.from("agent_runs").insert({
        element_id: id, domain_id: domainId, triggered_from: "board", triggered_by: user.id, status: "queued", mode: "execute",
      }).select("id").single();
    }
    const { data: next, error } = inserted;
    if (error || !next) continue; // another start won the race
    const driveJwt = scope ? await chainDriveJwt(user.id, scope, next.id, a.jwt) : a.jwt;
    const res = await fetch(`${a.supabaseUrl}/functions/v1/run-agent`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${driveJwt}` },
      body: JSON.stringify({ runId: next.id }),
    }).catch(() => null);
    if (res && res.ok) {
      started.push(id);
      if (scope) startedLines.push(`「${el?.title ?? id}」: 連携 ${scope.integrations.length} 件・操作 ${scope.actions.length} 件まで、深さ ${scope.depth}/${scope.maxDepth}`);
    }
    else await admin.from("agent_runs").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", next.id).eq("status", "queued");
  }
  // The cap, said in the three places a person looks (design §4.2):
  // the parent run's trace, each held Element's thread, and one
  // notice to the parent run's starter. The Elements stay ready; a
  // person's own start begins them as a new root and resets the
  // depth — by a person's act, as every widening in this design is.
  if (capped.length && parent) {
    const maxDepth = parent.scope?.maxDepth ?? CHAIN_POLICY.maxDepth;
    const titles = capped.map((c) => c.title);
    await addStep(admin, parent.id, "status",
      `連鎖の深さ上限（${maxDepth}）に達したため、「${titles.join("」「")}」は開始しませんでした`,
      `開始しなかった作業: ${titles.join("、")}`);
    for (const c of capped) {
      await admin.from("element_comments").insert({
        element_id: c.elementId, author_id: user.id, author_kind: "ai_agent", author_name: "Alcon Agent",
        content: `**連鎖の上限** — 連鎖の深さ上限（${maxDepth}）に達したため、この作業は自動では開始しませんでした。起点の実行: ${parent.scope?.rootRunId ?? parent.id}。開始ボタンで新しく始められます（新しい連鎖として始まります）。`,
      }).then(() => {}, () => {});
    }
    await admin.from("notifications").insert({
      recipient_id: parent.triggeredBy ?? user.id, actor_name: "Alcon Agent", kind: "status_change", element_id: doneId,
      title: "連鎖の上限に達しました", body: titles.join("、"),
    }).then(() => {}, () => {});
  }
  return { started, skipped, startedLines, capped };
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
