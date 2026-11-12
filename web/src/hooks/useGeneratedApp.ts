'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readGeneratedAppContext, readSpaceContext } from './generatedAppContext';
import { getActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useSessionUserId, useWidgetDocument, useWidgetViewerState } from './useWidgetDocument';
import { supabase } from '@/lib/supabase';
import { parseAppSource, parseAppState, sourceDigest, stableJson, statePatch, type AppSource, type AppState } from '@/Function/widget/generated/model';
import { CANVAS_TEMPLATES } from '@/Function/widget/generated/templates';

/** The app everyone on the widget sees. */
type SharedApp = { current: AppSource | null; previous: AppSource | null };
/** What only the signed-in person sees until they adopt it. */
type OwnDraft = { draft: AppSource | null; prompt: string; /** Digest of the shared app this person let read Object data as them. */ dataApproved?: string };

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
  const stateQueue = useRef<Promise<AppState | undefined>>(Promise.resolve(undefined));
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

  // The shared app runs in every viewer's browser and reads Object data as
  // that viewer. Code someone else put there could read what only this viewer
  // can see and save it where its author can read it, so each viewer connects
  // each version themselves, by pressing Connect — never as a side effect of
  // something else. The built-in template is known code.
  const current = shared.value?.current ?? null;
  const [digest, setDigest] = useState<{ of: AppSource; value: string | null } | null>(null);
  useEffect(() => {
    if (!current) return;
    let alive = true;
    // No digest (no Web Crypto outside a secure context): the app still runs, unconnected.
    void sourceDigest(current).catch(() => null).then(value => { if (alive) setDigest({ of: current, value }); });
    return () => { alive = false; };
  }, [current]);
  const currentDigest = current && digest?.of === current ? digest.value : null;
  const known = !!current && CANVAS_TEMPLATES.some((tpl) => stableJson(current) === stableJson(tpl.source));
  const dataConnected = known || (!!currentDigest && own.value?.dataApproved === currentDigest);
  // Until the digest is known the answer is not "not connected" but "not yet known".
  const identifying = !!current && !known && digest?.of !== current;

  const app: GeneratedApp | null = shared.value || own.value ? {
    current_app: shared.value?.current ?? null,
    previous_app: shared.value?.previous ?? null,
    draft_app: own.value?.draft ?? null,
    prompt: own.value?.prompt ?? '',
  } : null;

  return {
    app, state: data.value ?? {}, loading: loading || identifying, dataConnected,
    /** The shared app is one of the built-in templates, unchanged. */
    knownTemplate: known,
    connectData: () => serial(async () => {
      if (!currentDigest) throw new Error('Object data cannot be connected in this browser context.');
      await saveOwn({ dataApproved: currentDigest });
    }),
    error: loadError?.message ?? (ready && !userId ? 'Sign in to save your app.' : null), saving: pending > 0,
    reload: async () => {
      const results = await Promise.all([shared.refetch(), data.refetch(), own.refetch()]);
      return { error: results.find(result => result.error)?.error ?? null };
    },
    readContext: async () => {
      if (!userId) throw new Error('Sign in before reading Object data.');
      return readGeneratedAppContext(objectId, userId);
    },
    readSpace: async () => {
      const spaceId = getActiveSpaceId();
      if (!userId || !spaceId) throw new Error('Sign in before reading Space data.');
      return readSpaceContext(spaceId, userId);
    },
    /** A built-in template is known code: it becomes the shared app at once, no preview. */
    useTemplate: (source: AppSource) => serial(async () => {
      await setShared({ current: parseAppSource(source), previous: latest.current.shared?.current ?? null });
      await saveOwn({ draft: null, prompt: '' });
    }),
    savePrompt: (prompt: string) => serial(() => saveOwn({ prompt })),
    generate: (prompt: string) => serial(async () => {
      await saveOwn({ prompt });
      const { data: reply, error } = await supabase.functions.invoke('generate-widget-app', { body: { widgetId, prompt, runtimeVersion: 3, spaceId: getActiveSpaceId() } });
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
      // A retry after the second write failed must not record the app as its own previous version.
      const existing = latest.current.shared?.current ?? null;
      if (!existing || stableJson(existing) !== stableJson(draft)) await setShared({ current: draft, previous: existing });
      // Nothing is connected here. What a preview was built from cannot be
      // told at this point, so every version is connected by an explicit act.
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
      // In the order the app asked: two saves of one key must not land reversed.
      const saved = stateQueue.current.catch(() => undefined).then(() => data.merge(set, unset));
      stateQueue.current = saved;
      return saved;
    },
  };
}
