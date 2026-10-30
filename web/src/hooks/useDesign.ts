'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionUserId, useWidgetDocument, useWidgetViewerState } from './useWidgetDocument';
import { supabase } from '@/lib/supabase';
import { parseDesign, type DesignSource } from '@/Function/widget/design/model';
import { translate } from '@/Function/i18n/I18nProvider';

/** The design everyone on the widget sees, and the one it replaced. */
type SharedDesign = { current: DesignSource | null; previous: DesignSource | null };
/** What only the signed-in person sees until they use it. */
type OwnDraft = { draft: DesignSource | null; prompt: string };

/**
 * A Design widget's artboard. The design is shared with everyone who can see
 * the widget; a revision and the request that produced it stay with the
 * person who asked until they use it — then it replaces the design for all,
 * and the one before is kept so it can be brought back.
 */
export function useDesign(widgetId: string) {
  const { userId, ready } = useSessionUserId();
  const shared = useWidgetDocument<SharedDesign>(widgetId, 'design');
  const own = useWidgetViewerState<OwnDraft>(widgetId, userId);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [pending, setPending] = useState(0);

  const loading = !ready || (!!userId && (shared.loading || own.loading));
  const loadError = shared.error ?? own.error;
  const latest = useRef({ shared: shared.value, own: own.value, loaded: false });
  useEffect(() => {
    latest.current = { shared: shared.value, own: own.value, loaded: !loading && !loadError && !!userId };
  }, [shared.value, own.value, loading, loadError, userId]);

  // One write at a time, each starting from what the one before it left.
  const serial = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setPending(n => n + 1);
    const next = queue.current.catch(() => undefined).then(() => {
      if (!latest.current.loaded) throw new Error(translate('Load the design before saving.'));
      return fn();
    });
    queue.current = next;
    try { return await next; } finally { setPending(n => n - 1); }
  }, []);
  const saveOwnValue = own.save;
  const saveOwn = useCallback(async (patch: Partial<OwnDraft>) => {
    const value = { draft: null, prompt: '', ...latest.current.own, ...patch };
    latest.current.own = await saveOwnValue(value);
  }, [saveOwnValue]);
  const mergeShared = shared.merge;
  const setShared = useCallback(async (patch: Partial<SharedDesign>) => {
    latest.current.shared = await mergeShared(patch);
  }, [mergeShared]);

  return {
    current: shared.value?.current ?? null,
    previous: shared.value?.previous ?? null,
    draft: own.value?.draft ?? null,
    prompt: own.value?.prompt ?? '',
    loading,
    saving: pending > 0,
    error: loadError?.message ?? (ready && !userId ? translate('Sign in to save your design.') : null),
    savePrompt: (prompt: string) => serial(() => saveOwn({ prompt })),
    /** Asks AI for a design, or a revision of the one shown; the result is a private draft. */
    generate: (prompt: string) => serial(async () => {
      await saveOwn({ prompt });
      const { data: reply, error } = await supabase.functions.invoke('generate-design', { body: { widgetId, prompt } });
      if (error) {
        let message = error.message;
        if ('context' in error && error.context instanceof Response) { try { message = (await error.context.json()).error ?? message; } catch { /* Keep the transport error. */ } }
        throw new Error(message);
      }
      if (reply?.error) throw new Error(reply.error);
      await saveOwn({ draft: parseDesign(reply?.design) });
    }),
    /** The draft becomes the design for everyone; the design it replaces is kept. */
    adopt: () => serial(async () => {
      const draft = latest.current.own?.draft;
      if (!draft) throw new Error(translate('Generate a design first.'));
      await setShared({ current: draft, previous: latest.current.shared?.current ?? null });
      await saveOwn({ draft: null, prompt: '' });
    }),
    discard: () => serial(() => saveOwn({ draft: null })),
    /** Brings back the design before the current one (and keeps the current as previous). */
    restore: () => serial(async () => {
      const { current, previous } = latest.current.shared ?? { current: null, previous: null };
      if (!previous) throw new Error(translate('There is no earlier design.'));
      await setShared({ current: previous, previous: current });
    }),
    reload: async () => {
      const results = await Promise.all([shared.refetch(), own.refetch()]);
      return { error: results.find(result => result.error)?.error ?? null };
    },
  };
}
