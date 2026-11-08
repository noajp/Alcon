import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  addElementCommentById, errorMessage, resolveElementIdTraced, runBoardTool, updateElementById,
  type BoardActor, type ResolveStage, type ToolDef, type ToolResult,
} from "./boardTools.ts";

// How an agent outside the app (Claude Code over MCP, a script over REST)
// reports on an Element it works: take it (the lease), say how it is going,
// and close with an outcome — done, partly done, or blocked on a person.
// The in-app run-agent reports the same things through its own tools; these
// write to what a person already reads: the lease on the row, comments on
// the Element, its status, and the Activity rail.
//
// The lease goes through claim_element() / release_element() only — the
// columns refuse any other writer. A comment from the caller's JWT cannot
// carry the `holder` stamp that renews a lease (only the service role may
// set it), so a progress report renews by claiming again as the same holder.

export const AGENT_REPORT_TOOLS: ToolDef[] = [
  {
    name: "claimElement",
    description:
      "Element に着手したことを宣言する（lease）。40 分で切れ、logProgress で延長される。別のセッションが持っている間は断られるので、その Element は進めない。" +
      "session には作業ごとに変わる名前（worktree 名やブランチ名）を渡し、logProgress / reportOutcome / releaseElement でも同じ値を使う。",
    input_schema: {
      type: "object",
      properties: {
        elementId: { type: "string", description: "Element id（UUID または display_id）" },
        branch: { type: "string", description: "作業するブランチ名（任意）" },
        session: { type: "string", description: "このセッションを他と区別する名前（任意。英数字と ._-）" },
      },
      required: ["elementId"],
      additionalProperties: false,
    },
  },
  {
    name: "releaseElement",
    description: "claimElement で取った lease を返す。reportOutcome は自動で返すので、報告せずに手を引くときに使う。",
    input_schema: {
      type: "object",
      properties: {
        elementId: { type: "string", description: "Element id" },
        session: { type: "string", description: "claimElement で渡した session" },
      },
      required: ["elementId"],
      additionalProperties: false,
    },
  },
  {
    name: "logProgress",
    description:
      "計画・進捗・調べた結果を Element にコメントとして残す。steps を渡すと計画として番号付きで書く。人が後から追えるよう節目ごとに短く書く。" +
      "このセッションが lease を持っていれば延長する。",
    input_schema: {
      type: "object",
      properties: {
        elementId: { type: "string", description: "Element id" },
        title: { type: "string", description: "1 行の要約" },
        detail: { type: "string", description: "詳細（Markdown 可）" },
        steps: { type: "array", items: { type: "string" }, description: "計画の手順（任意）" },
        session: { type: "string", description: "claimElement で渡した session" },
      },
      required: ["elementId", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "reportOutcome",
    description:
      "作業を締めくくる報告。outcome: completed（達成。Element はレビュー待ちへ）/ partial（一部だけ。ステータスは変えない）/ blocked（権限を超える判断や資格情報が要る。Element はブロック中へ）。" +
      "message には何をしたか・根拠・残り・人に判断してほしいことを具体的に書く。コメントとして残り、担当者に通知される。lease は返す。",
    input_schema: {
      type: "object",
      properties: {
        elementId: { type: "string", description: "Element id" },
        outcome: { type: "string", enum: ["completed", "partial", "blocked"] },
        summary: { type: "string", description: "1 行の要約" },
        message: { type: "string", description: "報告本文（Markdown）。blocked なら人に確認したいこと" },
        session: { type: "string", description: "claimElement で渡した session" },
      },
      required: ["elementId", "outcome", "summary", "message"],
      additionalProperties: false,
    },
  },
];

export const AGENT_REPORT_TOOL_NAMES = AGENT_REPORT_TOOLS.map((t) => t.name);
const NAMES = new Set(AGENT_REPORT_TOOL_NAMES);

export function isAgentReportTool(name: string): boolean {
  return NAMES.has(name);
}

export type Outcome = "completed" | "partial" | "blocked";

/** A notification to the person who connected the caller (whoever builds the notifier fixes the recipient). */
export interface CallerNotice {
  actorName: string;
  elementId: string;
  title: string;
  body: string;
}
export type CallerNotifier = (notice: CallerNotice) => Promise<void>;

/**
 * Pure. What the connecting person is told when their agent closes work. The
 * triggers that notify on the comment and the status skip the actor — that
 * person — so without this, an Element they alone are assigned to would tell
 * nobody that it needs them.
 */
export function outcomeNotice(
  actorName: string,
  outcome: Outcome,
  el: { id: string; display_id?: string | null; title?: string | null },
  summary: string,
): CallerNotice {
  const label = outcome === "blocked" ? "対応が必要です" : outcome === "completed" ? "完了報告" : "途中報告";
  const name = [el.display_id, el.title].filter(Boolean).join(" ") || "Element";
  return { actorName, elementId: el.id, title: `${actorName}: ${label}`, body: `${name} — ${summary}`.slice(0, 200) };
}

const SESSION_UNSAFE = /[^A-Za-z0-9._-]/g;
const UUID_ARG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A failed resolution, recorded by whoever dispatched the call: the raw
 *  identifier, the stage it died at, and the session's user. Audit only —
 *  the surface keeps the translated "Element not found". Until this was
 *  recorded, a failed write-back was undiagnosable: the argument existed
 *  nowhere. */
export interface ResolveFailure {
  idArg: string;
  stage: ResolveStage;
  userId: string | null;
}

/**
 * The binding a dispatch may carry: the Element a run is about
 * (agent_runs.element_id), held by the driver that started the work.
 * Bound, the report tools act on that id directly — never a fresh string
 * resolution against the session's RLS luck (the smoke run's result
 * comment failed twice that way, once by UUID and once by display
 * number, while the run's own bookkeeping landed fine). Unbound callers
 * (a person chatting, an outside agent naming its Element) resolve
 * strings as before.
 */
export interface ReportBinding {
  elementId?: string | null;
  onResolveFailure?: (failure: ResolveFailure) => void | Promise<void>;
}

/**
 * Pure. The lease holder token for a caller: `<agent>@<user>[.<session>]`.
 * The user half keeps one person's agents from taking or releasing another
 * person's lease by naming the same client; the session half tells two
 * sessions of the same client apart. The agent label never contains "@"
 * (callerName.ts sanitizeName strips it), so the token splits where lease.ts expects.
 */
export function leaseHolder(actor: BoardActor, session?: unknown): string {
  const user = (actor.userId ?? "anon").replace(SESSION_UNSAFE, "").slice(0, 8) || "anon";
  const s = typeof session === "string" ? session.replace(SESSION_UNSAFE, "").slice(0, 40) : "";
  return `${actor.agent}@${user}${s ? `.${s}` : ""}`;
}

/** Pure. The comment a progress report leaves. */
export function progressComment(title: string, detail?: string, steps?: string[]): string {
  const head = steps && steps.length ? `**計画** — ${title}` : `**進捗** — ${title}`;
  const parts = [head];
  if (steps && steps.length) parts.push(steps.map((s, i) => `${i + 1}. ${s}`).join("\n"));
  if (detail && detail.trim()) parts.push(detail.trim());
  return parts.join("\n\n");
}

/** Pure. The comment an outcome leaves — the same wording run-agent uses. */
export function outcomeComment(outcome: Outcome, summary: string, message: string): string {
  const label = outcome === "blocked" ? "対応が必要です" : outcome === "completed" ? "完了報告" : "途中報告";
  return `**${label}** — ${summary}\n\n${message || summary}`;
}

/** Pure. Where an outcome moves the Element, or null to leave it. Done and cancelled work stays put. */
export function outcomeStatus(outcome: Outcome, current: string | null): string | null {
  const next = outcome === "completed" ? "review" : outcome === "blocked" ? "blocked" : null;
  if (!next || current === "done" || current === "cancelled" || current === next) return null;
  return next;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

type LeaseRow = { claimed_by: string | null; claim_expires_at: string | null; branch: string | null };

async function readLease(supabase: SupabaseClient, id: string): Promise<LeaseRow | null> {
  const { data } = await supabase.from("elements").select("claimed_by, claim_expires_at, branch").eq("id", id).maybeSingle();
  return (data as LeaseRow | null) ?? null;
}

async function renewIfHeld(supabase: SupabaseClient, id: string, holder: string): Promise<boolean> {
  const lease = await readLease(supabase, id);
  if (lease?.claimed_by !== holder) return false;
  const { data, error } = await supabase.rpc("claim_element", { p_element_id: id, p_holder: holder, p_branch: null });
  return !error && data === true;
}

async function releaseIfHeld(supabase: SupabaseClient, id: string, holder: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("release_element", { p_element_id: id, p_holder: holder });
  return !error && data === true;
}

export async function runAgentReportTool(
  supabase: SupabaseClient,
  name: string,
  input: Record<string, unknown>,
  actor: BoardActor,
  notify?: CallerNotifier,
  binding?: ReportBinding,
): Promise<ToolResult> {
  try {
    // The Element this call acts on: the binding when the dispatch
    // carries one (authoritative — a model-supplied UUID that disagrees
    // is an error the model can correct, never a re-resolution), else
    // the model-supplied string resolved under this session.
    const boundId = binding?.elementId || null;
    let id: string;
    if (boundId) {
      const supplied = String(input.elementId ?? "").trim();
      if (supplied && UUID_ARG.test(supplied) && supplied.toLowerCase() !== boundId.toLowerCase()) {
        return { ok: false, error: "elementId does not match the Element this work is bound to. Report on the bound Element (omit elementId), or start separate work for the other Element." };
      }
      id = boundId;
    } else {
      const traced = await resolveElementIdTraced(supabase, String(input.elementId ?? ""));
      if (!traced.id) {
        if (binding?.onResolveFailure) {
          await Promise.resolve(binding.onResolveFailure({
            idArg: String(input.elementId ?? ""), stage: traced.stage, userId: actor.userId ?? null,
          })).catch(() => undefined);
        }
        return { ok: false, error: "Element not found" };
      }
      id = traced.id;
    }
    const holder = leaseHolder(actor, input.session);

    switch (name) {
      case "claimElement": {
        const branch = sanitizeBranch(input.branch);
        const { data, error } = await supabase.rpc("claim_element", { p_element_id: id, p_holder: holder, p_branch: branch });
        if (error) throw error;
        const lease = await readLease(supabase, id);
        if (data !== true) {
          const by = lease?.claimed_by ?? "another session";
          const until = lease?.claim_expires_at ? ` until ${lease.claim_expires_at}` : "";
          const on = lease?.branch ? ` on ${lease.branch}` : "";
          return { ok: false, error: `Element is held by ${by}${on}${until}. Leave it, or ask the holder.` };
        }
        return { ok: true, data: { elementId: id, holder, branch: lease?.branch ?? branch, expiresAt: lease?.claim_expires_at ?? null }, meta: { rows: 1 } };
      }

      case "releaseElement": {
        const released = await releaseIfHeld(supabase, id, holder);
        if (!released) return { ok: false, error: `No lease held by ${holder} on this Element` };
        return { ok: true, data: { elementId: id, released: true }, meta: { rows: 1 } };
      }

      case "logProgress": {
        const title = str(input.title).slice(0, 300);
        if (!title) return { ok: false, error: "title is required" };
        const steps = Array.isArray(input.steps) ? (input.steps as unknown[]).map(str).filter(Boolean).slice(0, 20) : undefined;
        const body = progressComment(title, str(input.detail), steps);
        // Bound: the comment lands on the bound id directly. Unbound: the
        // board tool, which re-resolves the (already canonical) id — the
        // conversational path, where there is no run to bind to.
        const posted = boundId
          ? await addElementCommentById(supabase, id, body, actor)
          : await runBoardTool(supabase, "addElementComment", { elementId: id, body }, actor);
        if (!posted.ok) return posted;
        const renewed = await renewIfHeld(supabase, id, holder);
        return { ok: true, data: { comment: posted.data, leaseRenewed: renewed }, meta: { rows: 1 } };
      }

      case "reportOutcome": {
        const outcome = str(input.outcome) as Outcome;
        if (!["completed", "partial", "blocked"].includes(outcome)) return { ok: false, error: "outcome must be completed, partial or blocked" };
        const summary = str(input.summary).slice(0, 300);
        if (!summary) return { ok: false, error: "summary is required" };
        const message = str(input.message);

        // The status moves first, so the comment's notification lands on an
        // Element that already shows where the work went.
        const { data: elRow } = await supabase.from("elements").select("status, display_id, title").eq("id", id).maybeSingle();
        const el = elRow as { status?: string | null; display_id?: string | null; title?: string | null } | null;
        const next = outcomeStatus(outcome, el?.status ?? null);
        if (next) {
          const moved = boundId
            ? await updateElementById(supabase, id, { status: next }, actor)
            : await runBoardTool(supabase, "updateElement", { id, status: next }, actor);
          if (!moved.ok) return moved;
        }
        const commentBody = outcomeComment(outcome, summary, message);
        const posted = boundId
          ? await addElementCommentById(supabase, id, commentBody, actor)
          : await runBoardTool(supabase, "addElementComment", { elementId: id, body: commentBody }, actor);
        if (!posted.ok) return posted;
        const released = await releaseIfHeld(supabase, id, holder);
        // A failed notification does not undo a report that already landed.
        if (notify) {
          await notify(outcomeNotice(actor.agent, outcome, { id, display_id: el?.display_id, title: el?.title }, summary))
            .catch((e) => console.error("caller notification failed:", errorMessage(e)));
        }
        return { ok: true, data: { comment: posted.data, status: next, released }, meta: { rows: 1 } };
      }
    }
    return { ok: false, error: `Unknown tool: ${name}` };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** Pure. A branch name as git allows it, reduced; null when none is given. */
export function sanitizeBranch(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const b = raw.replace(/[^A-Za-z0-9._/-]/g, "").slice(0, 120);
  return b || null;
}
