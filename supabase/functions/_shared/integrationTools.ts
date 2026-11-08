// What every agent caller shares about a Space's integrations, apart from
// the caller's own bookkeeping: how a connection's manifest becomes tools
// (names, descriptions, schemas), how one call is judged for approval, how
// it is shown on an approval card, and how it runs. run-agent adds its run
// machinery around these (steps, transcripts, continuations, PR linking);
// alcon-copilot calls the same pieces directly, so a manifest means the
// same thing at both entries and there is no second manifest→tool code.
//
// Scope of the shared assembly (buildSpaceIntegrationTools): an
// integration contributes the commands its manifest declares — for MCP the
// server tools the manifest names, for an API its http commands. A
// connection with no manifest declares nothing and stays closed here: an
// untested MCP connection has no declared operations at all, and a bare
// HTTP API's raw http_request is a run's tool (a run can pause for its
// approval and resume), not a manifest command. Google Drive's typed tools
// are likewise a run's surface today; a Drive row is reported as down.
//
// Assembly is definition only: the planned tools come from the plan cache
// (_shared/integrationPlans.ts) whenever it can vouch for them, and the
// binding — the Vault secret, the MCP session — is resolved lazily by
// bindingOf on the first call that actually runs, memoized for the rest
// of the request. A connection the turn never calls costs one row in one
// select and nothing else. Approval never needs the binding: the facts
// are gathered from the manifest and the command alone.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ToolCall } from "./agentLoop.ts";
import type { RunToolDef } from "./toolLoading.ts";
import {
  commandSchema, criticalClassForTokens, criticalClassOf, decide, offeredCommands, parseManifest, requestFor,
  type CommandPresent, type CriticalClass, type Manifest, type ManifestCommand,
} from "./connectorManifest.ts";
import { askReasonOf, type ApprovalFacts, type AskReason } from "./approvalPolicy.ts";
import { overlayPresentation } from "./approvalPresentations.ts";
import {
  McpSession, callHttp, httpIsRead, isAuthFailure, isSafeEndpoint, pointsAtAlcon, resolveCredential,
  type IntegrationRow, type RemoteTool,
} from "./integrationClient.ts";
import { isGoogleDriveRow } from "./googleOAuth.ts";
import { isGithubOAuthRow } from "./githubOAuth.ts";
import { runVerifyRead, verifyDiffText, type VerifyCheck } from "./verifyReads.ts";
import { loadToolPlans, planCacheState, planFingerprint, saveToolPlan } from "./integrationPlans.ts";
import { takeStashedCredentialForIntegration } from "./credentialRequests.ts";
import { recordIntegrationUse } from "./credentialUseAudit.ts";
import { driveOperationLabel, runDriveTool } from "./googleDrive.ts";
import { catalogOperation, catalogTool, decideCall, isCatalogTool, summaryOf } from "./catalog.ts";

// ── Names ───────────────────────────────────────────────────────────────────

/** Integration tools are named `<prefix>__<tool>`; everything else is ours. */
export const INTEGRATION_SEPARATOR = "__";

/** Pure. A tool-name prefix for an integration, stable across a run's slices (keyed on its id). */
export function integrationPrefix(name: string, id: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 16);
  return `${base || "x"}_${id.replace(/-/g, "").slice(0, 4)}`;
}

/** Pure. A valid tool name (≤64 chars, [a-zA-Z0-9_-]) not already taken. */
export function uniqueToolName(raw: string, taken: Map<string, unknown>): string {
  const base = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 64 - String(n).length - 1)}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ── One tool, one call ──────────────────────────────────────────────────────

/** What running one call needs from its connection: the credential to
 *  send, and — for MCP — the initialized session to call through. */
export interface IntegrationBinding {
  secret: string | null;
  session: McpSession | null;
}

/**
 * One integration tool the agent sees. `remote` describes an MCP tool or a
 * typed Drive tool (its readOnly decides read vs write); null is the generic
 * http_request. `drive` marks the Google Drive tools, which run through
 * runDriveTool with the binding's secret as the access token.
 *
 * The binding is separate from the definition: a tool assembled from a
 * manifest or a cached plan carries `bind` and pays for its secret and
 * session only when a call runs (bindingOf memoizes it for the request).
 * A caller that already holds them (a run's Drive tools) sets `secret` /
 * `session` eagerly instead.
 */
export interface IntegrationTool {
  integration: IntegrationRow; remote: RemoteTool | null; drive?: boolean;
  /** The declared command this tool is, when the integration has a manifest. */
  command?: ManifestCommand; manifest?: Manifest;
  /** An eagerly held credential / session, when the caller bound them. */
  secret?: string | null; session?: McpSession | null;
  /** Resolves the binding on first use; see lazyBinding. */
  bind?: () => Promise<IntegrationBinding>;
  /** The binding's memo, once resolution has started. */
  binding?: Promise<IntegrationBinding>;
}

/**
 * The tool's binding, resolved once per request: through `bind` when the
 * tool was assembled lazily, otherwise the eagerly held secret / session.
 * A resolution failure rejects every later call the same way — the first
 * call's error is the honest one to report.
 */
export function bindingOf(it: IntegrationTool): Promise<IntegrationBinding> {
  if (!it.binding) {
    it.binding = it.bind
      ? it.bind()
      : Promise.resolve({ secret: it.secret ?? null, session: it.session ?? null });
  }
  return it.binding;
}

/**
 * Binds a connection at execution time: the secret out of Vault (service
 * role, as everywhere), resolved to a current credential, and — for MCP —
 * a session initialized against the server. Nothing here runs at assembly
 * time, so an integration no call touches is never bound at all.
 */
export function lazyBinding(
  admin: SupabaseClient,
  row: IntegrationRow,
  opts?: { consumeStash?: boolean; auditUse?: { spaceId: string; runId: string | null } },
): () => Promise<IntegrationBinding> {
  return async () => {
    const { data: raw } = await admin.rpc("get_integration_secret", { p_integration_id: row.id });
    let secret = await resolveCredential(admin, row, (raw as string | null) ?? null);
    // Use-once (secure-login PR2): an execution binding — never a
    // test's or a draft's — whose slot is empty may take the one-time
    // credential a person stashed for this connection's pending
    // capture request. The take is single and deletes the value; it
    // lives in this binding's memory only and is never written back.
    let fromStash = false;
    if (!secret && opts?.consumeStash && (row.auth_type === "bearer" || row.auth_type === "header")) {
      secret = await takeStashedCredentialForIntegration(admin, row.id, opts?.auditUse?.runId).catch(() => null);
      fromStash = !!secret;
    }
    if (row.kind === "mcp") {
      const session = new McpSession(row, secret);
      await session.initialize();
      // The credential audit (secure-login PR4, §3.8): a binding that
      // resolved with a real credential records its one 'used' row —
      // once per binding, after the resolution fully succeeded. A
      // stash spend is already recorded by the take itself.
      if (opts?.auditUse && secret && !fromStash) {
        await recordIntegrationUse(admin, { spaceId: opts.auditUse.spaceId, integrationId: row.id, runId: opts.auditUse.runId });
      }
      return { secret, session };
    }
    if (opts?.auditUse && secret && !fromStash) {
      await recordIntegrationUse(admin, { spaceId: opts.auditUse.spaceId, integrationId: row.id, runId: opts.auditUse.runId });
    }
    return { secret, session: null };
  };
}

/** One call as the approval card shows it, stored with the pending action. */
export interface ApprovalDisplay {
  id: string; integration: string; operation: string;
  /** Where the call goes: the connection's base URL, or "Alcon" for its own tools. */
  destination: string;
  /** A manifest HTTP command's resolved request line (`POST /repos/…`), when it has one. */
  detail: string | null;
  effect: "read" | "write";
  critical: CriticalClass | null;
  /** Only a manifest command that is not critical can become a standing rule. */
  rememberable: boolean;
  /** The action as a person reads it: "Create a pull request" (display v2). */
  title: string;
  /** The labeled fields the decision turns on, values resolved from the call's input. */
  fields: { label: string; value: string }[];
  /** The content the decision turns on (a PR body, a file's content, a message), capped; null when the command declares none. */
  preview: string | null;
  /** Why this call is being asked about, when its own facts hold it; the ask mode's reason is named by displaysUnderMode. */
  askReason: AskReason | null;
}

const MAX_VALUE = 160;
const MAX_FIELDS = 6;
const MAX_PREVIEW = 600;

/** Pure. A call value as one line of card text — the same caps the web's
 *  readableFields applies, so a v1 rendering and a v2 one agree. */
function showValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.length <= 3 && v.every((x) => typeof x !== "object")) return v.join(", ");
  const s = JSON.stringify(v) ?? String(v);
  return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}…` : s;
}

/** Pure. A preview argument's value as card text: the string itself, or
 *  its JSON, capped at the preview's own (larger) limit. */
function previewText(v: unknown): string {
  const s = typeof v === "string" ? v : (JSON.stringify(v) ?? String(v));
  return s.length > MAX_PREVIEW ? `${s.slice(0, MAX_PREVIEW)}…` : s;
}

/**
 * Pure. A sentence-shaped title from an operation or tool name, for a
 * command with no presentation of its own: the last dotted segment,
 * snake_case and camelCase opened into words, the first letter raised.
 * `create_pull_request` → "Create pull request".
 */
export function humanizedTitle(operation: string): string {
  const last = operation.split(".").pop() ?? operation;
  const words = last.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[_\-\s]+/).filter(Boolean).join(" ").toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : operation;
}

/**
 * Pure. The fields a call shows when no presentation names them: for an
 * HTTP call its query and body, otherwise its arguments — the generic
 * flattening the card's first generation rendered from the raw input,
 * so a fallback row and a v1 row read alike.
 */
function fallbackFields(input: Record<string, unknown>): { label: string; value: string }[] {
  const isHttp = typeof input.method === "string";
  const all: { label: string; value: string }[] = [];
  if (isHttp) {
    if (input.query && typeof input.query === "object") {
      for (const [k, v] of Object.entries(input.query as Record<string, unknown>)) all.push({ label: `?${k}`, value: showValue(v) });
    }
    if (input.body && typeof input.body === "object" && !Array.isArray(input.body)) {
      for (const [k, v] of Object.entries(input.body as Record<string, unknown>)) all.push({ label: k, value: showValue(v) });
    } else if (input.body !== undefined && input.body !== null) {
      all.push({ label: "body", value: showValue(input.body) });
    }
  } else {
    for (const [k, v] of Object.entries(input)) all.push({ label: k, value: showValue(v) });
  }
  return all.slice(0, MAX_FIELDS);
}

/** Pure. The presentation a call renders with: its command's own block
 *  first, then the overlay for its tool's names, then nothing (the
 *  fallback anatomy still applies — only the labels are plainer). */
function presentationFor(it: IntegrationTool, input: Record<string, unknown>): CommandPresent | null {
  if (it.command?.present) return it.command.present;
  return overlayPresentation([it.remote?.name, it.command?.mcp, it.command?.name], input);
}

/** The operation an integration call shows on the approval card and in the log. */
export function operationOf(it: IntegrationTool | undefined, input: Record<string, unknown>): string {
  if (it?.command) return it.command.action;
  if (it?.drive && it.remote) return driveOperationLabel(it.remote.name, input);
  if (it?.remote) return it.remote.name;
  return `${input.method ?? ""} ${input.path ?? ""}`.trim();
}

/** Whether one call reads: its command's effect, its tool's readOnly, or the HTTP method. */
export function integrationCallIsRead(it: IntegrationTool | undefined, call: ToolCall): boolean {
  if (!it) return false;
  if (it.command) return it.command.effect === "read";
  return it.remote ? it.remote.readOnly : httpIsRead(call.input);
}

/** The critical class of a call, from its command's fields or (Drive) its tool's name. */
export function criticalOfTool(it: IntegrationTool | undefined): CriticalClass | null {
  if (!it) return null;
  if (it.command) return criticalClassOf(it.command);
  if (it.drive && it.remote) return criticalClassForTokens(it.remote.name, "write");
  return null;
}

/** What the approval card is told about one call: where it goes, what it
 *  is, whether it is critical, and whether approving may be remembered —
 *  plus, as display v2, how it reads to the person deciding: the action
 *  as a sentence, the labeled fields and the content preview its
 *  command's presentation (or the overlay, or the fallback) gives it,
 *  and the reason it is being asked about. Persisted with the pending
 *  action, so every surface — and the audit's drill-down — reads exactly
 *  what was decided about. */
export function approvalDisplayForCall(tools: Map<string, IntegrationTool>, c: ToolCall): ApprovalDisplay {
  const it = tools.get(c.name);
  if (!it) {
    if (isCatalogTool(c.name)) {
      const tool = catalogTool(c.name);
      // The Element entry's decision, as the run's own facts gather it:
      // the one entry whose calls can wait on a card built here.
      const askReason = askReasonOf({
        catalogDecision: tool ? decideCall("element", tool, c.input) : "allow", isWrite: true, isRead: false,
      });
      const operation = catalogOperation(c.name, c.input);
      return {
        id: c.id, integration: "Alcon", operation, destination: "Alcon", detail: null, effect: "write", critical: null, rememberable: false,
        title: humanizedTitle(c.name), fields: fallbackFields(c.input), preview: null, askReason,
      };
    }
    const parts = c.name.split(INTEGRATION_SEPARATOR);
    const operation = parts.slice(1).join(INTEGRATION_SEPARATOR) || c.name;
    return {
      id: c.id, integration: parts[0], operation, destination: parts[0], detail: null, effect: "write", critical: null, rememberable: false,
      title: humanizedTitle(operation), fields: fallbackFields(c.input), preview: null, askReason: null,
    };
  }
  const critical = criticalOfTool(it);
  let detail: string | null = null;
  if (it.command?.http) {
    const req = requestFor(it.command, c.input);
    if (!("error" in req)) detail = `${req.method} ${req.path}`;
  }
  const operation = operationOf(it, c.input);
  const effect = it.command ? it.command.effect : integrationCallIsRead(it, c) ? "read" : "write";
  const present = presentationFor(it, c.input);
  const fields = present?.fields?.length
    ? present.fields.flatMap((f) => (c.input[f.arg] === undefined ? [] : [{ label: f.label, value: showValue(c.input[f.arg]) }]))
    : fallbackFields(c.input);
  const previewArg = present?.preview;
  return {
    id: c.id, integration: it.integration.name, operation,
    destination: it.integration.endpoint, detail,
    effect, critical, rememberable: !!it.command && !critical,
    title: present?.title ?? humanizedTitle(operation),
    fields,
    preview: previewArg && c.input[previewArg] !== undefined && c.input[previewArg] !== null
      ? previewText(c.input[previewArg]) : null,
    askReason: askReasonOf(integrationApprovalFacts(it, c, effect === "write")),
  };
}

/** Pure. One line naming what a batch of calls will do, grouping the
 *  same operation: "GitHub · create_issue × 3、Slack · post_message". */
export function approvalSummary(display: { integration: string; operation: string }[]): string {
  const groups = new Map<string, number>();
  for (const d of display) {
    const key = `${d.integration} · ${d.operation || "書き込み"}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()].map(([k, n]) => (n > 1 ? `${k} × ${n}` : k)).join("、");
}

/**
 * The facts needsApprovalFor judges for one integration call, gathered the
 * one way every caller gathers them: a manifest command is decided by its
 * manifest (permission, the rule that matched, criticality); a typed Drive
 * tool by its name's critical class; the raw http_request by its method.
 */
export function integrationApprovalFacts(it: IntegrationTool | undefined, call: ToolCall, isWrite: boolean): ApprovalFacts {
  const facts: ApprovalFacts = {
    isWrite,
    isRead: integrationCallIsRead(it, call),
    delegation: it?.integration.delegation ?? null,
  };
  if (it?.command && it.manifest) {
    const d = decide(it.manifest, it.command, call.input);
    facts.manifest = { permission: d.permission, rule: d.rule, critical: criticalClassOf(it.command) };
  } else if (it?.drive && it.remote) {
    facts.critical = criticalClassForTokens(it.remote.name, "write");
  } else if (it && !it.remote) {
    // No command and no typed tool: the raw http_request tool.
    facts.rawHttp = true;
  }
  return facts;
}

/**
 * Runs one integration call and returns what the service answered. A
 * manifest's deny rules are checked again at the moment it runs: an
 * approval given before a rule denied these arguments does not carry them
 * through. A declared API command becomes exactly the request its manifest
 * maps it to. What a caller does with a successful answer (a run links the
 * GitHub pulls it opened to its Element) is the caller's own post-step.
 */
/** Pure. The refusal a manifest-denied call is answered with — one wording,
 *  whether the refusal comes from the approval gate (a deny verdict is
 *  answered before dispatch) or from the executor's own recheck below. */
export function manifestDenyRefusal(commandName: string): string {
  return `${commandName} はこの引数では許可されていません（連携のルール）。別の引数にするか、人に頼んでください。`;
}

export async function executeIntegrationTool(it: IntegrationTool, call: ToolCall): Promise<{ text: string; isError: boolean; verify?: VerifyCheck }> {
  if (it.command && it.manifest && decide(it.manifest, it.command, call.input).permission === "deny") {
    return { text: manifestDenyRefusal(it.command.name), isError: true };
  }
  // A declared API command becomes exactly the request its manifest maps it to.
  let httpInput: Record<string, unknown> = call.input;
  if (it.command?.http) {
    const req = requestFor(it.command, call.input);
    if ("error" in req) return { text: req.error, isError: true };
    httpInput = req;
  }
  // The binding is resolved here, at the moment the call runs — never at
  // assembly, and never for the approval decision, which reads only the
  // manifest facts gathered from this same tool.
  const binding = await bindingOf(it);
  const r = it.drive && it.remote
    ? await runDriveTool(it.remote.name, call.input, binding.secret ?? "")
    : it.remote && binding.session
      ? await binding.session.callTool(it.remote.name, call.input)
      : await callHttp(it.integration, binding.secret, httpInput);
  if (r.isError || !it.command?.verify || !it.manifest) return r;
  // Manifest v2 (B2): the write declares a read-back. It runs through this
  // same executor as the read command it names — the deny recheck above
  // included, since a verify read is a read like any other: it cannot ask
  // and cannot be gated. The read command carries no verify of its own
  // (the parser forbids it), so this recursion is exactly one level deep.
  // A failed verify never re-runs the write.
  const manifest = it.manifest;
  const declaration = it.command.verify;
  const verify = await runVerifyRead({
    manifest, declaration, writeInput: call.input, writeResultText: r.text,
    deps: {
      callRead: async (readCommand, input) => {
        const readTool: IntegrationTool = {
          ...it, command: readCommand,
          remote: readCommand.mcp
            ? (it.remote ? { ...it.remote, name: readCommand.mcp } : it.remote)
            : null,
        };
        const rr = await executeIntegrationTool(readTool, { id: `${call.id}:verify`, name: call.name, input });
        return { text: rr.text, isError: rr.isError };
      },
    },
  });
  if (verify.ok) return { text: r.text, isError: false, verify };
  if (verify.unverified) {
    // Absence of evidence is not evidence: the write stands, and the
    // result says plainly that it stands unconfirmed.
    return { text: `${r.text}\n（書き込み後の読み戻し確認はできませんでした: ${verify.unverified}）`, isError: false, verify };
  }
  // A mismatch is a fact about the world, returned as an error naming the
  // fields (errors as useful feedback), so the caller's loop can correct
  // the write while correction is still cheap.
  return {
    text: `${r.text}\n\n書き込みは実行されましたが、読み戻した状態が意図と一致しませんでした。${verifyDiffText(verify.diff ?? [])}。実際の状態を読み直して、必要なら書き込みを直してください。`,
    isError: true, verify,
  };
}

// ── Manifest → tools (pure) ─────────────────────────────────────────────────

export interface PlannedIntegrationTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  command: ManifestCommand;
  /** The MCP server tool the command calls; null for an HTTP command. */
  remote: RemoteTool | null;
}

/**
 * Pure. The tools one integration's manifest declares, named and described
 * the way a run names them. For MCP (remoteTools given): the server's tools
 * the manifest declares, under their commands' names — a tool the manifest
 * does not name is not offered. For an API: the declared commands with an
 * http mapping, under the manifest's own schemas. No manifest — or one that
 * declares nothing usable — plans no tools. Names are taken from `taken`
 * (the caller's tool map) so they cannot collide.
 */
export function planManifestTools(
  row: Pick<IntegrationRow, "name" | "id">,
  manifest: Manifest | null,
  remoteTools: RemoteTool[] | null,
  taken: Map<string, unknown>,
): PlannedIntegrationTool[] {
  if (!manifest) return [];
  const prefix = integrationPrefix(row.name, row.id);
  const out: PlannedIntegrationTool[] = [];
  if (remoteTools) {
    const declared = offeredCommands(manifest).filter((c) => c.mcp);
    for (const t of remoteTools) {
      const command = declared.find((c) => c.mcp === t.name);
      if (!command) continue;
      const name = uniqueToolName(`${prefix}${INTEGRATION_SEPARATOR}${command.name}`, taken);
      taken.set(name, true);
      out.push({ name, description: `[${row.name}] ${command.description || t.description}`.slice(0, 1024), input_schema: t.inputSchema, command, remote: t });
    }
    return out;
  }
  for (const c of offeredCommands(manifest).filter((c) => c.http)) {
    const name = uniqueToolName(`${prefix}${INTEGRATION_SEPARATOR}${c.name}`, taken);
    taken.set(name, true);
    out.push({
      name,
      description: `[${row.name}] ${c.description || c.action}（${c.effect === "read" ? "読み取り" : "書き込み"}）`.slice(0, 1024),
      input_schema: commandSchema(c), command: c, remote: null,
    });
  }
  return out;
}

/**
 * Pure. Takes a stored plan's tools into one assembly: the names the plan
 * was made with are kept, except a name this assembly already holds, which
 * is renamed the way planManifestTools would name it. The plan's own
 * objects are not mutated (a rename copies).
 */
export function adoptPlannedTools(planned: PlannedIntegrationTool[], taken: Map<string, unknown>): PlannedIntegrationTool[] {
  return planned.map((p) => {
    if (!taken.has(p.name)) {
      taken.set(p.name, true);
      return p;
    }
    const name = uniqueToolName(p.name, taken);
    taken.set(name, true);
    return { ...p, name };
  });
}

// ── A Space's toolset ───────────────────────────────────────────────────────

export interface IntegrationUsable { name: string; kind: "MCP" | "API"; delegation: string; tools: number }
export interface IntegrationDown { name: string; reason: string }

export interface SpaceIntegrationTools {
  defs: RunToolDef[];
  tools: Map<string, IntegrationTool>;
  usable: IntegrationUsable[];
  down: IntegrationDown[];
}

const MAX_INTEGRATION_TOOLS = 120;

/**
 * A Space's connected integrations as tools for a caller that is not a run
 * (the AI panel): the rows the person can see (their JWT, so membership
 * decides), enabled, MCP or HTTP, with the same closings a run applies —
 * an unsafe endpoint is skipped, a manifest that declares nothing usable
 * closes its integration, an untested MCP connection stays closed, a
 * connection pointing at Alcon itself is never used. What cannot be used
 * is reported in `down` with the reason, so the agent can tell the person
 * instead of guessing.
 *
 * The definitions come from the plan cache whenever it can vouch for
 * them (one select for the whole Space); an MCP connection whose plan is
 * missing or too old is listed once and its plan stored. The binding is
 * never resolved here — a connection's secret leaves Vault only when a
 * call runs, through lazyBinding — so this assembly costs no secret read
 * and no session for a connection the turn never calls. A refetch that
 * fails with a plan on file still offers the plan's tools: the binding
 * resolves fresh when a call runs, and the call itself reports if the
 * tool is really gone. Only a first-ever assembly can be downed by a
 * connection failure.
 */
export async function buildSpaceIntegrationTools(args: {
  userDb: SupabaseClient;
  admin: SupabaseClient;
  spaceId: string;
  supabaseUrl: string | null;
  /** The run this assembly serves, when it serves one (a chat turn's
   *  run): the credential audit names it as the spender of what its
   *  bindings resolve. Absent, uses are recorded without a run. */
  auditRunId?: string | null;
}): Promise<SpaceIntegrationTools> {
  const { userDb, admin, spaceId } = args;
  const tools = new Map<string, IntegrationTool>();
  const defs: RunToolDef[] = [];
  const usable: IntegrationUsable[] = [];
  const down: IntegrationDown[] = [];
  const { data: rows } = await userDb.from("integrations")
    .select("id, preset, kind, name, description, endpoint, auth_type, auth_header, delegation, enabled, manifest, guide, updated_at")
    .eq("activity_space_id", spaceId).eq("enabled", true).in("kind", ["mcp", "http"]).order("created_at");
  const list = (rows ?? []) as (IntegrationRow & { enabled: boolean; manifest: unknown; guide: string | null; updated_at?: string | null })[];
  const cachedPlans = await loadToolPlans(admin, list.map((r) => r.id));
  for (const row of list) {
    if (!isSafeEndpoint(row.endpoint)) continue;
    // Drive's tools are typed, not manifest commands; they are a run's
    // surface today (see the header), so the row is reported, not opened.
    if (isGoogleDriveRow(row)) {
      down.push({ name: row.name, reason: "Google Drive の道具はチャットではまだ使えません" });
      continue;
    }
    // A manifest declares what the integration may be asked to do. One that
    // declares nothing usable closes the integration rather than opening it.
    let manifest: Manifest | null = null;
    if (row.manifest != null) {
      const parsed = parseManifest(row.manifest);
      if (offeredCommands(parsed.manifest).length === 0) {
        down.push({ name: row.name, reason: "使える操作が宣言されていません（Settings › Customize で接続テストが必要）" });
        continue;
      }
      manifest = parsed.manifest;
    }
    // An MCP connection that was never tested has no manifest: nothing
    // declares what it may be asked to do, so it stays closed.
    if (row.kind === "mcp" && row.manifest == null) {
      down.push({ name: row.name, reason: "接続テストが済んでいない（Settings › Customize で接続テストが必要）" });
      continue;
    }
    // Never Alcon itself: the board tools already act as the person, and a
    // stored token would act outside their authority.
    if (pointsAtAlcon(row.endpoint, args.supabaseUrl)) {
      down.push({ name: row.name, reason: "Alcon 自身を指しているため使いません（Alcon のデータは標準の道具で操作します）" });
      continue;
    }
    // OAuth here is GitHub's sign-in; any other OAuth row has no way to authenticate.
    if (row.auth_type === "oauth" && !isGithubOAuthRow(row)) continue;
    // An API with no manifest has no declared commands to offer here.
    if (row.kind === "http" && !manifest) {
      down.push({ name: row.name, reason: "コマンドの宣言（manifest）がないため、チャットではまだ使えません" });
      continue;
    }

    const fingerprint = await planFingerprint(row);
    const cached = cachedPlans.get(row.id);
    // The panel executes work, so its bindings may take a use-once
    // stash (lazyBinding's rule) — a connection test never comes
    // through here, so a test cannot spend one.
    const bind = lazyBinding(admin, row, { consumeStash: true, auditUse: { spaceId, runId: args.auditRunId ?? null } });
    const offer = (planned: PlannedIntegrationTool[], toolBind: IntegrationTool["bind"]) => {
      for (const p of planned) {
        if (defs.length >= MAX_INTEGRATION_TOOLS) break;
        tools.set(p.name, { integration: row, remote: p.remote, command: p.command, ...(manifest ? { manifest } : {}), bind: toolBind });
        defs.push({ name: p.name, description: p.description, input_schema: p.input_schema, defer: true });
      }
    };

    if (row.kind === "http") {
      // An API's plan is pure — the cache only saves the planning itself.
      if (cached && planCacheState(cached, fingerprint, row.kind, Date.now()) === "use") {
        offer(adoptPlannedTools(cached.plan, tools), bind);
        usable.push({ name: row.name, kind: "API", delegation: row.delegation, tools: cached.plan.length });
      } else {
        const planned = planManifestTools(row, manifest, null, tools);
        await saveToolPlan(admin, row.id, fingerprint, planned);
        offer(planned, bind);
        usable.push({ name: row.name, kind: "API", delegation: row.delegation, tools: planned.length });
      }
      continue;
    }

    // MCP: the plan carries the server's tool list, so it is the one that
    // can go stale in a way the row cannot show.
    if (cached && planCacheState(cached, fingerprint, row.kind, Date.now()) === "use") {
      offer(adoptPlannedTools(cached.plan, tools), bind);
      usable.push({ name: row.name, kind: "MCP", delegation: row.delegation, tools: cached.plan.length });
      continue;
    }
    try {
      const { data: raw } = await admin.rpc("get_integration_secret", { p_integration_id: row.id });
      // An OAuth token set becomes a current access token here (refreshed
      // when due); other credentials pass through as stored.
      const secret = await resolveCredential(admin, row, (raw as string | null) ?? null);
      if (isGithubOAuthRow(row) && !secret) {
        down.push({ name: row.name, reason: "GitHub にサインインしていない（Settings › Customize でサインインが必要）" });
        continue;
      }
      const session = new McpSession(row, secret);
      await session.initialize();
      const remoteTools = await session.listTools();
      // The listing opened an authenticated session with the
      // credential: a spend, recorded like a binding's (PR4, §3.8).
      if (secret) await recordIntegrationUse(admin, { spaceId, integrationId: row.id, runId: args.auditRunId ?? null });
      const planned = planManifestTools(row, manifest, remoteTools, tools);
      await saveToolPlan(admin, row.id, fingerprint, planned);
      // The listing already paid for this binding: the tools keep it
      // instead of initializing a second session when a call runs.
      const bound = Promise.resolve<IntegrationBinding>({ secret, session });
      offer(planned, () => bound);
      usable.push({ name: row.name, kind: "MCP", delegation: row.delegation, tools: planned.length });
    } catch (e) {
      if (cached) {
        offer(adoptPlannedTools(cached.plan, tools), bind);
        usable.push({ name: row.name, kind: "MCP", delegation: row.delegation, tools: cached.plan.length });
        continue;
      }
      const message = e instanceof Error ? e.message : String(e);
      down.push({
        name: row.name,
        reason: isAuthFailure(message)
          ? (row.auth_type === "oauth" ? "認証が切れている（Settings › Customize でサインインし直す必要がある）" : "認証に失敗した（Settings › Customize で認証情報を直す必要がある）")
          : `接続できない: ${message.slice(0, 200)}`,
      });
    }
  }
  return { defs, tools, usable, down };
}

// ── Prompt copy (pure) ──────────────────────────────────────────────────────

/** Pure. What the panel's system prompt says about this Space's
 *  integrations: the ones it can use, with how their writes are held, and
 *  the ones it cannot, with the reason — never a blanket "external
 *  services are unsupported". */
export function integrationPromptSection(toolset: Pick<SpaceIntegrationTools, "usable" | "down">): string {
  const lines: string[] = ["# この Space の連携（外部サービス）"];
  if (toolset.usable.length) {
    lines.push("次の連携が接続済みで、道具として使える（道具は末尾の一覧にあり、検索で読み込まれる）。読み取りはそのまま実行される。書き込みは連携の権限と委任に従い、承認が必要なものはこのチャットに承認カードが出て、人が承認するまで実行されない。承認待ちになった操作を実行済みとして扱わない。");
    for (const u of toolset.usable) {
      lines.push(`- ${u.name}（${u.kind}、道具 ${u.tools} 件、書き込みの委任: ${u.delegation === "full_delegation" ? "全面的に委任（重要な操作は常に承認）" : "都度承認"}）`);
    }
  } else {
    lines.push("この Space でチャットから使える連携は今はない。連携は Settings › Customize で接続し、接続テストで操作が宣言されると、ここでも使えるようになる。「外部サービスには対応していない」とは答えず、接続すれば使えることを伝える。");
  }
  for (const d of toolset.down) lines.push(`- ${d.name}: ${d.reason}`);
  return lines.join("\n");
}

/** Pure. The deferred-tool index for integration tools, grouped by
 *  integration, in the catalog index's shape. */
export function integrationIndexLines(toolset: Pick<SpaceIntegrationTools, "defs" | "tools">): string {
  if (!toolset.defs.length) return "";
  const groups = new Map<string, string[]>();
  for (const d of toolset.defs) {
    const g = toolset.tools.get(d.name)?.integration.name ?? "連携";
    groups.set(g, [...(groups.get(g) ?? []), `- ${d.name}: ${summaryOf(d.description)}`]);
  }
  return `# ほかに使える道具（連携）\n${[...groups].map(([g, lines]) => `## ${g}\n${lines.join("\n")}`).join("\n")}`;
}
