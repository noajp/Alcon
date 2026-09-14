'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { parseAppSource, parseAppState, type AppSource, type AppState } from '@/Function/widget/generated/model';

interface AppRow { id: string; owner_id: string; object_id: string; instance_id: string; current_app: AppSource | null; previous_app: AppSource | null; draft_app: AppSource | null; prompt: string; revision: number }
interface DataRow { app_id: string; value: AppState; revision: number }
export function useGeneratedApp(objectId: string, instanceId: string) {
  const [owner, setOwner] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const qc = useQueryClient();
  const row = useRef<AppRow | null>(null);
  const dataRow = useRef<DataRow | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const stateQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { setOwner(session?.user.id ?? null); setAuthReady(true); });
    return () => subscription.unsubscribe();
  }, []);
  const key = ['generated-app', owner, objectId, instanceId];
  const query = useQuery({ queryKey: key, enabled: !!owner && !!objectId && !!instanceId, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, queryFn: async () => {
    const result = await supabase.from('widget_apps').select('*').eq('owner_id', owner!).eq('object_id', objectId).eq('instance_id', instanceId).maybeSingle();
    if (result.error) throw result.error;
    let stored: DataRow | null = null;
    if (result.data) {
      const data = await supabase.from('widget_app_data').select('*').eq('app_id', result.data.id).maybeSingle();
      if (data.error) throw data.error;
      stored = data.data as DataRow | null;
    }
    row.current = result.data as AppRow | null;
    dataRow.current = stored;
    return { app: row.current, state: stored?.value ?? {} };
  } });
  // Every write uses the last acknowledged revision; conflicts preserve local UI.
  async function serial<T>(fn: () => Promise<T>, stateWrite = false): Promise<T> {
    const target = stateWrite ? stateQueue : queue;
    setPending(n => n + 1);
    const next = target.current.catch(() => undefined).then(fn);
    target.current = next;
    try { return await next; } finally { setPending(n => n - 1); }
  }
  function publish() { qc.setQueryData(key, { app: row.current, state: dataRow.current?.value ?? {} }); }
  async function ensure() {
    if (!owner || !objectId || !instanceId || query.isPending || query.isFetching || query.error) throw new Error('Load the app before saving.');
    if (row.current) {
      if (row.current.owner_id !== owner || row.current.object_id !== objectId || row.current.instance_id !== instanceId) throw new Error('The app context changed. Reload before saving.');
      return row.current;
    }
    const result = await supabase.from('widget_apps').insert({ owner_id: owner, object_id: objectId, instance_id: instanceId }).select().single();
    if (result.error) throw result.error;
    row.current = result.data as AppRow;
    publish();
    return row.current;
  }
  async function update(patch: Partial<Pick<AppRow, 'prompt' | 'draft_app' | 'current_app' | 'previous_app'>>) {
    const app = await ensure();
    const result = await supabase.from('widget_apps').update(patch).eq('id', app.id).eq('revision', app.revision).select().maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('This app changed in another window. Reload before editing again.');
    row.current = result.data as AppRow;
    publish();
    return row.current;
  }
  return {
    app: query.data?.app ?? null, state: query.data?.state ?? {}, loading: !authReady || (!!owner && (query.isPending || query.isFetching)),
    error: query.error?.message ?? (authReady && !owner ? 'Sign in to save your app.' : null), saving: pending > 0,
    reload: query.refetch,
    savePrompt: (prompt: string) => serial(() => update({ prompt })),
    generate: (prompt: string) => serial(async () => {
      const app = await update({ prompt });
      const { data, error } = await supabase.functions.invoke('generate-widget-app', { body: { appId: app.id, prompt } });
      if (error) {
        let message = error.message;
        if ('context' in error && error.context instanceof Response) { try { message = (await error.context.json()).error ?? message; } catch { /* Keep transport error. */ } }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      return update({ draft_app: parseAppSource(data?.app) });
    }),
    adopt: () => serial(async () => { const app = await ensure(); if (!app.draft_app) throw new Error('Generate a preview first.'); return update({ current_app: app.draft_app, previous_app: app.current_app, draft_app: null, prompt: '' }); }),
    discard: () => serial(() => update({ draft_app: null })),
    restore: () => serial(async () => { const app = await ensure(); if (!app.previous_app) throw new Error('No previous version.'); return update({ current_app: app.previous_app, previous_app: app.current_app, draft_app: null }); }),
    saveState: (value: AppState) => serial(async () => {
      const app = await ensure();
      const parsed = parseAppState(value);
      const current = dataRow.current;
      if (current && current.app_id !== app.id) throw new Error('The app context changed. Reload before saving.');
      const result = current
        ? await supabase.from('widget_app_data').update({ value: parsed }).eq('app_id', app.id).eq('revision', current.revision).select().maybeSingle()
        : await supabase.from('widget_app_data').insert({ app_id: app.id, value: parsed }).select().single();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('App data changed in another window. Reload before saving again.');
      dataRow.current = result.data as DataRow;
      publish();
    }, true),
  };
}
