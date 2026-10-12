'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readGeneratedAppContext } from './generatedAppContext';
import { useSessionUserId, useWidgetDocument, useWidgetViewerState } from './useWidgetDocument';
import { supabase } from '@/lib/supabase';
import { parseAppSource, parseAppState, statePatch, type AppSource, type AppState } from '@/Function/widget/generated/model';

/** The app everyone on the widget sees. */
type SharedApp = { current: AppSource | null; previous: AppSource | null };
/** What only the signed-in person sees until they adopt it. */
type OwnDraft = { draft: AppSource | null; prompt: string };

export interface GeneratedApp { current_app: AppSource | null; previous_app: AppSource | null; draft_app: AppSource | null; prompt: string }

/**
 * A generated app and its saved inputs, kept under the widget it runs in.
 * The app and the inputs are shared with everyone who can see the widget; a
 * preview and the request that produced it stay with the person who asked.
 */
export function useGeneratedApp(objectId: string, widgetId: string) {
  const { userId, ready } = useSessionUserId();
  const shared = useWidgetDocument<SharedApp>(widgetId, 'app');
  const data = useWidgetDocument<AppState>(widgetId, 'data');
  const own = useWidgetViewerState<OwnDraft>(widgetId, userId);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [pending, setPending] = useState(0);

  const latest = useRef({ shared: shared.value, own: own.value, loaded: false });
  const loading = !ready || (!!userId && (shared.loading || data.loading || own.loading));
  const loadError = shared.error ?? data.error ?? own.error;
  const loaded = !loading && !loadError && !!userId;
  useEffect(() => { latest.current = { shared: shared.value, own: own.value, loaded }; }, [shared.value, own.value, loaded]);

  // One write at a time, each starting from what the one before it left.
  const serial = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setPending(n => n + 1);
    const next = queue.current.catch(() => undefined).then(() => {
      if (!latest.current.loaded) throw new Error('Load the app before saving.');
      return fn();
    });
    queue.current = next;
    try { return await next; } finally { setPending(n => n - 1); }
  }, []);
  const mergeShared = shared.merge;
  const saveOwnValue = own.save;
  const saveOwn = useCallback(async (patch: Partial<OwnDraft>) => {
    const value = { draft: null, prompt: '', ...latest.current.own, ...patch };
    latest.current.own = await saveOwnValue(value);
  }, [saveOwnValue]);
  const setShared = useCallback(async (patch: Partial<SharedApp>) => {
    latest.current.shared = await mergeShared(patch);
  }, [mergeShared]);

  const app: GeneratedApp | null = shared.value || own.value ? {
    current_app: shared.value?.current ?? null,
    previous_app: shared.value?.previous ?? null,
    draft_app: own.value?.draft ?? null,
    prompt: own.value?.prompt ?? '',
  } : null;

  return {
    app, state: data.value ?? {}, loading,
    error: loadError?.message ?? (ready && !userId ? 'Sign in to save your app.' : null), saving: pending > 0,
    reload: async () => {
      const results = await Promise.all([shared.refetch(), data.refetch(), own.refetch()]);
      return { error: results.find(result => result.error)?.error ?? null };
    },
    readContext: async () => {
      if (!userId) throw new Error('Sign in before reading Object data.');
      return readGeneratedAppContext(objectId, userId);
    },
    useTemplate: (source: AppSource) => serial(() => saveOwn({ draft: parseAppSource(source) })),
    savePrompt: (prompt: string) => serial(() => saveOwn({ prompt })),
    generate: (prompt: string) => serial(async () => {
      await saveOwn({ prompt });
      const { data: reply, error } = await supabase.functions.invoke('generate-widget-app', { body: { widgetId, prompt, runtimeVersion: 3 } });
      if (error) {
        let message = error.message;
        if ('context' in error && error.context instanceof Response) { try { message = (await error.context.json()).error ?? message; } catch { /* Keep transport error. */ } }
        throw new Error(message);
      }
      if (reply?.error) throw new Error(reply.error);
      await saveOwn({ draft: parseAppSource(reply?.app) });
    }),
    adopt: () => serial(async () => {
      const draft = latest.current.own?.draft;
      if (!draft) throw new Error('Generate a preview first.');
      await setShared({ current: draft, previous: latest.current.shared?.current ?? null });
      await saveOwn({ draft: null, prompt: '' });
    }),
    discard: () => serial(() => saveOwn({ draft: null })),
    restore: () => serial(async () => {
      const previous = latest.current.shared?.previous;
      if (!previous) throw new Error('No previous version.');
      await setShared({ current: previous, previous: latest.current.shared?.current ?? null });
      await saveOwn({ draft: null });
    }),
    /** Saves what the app changed since `base` and resolves to the state everyone now has. */
    saveState: (next: AppState, base: AppState): Promise<AppState> => {
      const { set, unset } = statePatch(base, parseAppState(next));
      return data.merge(set, unset);
    },
  };
}
