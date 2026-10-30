'use client';

import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';

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

export interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Tool-use timeline for assistant turns (one entry per tool call). */
  toolEvents?: ToolEvent[];
  /** True once the stream for this assistant turn has finished. */
  done?: boolean;
}

export interface CopilotContext {
  viewLabel?: string;
  elementId?: string;
  objectId?: string;
  domainId?: string;
  /** The Space a Space-wide tool should read. */
  spaceId?: string;
  /** The person's business date (local), so date-based tools agree with the UI. */
  today?: string;
}

interface SendOptions {
  context?: CopilotContext;
}

const FUNCTIONS_PATH = '/functions/v1/alcon-copilot';

function functionsUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!base) return null;
  return base.replace(/\/$/, '') + FUNCTIONS_PATH;
}

/**
 * Drives the SSE conversation with the alcon-copilot Edge Function. The
 * conversation lives here while it is open; CopilotProvider keeps it.
 */
export function useAlconCopilot() {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
    if (!trimmed || streaming) return;

    const url = functionsUrl();
    if (!url) {
      setError(translate('Supabase URL is not configured.'));
      return;
    }

    setError(null);

    // Push the user turn + an empty assistant turn we'll stream into.
    const historyForRequest: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    setMessages((prev) => {
      const next: CopilotMessage[] = [
        ...prev,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: '', toolEvents: [], done: false },
      ];
      for (const m of next) {
        if (m.role === 'user') historyForRequest.push({ role: 'user', content: m.content });
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
        body: JSON.stringify({ messages: historyForRequest, context: opts.context ?? {} }),
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
        if (last && last.role === 'assistant') next[next.length - 1] = { ...last, done: true };
        return next;
      });
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') {
        // user cancelled — no-op
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setMessages((prev) => {
          const next = prev.slice();
          const last = next[next.length - 1];
          if (last && last.role === 'assistant') next[next.length - 1] = { ...last, done: true };
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
        // Attach the result to the most recent un-resolved event of the same name.
        for (let k = events.length - 1; k >= 0; k--) {
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
      } else if (evt === 'done') {
        next[i] = { ...last, done: true };
      } else if (evt === 'error') {
        next[i] = { ...last, done: true, content: last.content + `\n\n_(${translate('Error: {error}', { error: String(payload.error ?? '') })})_` };
      }
      return next;
    });
  }

  return { messages, streaming, error, send, cancel, reset, load };
}
