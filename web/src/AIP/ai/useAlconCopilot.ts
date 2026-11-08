'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';
import { decideAgentActionById, fetchAgentActionById, fetchAgentRunStatus } from './agentData';

// ──────────────────────────────────────────────────────────────────────────
// Shape of a Copilot conversation turn.
//
// `user` messages are plain text. `assistant` messages collect:
//   - text — the streamed prose
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
 * the session's anchor run, decidable here or in the Inbox, by the person
 * who started the conversation, whenever they decide — the decision goes
 * through the engine, the paused turn resumes, and what it goes on to say
 * is appended to the kept conversation. Left undecided it lapses after
 * seven days ('expired'). A card without them predates the anchor: it is
 * decided in this chat only, and approving can no longer run it.
 */
export interface CopilotApproval {
  calls: CopilotApprovalCall[];
  inputHash: string;
  status: 'pending' | 'executing' | 'executed' | 'denied' | 'failed' | 'expired';
  /** The anchor run and action this card is decided through, when persisted. */
  runId?: string;
  actionId?: string;
  /** What each call answered, once approval ran it. */
  results?: { name: string; ok: boolean; content: string }[];
}

/** A finished turn: done, and any step still waiting for its result marked
 *  as not run — the stream has ended, so no result is coming and the step
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
  /** True once the stream for this assistant turn has finished. */
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

interface SendOptions {
  context?: CopilotContext;
  attachments?: CopilotAttachment[];
}

type RequestTurn = { role: 'user' | 'assistant'; content: string; attachments?: CopilotAttachment[] };

const FUNCTIONS_PATH = '/functions/v1/alcon-copilot';

function functionsUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!base) return null;
  return base.replace(/\/$/, '') + FUNCTIONS_PATH;
}

export interface CopilotHookOptions {
  /** The kept conversation this chat is showing, when it has one: sends
   *  carry it so the turn anchors on that session. */
  getSessionId?: () => string | null;
  /** The function anchored the turn on a session (the first turn's):
   *  adopt its id, so the kept conversation and the anchor stay one. */
  onSessionId?: (id: string) => void;
  /** Re-reads the kept conversation after a decision's resume settled,
   *  so the card's outcome and the turn's continuation come from the
   *  server's record. False when there is nothing to re-read. */
  reloadSession?: () => Promise<boolean>;
}

/**
 * Drives the SSE conversation with the alcon-copilot Edge Function. The
 * conversation lives here while it is open; CopilotProvider keeps it.
 */
export function useAlconCopilot(options: CopilotHookOptions = {}) {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setError(null);
    setStreaming(false);
  }, []);

  /** Shows a kept conversation, to go on from where it stopped. */
  const load = useCallback((kept: CopilotMessage[]) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages(kept.map((m) => ({ ...m, done: true })));
    setError(null);
    setStreaming(false);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const send = useCallback(async (text: string, opts: SendOptions = {}) => {
    const trimmed = text.trim();
    const files = opts.attachments ?? [];
    if ((!trimmed && files.length === 0) || streaming) return;

    const url = functionsUrl();
    if (!url) {
      setError(translate('Supabase URL is not configured.'));
      return;
    }

    setError(null);

    // Push the user turn + an empty assistant turn we'll stream into.
    const historyForRequest: RequestTurn[] = [];
    setMessages((prev) => {
      const next: CopilotMessage[] = [
        ...prev,
        { role: 'user', content: trimmed, at: Date.now(), ...(files.length ? { attachments: files } : {}) },
        { role: 'assistant', content: '', toolEvents: [], done: false, at: Date.now() },
      ];
      for (const m of next) {
        if (m.role === 'user') {
          // Files whose contents are still at hand go along with every turn,
          // so later questions can refer back to them.
          const sendable = (m.attachments ?? []).filter((a) => a.data);
          historyForRequest.push({ role: 'user', content: m.content, ...(sendable.length ? { attachments: sendable } : {}) });
        }
        else if (m.role === 'assistant' && m.done) {
          historyForRequest.push({ role: 'assistant', content: m.content });
        }
      }
      return next;
    });

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setError(translate('Sign in to continue.'));
      setStreaming(false);
      return;
    }
    const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          messages: historyForRequest, context: opts.context ?? {},
          sessionId: optionsRef.current.getSessionId?.() ?? undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        throw new Error(errText || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE: events are separated by a blank line. Each event has `event:`
        // and `data:` lines; we only emit one-line JSON `data:` payloads.
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let evt = 'message';
          let data = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith('event:')) evt = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          let payload: Record<string, unknown> = {};
          try { payload = JSON.parse(data); } catch { /* skip */ }
          dispatchEvent(evt, payload);
        }
      }

      // Mark the assistant turn done. (If the stream ended without an
      // explicit `done` event we still want to flip the flag.)
      setMessages((prev) => {
        const next = prev.slice();
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') next[next.length - 1] = settle(last);
        return next;
      });
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') {
        // Stopped by the person: the steps it never reached stop spinning.
        setMessages((prev) => {
          const next = prev.slice();
          const last = next[next.length - 1];
          if (last && last.role === 'assistant') next[next.length - 1] = settle(last);
          return next;
        });
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setMessages((prev) => {
          const next = prev.slice();
          const last = next[next.length - 1];
          if (last && last.role === 'assistant') next[next.length - 1] = settle(last);
          return next;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [streaming]);

  // Mutate the in-progress assistant turn based on the latest SSE event.
  function dispatchEvent(evt: string, payload: Record<string, unknown>) {
    if (evt === 'session') {
      // The turn anchored on a kept conversation: adopt its id.
      if (typeof payload.sessionId === 'string') optionsRef.current.onSessionId?.(payload.sessionId);
      return;
    }
    setMessages((prev) => {
      const next = prev.slice();
      const i = next.length - 1;
      const last = next[i];
      if (!last || last.role !== 'assistant') return prev;
      if (evt === 'text') {
        next[i] = { ...last, content: last.content + (payload.delta as string ?? '') };
      } else if (evt === 'tool_use') {
        const events = (last.toolEvents ?? []).slice();
        events.push({ name: payload.name as string, input: payload.input as Record<string, unknown> });
        next[i] = { ...last, toolEvents: events };
      } else if (evt === 'tool_result') {
        const events = (last.toolEvents ?? []).slice();
        // Attach the result to the earliest unresolved call of the same name —
        // a turn's calls run, and report, in the order they were made.
        for (let k = 0; k < events.length; k++) {
          if (events[k].name === payload.name && !events[k].result) {
            events[k] = {
              ...events[k],
              result: {
                ok: payload.ok as boolean,
                rows: payload.rows as number | undefined,
                error: payload.error as string | undefined,
              },
            };
            break;
          }
        }
        next[i] = { ...last, toolEvents: events };
      } else if (evt === 'approval') {
        const approval: CopilotApproval = {
          calls: (payload.calls as CopilotApprovalCall[] | undefined) ?? [],
          inputHash: String(payload.inputHash ?? ''),
          status: 'pending',
          ...(typeof payload.runId === 'string' ? { runId: payload.runId } : {}),
          ...(typeof payload.actionId === 'string' ? { actionId: payload.actionId } : {}),
        };
        next[i] = { ...last, approvals: [...(last.approvals ?? []), approval] };
      } else if (evt === 'done') {
        // Cut off by the length limit with no calls left to run: say so,
        // rather than end mid-sentence as if that were the answer.
        const cut = payload.stop_reason === 'max_tokens'
          ? `\n\n_(${translate('The answer was cut off by the length limit. Ask to continue.')})_`
          : '';
        next[i] = settle({ ...last, content: last.content + cut });
      } else if (evt === 'error') {
        next[i] = settle({ ...last, content: last.content + `\n\n_(${translate('Error: {error}', { error: String(payload.error ?? '') })})_` });
      }
      return next;
    });
  }

  /**
   * The person's decision on an approval card.
   *
   * A persisted card (runId + actionId) is decided through the engine:
   * the decision — approve or deny — goes to the anchor run, the paused
   * turn resumes there, and the kept conversation the server writes back
   * is re-read, so the card's outcome and the turn's continuation are the
   * server's record. Either way the model learns the outcome from the
   * resumed turn itself.
   *
   * A card without an anchor was kept from before approvals persisted:
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
      // The resume runs in the background; follow the anchor to its rest,
      // then let the kept conversation speak for the outcome.
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
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
    setMessages((prev) => prev.slice(0, index));
  }, [streaming]);

  /** Asks the last question again, in place of its answer. */
  const retry = useCallback((opts: Omit<SendOptions, 'attachments'> = {}) => {
    if (streaming) return;
    const at = messages.map((m) => m.role).lastIndexOf('user');
    if (at < 0) return;
    const question = messages[at];
    setMessages((prev) => prev.slice(0, at));
    void send(question.content, { ...opts, attachments: (question.attachments ?? []).filter((a) => a.data) });
  }, [messages, streaming, send]);

  return { messages, streaming, error, send, cancel, reset, load, truncate, retry, decideApproval };
}
