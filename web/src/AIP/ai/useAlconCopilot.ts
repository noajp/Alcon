'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';
import {
  decideAgentActionById, fetchAgentActionById, fetchAgentRunStatus, fetchAgentRunSteps,
  fetchOpenCopilotRun, insertCopilotRun, retireCopilotRun, sendCopilotMessage,
  type CopilotRunRef,
} from './agentData';
import { liveTurnFromSteps } from './copilotSteps';

// ──────────────────────────────────────────────────────────────────────────
// Shape of a Copilot conversation turn.
//
// `user` messages are plain text. `assistant` messages collect:
//   - text — the answer's prose
//   - toolEvents — chronological log of tool_use → tool_result pairs the
//     model invoked while answering. Surfacing these in the UI is what lets
//     the user see "the Copilot ran listElements and got 12 rows", which is
//     the whole point of an explainable Copilot.
// ──────────────────────────────────────────────────────────────────────────

export interface ToolEvent {
  name: string;
  input?: Record<string, unknown>;
  /** Filled in when the matching tool_result event arrives. */
  result?: { ok: boolean; rows?: number; error?: string };
}

/** One call on an approval card, as the function described it: the same
 *  display contract as a run's approval card. */
export interface CopilotApprovalCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  display: {
    integration: string;
    operation: string;
    destination: string;
    detail: string | null;
    effect: 'read' | 'write';
    critical: string | null;
    rememberable: boolean;
  };
}

/**
 * Integration writes the approval policy held, waiting for the person's
 * decision on a card in this chat. Nothing has run. Approving runs exactly
 * these calls with exactly this input (inputHash binds them); denying runs
 * nothing.
 *
 * A card with a runId/actionId is persisted: it is an agent_actions row on
 * the session's run, decidable here or in the Inbox, by the person
 * who started the conversation, whenever they decide — the decision goes
 * through the engine, the paused turn resumes, and what it goes on to say
 * is appended to the kept conversation. Left undecided it lapses after
 * seven days ('expired'). A card without them predates persisted
 * approvals: it is decided in this chat only, and approving can no longer
 * run it.
 */
export interface CopilotApproval {
  calls: CopilotApprovalCall[];
  inputHash: string;
  status: 'pending' | 'executing' | 'executed' | 'denied' | 'failed' | 'expired';
  /** The run and action this card is decided through, when persisted. */
  runId?: string;
  actionId?: string;
  /** What each call answered, once approval ran it. */
  results?: { name: string; ok: boolean; content: string }[];
}

/** A finished turn: done, and any step still waiting for its result marked
 *  as not run — the turn has ended, so no result is coming and the step
 *  should stop reading as in progress. Steps whose calls are waiting on an
 *  approval card say so instead: they are held, not skipped. */
function settle(message: CopilotMessage): CopilotMessage {
  const waiting = new Map<string, number>();
  for (const a of message.approvals ?? []) {
    if (a.status !== 'pending') continue;
    for (const c of a.calls) waiting.set(c.name, (waiting.get(c.name) ?? 0) + 1);
  }
  const events = message.toolEvents?.map((e) => {
    if (e.result) return e;
    const held = waiting.get(e.name) ?? 0;
    if (held > 0) {
      waiting.set(e.name, held - 1);
      return { ...e, result: { ok: false, error: translate('Awaiting approval') } };
    }
    return { ...e, result: { ok: false, error: translate('Not run') } };
  });
  return { ...message, done: true, ...(events ? { toolEvents: events } : {}) };
}

/** A file handed to the AI with a question. A PDF travels as base64, a
 *  Markdown or text file as its text. A kept conversation keeps only the
 *  name: `data` is absent there, and the file is not sent again. */
export interface CopilotAttachment {
  name: string;
  mediaType: 'application/pdf' | 'text/plain';
  data?: string;
}

export interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Files sent with a user turn. */
  attachments?: CopilotAttachment[];
  /** Tool-use timeline for assistant turns (one entry per tool call). */
  toolEvents?: ToolEvent[];
  /** Integration writes held for the person's decision on a card. */
  approvals?: CopilotApproval[];
  /** True once the turn for this assistant message has finished. */
  done?: boolean;
  /** When the turn was sent or began (ms). */
  at?: number;
}

export interface CopilotContext {
  viewLabel?: string;
  elementId?: string;
  objectId?: string;
  /** The Strategy the person has open, when the panel's subject is one:
   *  scope for the next send, never powers. */
  strategyId?: string;
  domainId?: string;
  /** The Space a Space-wide tool should read. */
  spaceId?: string;
  /** The person's business date (local), so date-based tools agree with the UI. */
  today?: string;
}

/** What the panel is speaking to, when it speaks to something rather than
 *  to Alcon at large: the open deck (a body swap — the deck's own
 *  assistant), or the open Strategy (context only; the conversation and
 *  its bounds are unchanged). */
export type CopilotSubject = { kind: 'slides' } | { kind: 'strategy'; id: string } | null;

/** Pure. The context one send carries: where the person is (Space,
 *  Domain, their business date) and, for a Strategy subject, which
 *  Strategy is open — its name as the view's label, 'Strategy' until the
 *  name resolves. Subject-less and slides contexts are exactly what the
 *  panel has always sent. */
export function buildCopilotContext(input: {
  subject: CopilotSubject;
  strategyName?: string | null;
  domainId?: string | null;
  spaceId?: string | null;
  today: string;
}): CopilotContext {
  const base: CopilotContext = {
    viewLabel: 'Alcon',
    domainId: input.domainId ?? undefined,
    spaceId: input.spaceId ?? undefined,
    today: input.today,
  };
  if (input.subject?.kind !== 'strategy') return base;
  return { ...base, viewLabel: input.strategyName ?? 'Strategy', strategyId: input.subject.id };
}

/** Pure. The subject the Copilot speaks to, from where the person is:
 *  the open deck on Slides, the open Strategy on its view. On the AI
 *  screen it is the last Strategy they had open — the screen and the
 *  pop-up are two windows onto one conversation, and the pop-up they
 *  came from would have carried that Strategy. Anywhere else, and on
 *  the Strategy view with none open, there is no subject. A subject
 *  scopes a send's context; it grants nothing. */
export function copilotSubjectFor(input: {
  activeView: string;
  strategyId?: string | null;
  lastStrategyId?: string | null;
}): CopilotSubject {
  if (input.activeView === 'slides') return { kind: 'slides' };
  if (input.activeView === 'strategy') {
    return input.strategyId ? { kind: 'strategy', id: input.strategyId } : null;
  }
  if (input.activeView === 'ai') {
    return input.lastStrategyId ? { kind: 'strategy', id: input.lastStrategyId } : null;
  }
  return null;
}

/** Pure. A kept conversation's title: the start of its first question,
 *  whitespace folded, capped at 80 characters. A question sent with only
 *  a file takes the file's name; a conversation with no question yet
 *  stays untitled (''). */
export function copilotTitleOf(messages: readonly CopilotMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  return (first?.content || first?.attachments?.[0]?.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Pure. The kept shape of the shown conversation: a file's contents are
 *  never kept (only its name), and a turn's bookkeeping (done, at) is the
 *  panel's own, not the record's. Used when the person cuts a
 *  conversation back — the one write of messages that stays theirs. */
export function toKeptMessages(messages: readonly CopilotMessage[]): CopilotMessage[] {
  return messages.map(({ role, content, toolEvents, attachments, approvals }) => ({
    role, content,
    ...(toolEvents?.length ? { toolEvents } : {}),
    ...(approvals?.length ? { approvals } : {}),
    ...(attachments?.length ? { attachments: attachments.map(({ name, mediaType }) => ({ name, mediaType })) } : {}),
  }));
}

interface SendOptions {
  context?: CopilotContext;
  attachments?: CopilotAttachment[];
}

export interface CopilotHookOptions {
  /** The kept conversation this chat is showing, when it has one: sends
   *  run on that session. */
  getSessionId?: () => string | null;
  /** Ensures the kept conversation's row for a first send (the library's
   *  insert, in the provider's Space and starting folder). Without a
   *  provider the hook makes the row itself — in the send's Space, or
   *  personal (no Space) when the send has none. */
  ensureSession?: () => Promise<string | null>;
  /** The conversation anchored on a session (a first send made its row):
   *  adopt its id, so the kept conversation and its run stay one. */
  onSessionId?: (id: string) => void;
  /** Re-reads the kept conversation, so what shows is the server's
   *  record. False when there is nothing to re-read. */
  reloadSession?: () => Promise<boolean>;
  /** Writes back a conversation the person cut back (an edit, a
   *  retry), in its kept shape (toKeptMessages): from the cut on, the
   *  record is theirs to rewrite — the turns themselves are the
   *  engine's to write. Without a provider the hook writes its own
   *  session's row. */
  onTruncate?: (kept: CopilotMessage[]) => Promise<void>;
}

const FOLLOW_EVERY_MS = 1500;
/** Following a turn gives up after this long and settles what it has;
 *  the turn itself goes on server-side either way. */
const FOLLOW_MAX_POLLS = 600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Drives a Copilot conversation on its session's run (Athena): a send
 * ensures the session and its open run, posts the message to the
 * engine, and follows the run — its steps for the live turn, the kept
 * conversation (ai_sessions.messages) for the settled one. The
 * conversation lives here while it is open; CopilotProvider keeps it.
 */
export function useAlconCopilot(options: CopilotHookOptions = {}) {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });
  /** The session this hook made itself, when no provider keeps it. */
  const ownSessionRef = useRef<string | null>(null);
  /** The run the current turn is on, for the stop button. */
  const runIdRef = useRef<string | null>(null);
  /** Bumped whenever the shown conversation is replaced or cut back:
   *  a follow loop from before the change stops following. */
  const followGenRef = useRef(0);
  /** A cut-back's retiring of the old run, awaited by the next send so
   *  it cannot land on the run being retired. */
  const rewriteRef = useRef<Promise<void>>(Promise.resolve());

  const settleLast = useCallback(() => {
    setMessages((prev) => {
      const next = prev.slice();
      const last = next[next.length - 1];
      if (last && last.role === 'assistant' && !last.done) next[next.length - 1] = settle(last);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    followGenRef.current++;
    runIdRef.current = null;
    ownSessionRef.current = null;
    setMessages([]);
    setError(null);
    setStreaming(false);
  }, []);

  /** Shows a kept conversation, to go on from where it stopped. */
  const load = useCallback((kept: CopilotMessage[]) => {
    followGenRef.current++;
    runIdRef.current = null;
    setMessages(kept.map((m) => ({ ...m, done: true })));
    setError(null);
    setStreaming(false);
  }, []);

  /** Stops the turn on the server: its run is cancelled, and the engine
   *  stops at its next turn boundary. (Closing a view does not call
   *  this — a turn goes on without its window.) */
  const cancel = useCallback(() => {
    followGenRef.current++;
    const runId = runIdRef.current;
    if (runId) void retireCopilotRun(runId).catch(() => undefined);
    setStreaming(false);
    settleLast();
  }, [settleLast]);

  /** Stops following the turn without stopping it — a view going away.
   *  The turn finishes on the server and lands in the kept conversation. */
  const detach = useCallback(() => {
    followGenRef.current++;
    setStreaming(false);
  }, []);

  const sessionIdNow = useCallback(() => optionsRef.current.getSessionId?.() ?? ownSessionRef.current, []);

  /** The conversation's row for a send: the provider's when it keeps
   *  one, else a row this hook makes — in the send's Space, or personal
   *  when the send has no Space (a profile chat). */
  const ensureSessionId = useCallback(async (spaceId: string | null): Promise<string | null> => {
    const existing = sessionIdNow();
    if (existing) return existing;
    let id = await (optionsRef.current.ensureSession?.().catch(() => null) ?? Promise.resolve(null));
    if (!id) {
      const { data, error: insertError } = await supabase.from('ai_sessions')
        .insert({ activity_space_id: spaceId, title: '', messages: [] })
        .select('id').single();
      if (!insertError && data) id = (data as { id: string }).id;
    }
    if (id) {
      ownSessionRef.current = id;
      optionsRef.current.onSessionId?.(id);
    }
    return id;
  }, [sessionIdNow]);

  /** Re-reads the kept conversation into the display: the provider's
   *  reload when it keeps the library, else this hook's own session row. */
  const reloadKept = useCallback(async (sessionId: string | null): Promise<boolean> => {
    if (optionsRef.current.reloadSession) {
      return optionsRef.current.reloadSession().catch(() => false);
    }
    if (!sessionId) return false;
    const { data } = await supabase.from('ai_sessions').select('messages').eq('id', sessionId).maybeSingle();
    if (!data || !Array.isArray(data.messages)) return false;
    load(data.messages as CopilotMessage[]);
    return true;
  }, [load]);

  /**
   * Cuts the conversation back to `kept` — for an edit or a retry. The
   * display and the kept record are cut together, and the session's
   * run is retired: the next send starts a fresh run, seeded from the
   * cut conversation, so the model's context and what the person
   * sees agree. Returns when the retiring has landed.
   */
  const cutBack = useCallback(async (kept: CopilotMessage[]) => {
    followGenRef.current++;
    const runId = runIdRef.current;
    runIdRef.current = null;
    if (runId) await retireCopilotRun(runId).catch(() => undefined);
    const sessionId = sessionIdNow();
    if (!sessionId) return;
    if (optionsRef.current.onTruncate) {
      await optionsRef.current.onTruncate(kept).catch(() => undefined);
    } else {
      await supabase.from('ai_sessions')
        .update({ messages: toKeptMessages(kept), updated_at: new Date().toISOString() })
        .eq('id', sessionId)
        .then(() => undefined, () => undefined);
    }
  }, [sessionIdNow]);

  const send = useCallback(async (text: string, opts: SendOptions = {}) => {
    const trimmed = text.trim();
    const files = opts.attachments ?? [];
    if ((!trimmed && files.length === 0) || streaming) return;

    setError(null);
    // A cut-back still retiring its run settles first: the send must
    // not land on the run being retired.
    await rewriteRef.current;

    // The session and its open run come first: a conversation waiting
    // on an approval, or one another window is driving, refuses here —
    // before anything is shown as sent.
    let sessionId: string | null = null;
    let run: CopilotRunRef | null = null;
    try {
      sessionId = await ensureSessionId(opts.context?.spaceId ?? null);
      if (!sessionId) throw new Error(translate('Could not start the conversation.'));
      run = await fetchOpenCopilotRun(sessionId) ?? await insertCopilotRun(sessionId);
      if (!run) throw new Error(translate('Could not start the conversation.'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (run.status === 'awaiting_approval') {
      setError(translate('There is an operation waiting for approval. Decide on the approval card to continue.'));
      return;
    }
    if (run.status === 'running') {
      setError(translate('The previous answer is still being written. Wait a moment and send again.'));
      return;
    }
    // A 'queued' run is one never claimed — this window's fresh run, or
    // one a failed send left behind: posting the message is what it
    // waits for, and the engine's claim settles any race for it.

    runIdRef.current = run.id;
    // Push the user turn + the empty assistant turn the follow fills.
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed, at: Date.now(), ...(files.length ? { attachments: files } : {}) },
      { role: 'assistant', content: '', toolEvents: [], done: false, at: Date.now() },
    ]);
    setStreaming(true);
    const gen = ++followGenRef.current;

    try {
      await sendCopilotMessage(run.id, {
        message: trimmed,
        context: opts.context ?? {},
        attachments: files.filter((f) => f.data).map((f) => ({ name: f.name, mediaType: f.mediaType, data: f.data })),
      });
    } catch (e) {
      if (followGenRef.current !== gen) return;
      setError(e instanceof Error ? e.message : String(e));
      setMessages((prev) => {
        const next = prev.slice();
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          next[next.length - 1] = settle({ ...last, content: last.content + `\n\n_(${translate('Error: {error}', { error: e instanceof Error ? e.message : String(e) })})_` });
        }
        return next;
      });
      setStreaming(false);
      return;
    }

    // Follow the run: its steps draw the live turn (the draft step is
    // the answer growing; the tool steps are its work), and when the
    // run rests, the kept conversation — the server's record — is
    // what shows.
    let finalStatus: string | null = null;
    for (let i = 0; i < FOLLOW_MAX_POLLS; i++) {
      await sleep(FOLLOW_EVERY_MS);
      if (followGenRef.current !== gen) return;
      const status = await fetchAgentRunStatus(run.id).catch(() => null);
      if (followGenRef.current !== gen) return;
      if (status && status !== 'running' && status !== 'queued') { finalStatus = status; break; }
      const steps = await fetchAgentRunSteps(run.id).catch(() => null);
      if (followGenRef.current !== gen || !steps) continue;
      const live = liveTurnFromSteps(steps);
      setMessages((prev) => {
        const next = prev.slice();
        const last = next[next.length - 1];
        if (last && last.role === 'assistant' && !last.done) {
          next[next.length - 1] = { ...last, content: live.content, toolEvents: live.toolEvents };
        }
        return next;
      });
    }
    if (followGenRef.current !== gen) return;
    if (finalStatus === 'cancelled') {
      // Stopped by its person: what the turn had written stays on
      // screen, settled — the kept conversation carries no answer
      // for a stopped turn.
      settleLast();
    } else if (!(await reloadKept(sessionId))) {
      settleLast();
    }
    if (followGenRef.current === gen) setStreaming(false);
  }, [streaming, ensureSessionId, reloadKept, settleLast]);

  /**
   * The person's decision on an approval card.
   *
   * A persisted card (runId + actionId) is decided through the engine:
   * the decision — approve or deny — goes to the session's run, the
   * paused turn resumes there, and the kept conversation the server
   * writes back is re-read, so the card's outcome and the turn's
   * continuation are the server's record. Either way the model learns
   * the outcome from the resumed turn itself.
   *
   * A card without a run was kept from before approvals persisted:
   * denying is local (nothing was ever sent anywhere, and nothing runs);
   * approving can no longer run it — the in-chat execute callback it was
   * bound to is gone — so the card says so, and the person asks again in
   * the chat, where the new card is persisted like any other.
   */
  const decideApproval = useCallback(async (approval: CopilotApproval, approve: boolean) => {
    const isCard = (a: CopilotApproval) => (approval.actionId ? a.actionId === approval.actionId : a.inputHash === approval.inputHash);
    const patch = (status: CopilotApproval['status'], note?: string, results?: CopilotApproval['results']) => {
      setMessages((prev) => prev.map((m) => {
        if (m.role !== 'assistant' || !m.approvals?.some(isCard)) return m;
        return {
          ...m,
          approvals: m.approvals.map((a) => (isCard(a) ? { ...a, status, ...(results ? { results } : {}) } : a)),
          ...(note ? { content: m.content + note } : {}),
        };
      }));
    };
    if (approval.runId && approval.actionId) {
      patch('executing');
      try {
        await decideAgentActionById({
          runId: approval.runId, actionId: approval.actionId, inputHash: approval.inputHash, approve,
        });
      } catch {
        // The decision never landed: the card stays decidable.
        patch('pending', `\n\n_(${translate('Could not send the decision. Try again.')})_`);
        return;
      }
      // The resume runs in the background; follow the run to its rest,
      // then let the kept conversation speak for the outcome.
      for (let i = 0; i < 90; i++) {
        await sleep(2000);
        const status = await fetchAgentRunStatus(approval.runId).catch(() => null);
        if (status && status !== 'running') break;
      }
      const reloaded = await (optionsRef.current.reloadSession?.().catch(() => false) ?? Promise.resolve(false));
      if (!reloaded) {
        const action = await fetchAgentActionById(approval.actionId).catch(() => null);
        if (action?.status === 'executed') patch('executed');
        else if (action?.status === 'failed') patch('failed');
        else if (action?.status === 'rejected') patch('denied');
        else if (action?.status === 'expired') patch('expired');
      }
      return;
    }

    if (!approve) {
      patch('denied', `\n\n_(${translate('You denied this operation. It was not run.')})_`);
      return;
    }
    patch('failed', `\n\n_(${translate('This approval can no longer be run. Ask again in the chat.')})_`,
      [{ name: '', ok: false, content: translate('This approval can no longer be run. Ask again in the chat.') }]);
  }, []);

  /** Drops the turns from `index` on — editing a question starts over from it. */
  const truncate = useCallback((index: number) => {
    if (streaming) return;
    const kept = messages.slice(0, index);
    setMessages(kept);
    rewriteRef.current = cutBack(kept);
  }, [messages, streaming, cutBack]);

  /** Asks the last question again, in place of its answer. */
  const retry = useCallback((opts: Omit<SendOptions, 'attachments'> = {}) => {
    if (streaming) return;
    const at = messages.map((m) => m.role).lastIndexOf('user');
    if (at < 0) return;
    const question = messages[at];
    const kept = messages.slice(0, at);
    setMessages(kept);
    rewriteRef.current = cutBack(kept);
    void send(question.content, { ...opts, attachments: (question.attachments ?? []).filter((a) => a.data) });
  }, [messages, streaming, cutBack, send]);

  return { messages, streaming, error, send, cancel, detach, reset, load, truncate, retry, decideApproval };
}
