'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// What a widget holds of its own (docs/adr/0040). A document part is shared by
// everyone who can see the widget and merged key by key on the server; viewer
// state is the signed-in person's alone.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Json = Record<string, unknown>;

export function useSessionUserId(): { userId: string | null; ready: boolean } {
  const [state, setState] = useState<{ userId: string | null; ready: boolean }>({ userId: null, ready: false });
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ userId: session?.user.id ?? null, ready: true });
    });
    return () => subscription.unsubscribe();
  }, []);
  return state;
}

/** One shared part of a widget's contents. `value` is null until somebody writes it. */
export function useWidgetDocument<T extends Json>(widgetId: string, part: string) {
  const qc = useQueryClient();
  const enabled = UUID.test(widgetId);
  const query = useQuery({
    queryKey: ['widget-document', widgetId, part],
    enabled,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('widget_documents').select('value')
        .eq('widget_id', widgetId).eq('part', part).limit(1);
      if (error) throw error;
      return (data?.[0]?.value ?? null) as T | null;
    },
  });
  /** Sets and removes top-level keys; resolves to the merged value everyone now has. */
  const merge = useCallback(async (set: Partial<T>, unset: string[] = []): Promise<T> => {
    if (!enabled) throw new Error('This widget is not saved yet.');
    const { data, error } = await supabase.rpc('merge_widget_document', {
      p_widget_id: widgetId, p_part: part, p_set: set, p_unset: unset,
    });
    if (error) throw new Error(error.message);
    const value = (data as { value: T }).value;
    // A read already on its way back predates this write; it must not land on top of it.
    await qc.cancelQueries({ queryKey: ['widget-document', widgetId, part] });
    qc.setQueryData(['widget-document', widgetId, part], value);
    return value;
  }, [qc, enabled, widgetId, part]);
  return { value: query.data ?? null, loading: enabled && query.isPending, error: query.error, merge, refetch: query.refetch };
}

/** The signed-in person's own state for a widget — a draft nobody else sees. */
export function useWidgetViewerState<T extends Json>(widgetId: string, userId: string | null) {
  const qc = useQueryClient();
  const enabled = UUID.test(widgetId) && !!userId;
  const key = ['widget-viewer-state', widgetId, userId];
  const query = useQuery({
    queryKey: key,
    enabled,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('widget_viewer_state').select('value')
        .eq('widget_id', widgetId).eq('user_id', userId!).limit(1);
      if (error) throw error;
      return (data?.[0]?.value ?? null) as T | null;
    },
  });
  const save = useCallback(async (value: T): Promise<T> => {
    if (!enabled) throw new Error('Sign in before saving.');
    const { error } = await supabase.from('widget_viewer_state')
      .upsert({ widget_id: widgetId, user_id: userId, value, updated_at: new Date().toISOString() }, { onConflict: 'widget_id,user_id' });
    if (error) throw new Error(error.message);
    qc.setQueryData(['widget-viewer-state', widgetId, userId], value);
    return value;
  }, [qc, enabled, widgetId, userId]);
  return { value: query.data ?? null, loading: enabled && query.isPending, error: query.error, save, refetch: query.refetch };
}
