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
  type CriticalClass, type Manifest, type ManifestCommand,
} from "./connectorManifest.ts";
import type { ApprovalFacts } from "./approvalPolicy.ts";
import {
  McpSession, callHttp, httpIsRead, isAuthFailure, isSafeEndpoint, pointsAtAlcon, resolveCredential,
  type IntegrationRow, type RemoteTool,
} from "./integrationClient.ts";
import { isGoogleDriveRow } from "./googleOAuth.ts";
import { isGithubOAuthRow } from "./githubOAuth.ts";
import { loadToolPlans, planCacheState, planFingerprint, saveToolPlan } from "./integrationPlans.ts";
import { driveOperationLabel, runDriveTool } from "./googleDrive.ts";
import { catalogOperation, isCatalogTool, summaryOf } from "./catalog.ts";

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
export function lazyBinding(admin: SupabaseClient, row: IntegrationRow): () => Promise<IntegrationBinding> {
  return async () => {
    const { data: raw } = await admin.rpc("get_integration_secret", { p_integration_id: row.id });
    const secret = await resolveCredential(admin, row, (raw as string | null) ?? null);
    if (row.kind === "mcp") {
      const session = new McpSession(row, secret);
      await session.initialize();
      return { secret, session };
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
 *  is, whether it is critical, and whether approving may be remembered. */
export function approvalDisplayForCall(tools: Map<string, IntegrationTool>, c: ToolCall): ApprovalDisplay {
  const it = tools.get(c.name);
  if (!it) {
    if (isCatalogTool(c.name)) {
      return { id: c.id, integration: "Alcon", operation: catalogOperation(c.name, c.input), destination: "Alcon", detail: null, effect: "write", critical: null, rememberable: false };
    }
    const parts = c.name.split(INTEGRATION_SEPARATOR);
    return { id: c.id, integration: parts[0], operation: parts.slice(1).join(INTEGRATION_SEPARATOR) || c.name, destination: parts[0], detail: null, effect: "write", critical: null, rememberable: false };
  }
  const critical = criticalOfTool(it);
  let detail: string | null = null;
  if (it.command?.http) {
    const req = requestFor(it.command, c.input);
    if (!("error" in req)) detail = `${req.method} ${req.path}`;
  }
  return {
    id: c.id, integration: it.integration.name, operation: operationOf(it, c.input),
    destination: it.integration.endpoint, detail,
    effect: it.command ? it.command.effect : integrationCallIsRead(it, c) ? "read" : "write",
    critical, rememberable: !!it.command && !critical,
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
export async function executeIntegrationTool(it: IntegrationTool, call: ToolCall): Promise<{ text: string; isError: boolean }> {
  if (it.command && it.manifest && decide(it.manifest, it.command, call.input).permission === "deny") {
    return { text: `${it.command.name} はこの引数では許可されていません（連携のルール）。別の引数にするか、人に頼んでください。`, isError: true };
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
  return { text: r.text, isError: r.isError };
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
    const bind = lazyBinding(admin, row);
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
