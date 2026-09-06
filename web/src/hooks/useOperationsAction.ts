'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createElement } from '@/alcon/element/data';
import { getCurrentUserId, supabase } from '@/lib/supabase';

/** A deliberate, single Element creation with the source and reasoning preserved. */
export function useOperationsAction() {
  const queryClient = useQueryClient();
  const lock = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(input: { tableId: string; rowId: string; title: string; detail: string; objectId: string | null }) {
    if (lock.current) return null;
    if (!input.title.trim()) throw new Error('Enter an Element title.');
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      const userId = await getCurrentUserId();
      if (!userId) throw new Error('Sign in to create an Element.');
      const { data: table, error: tableError } = await supabase.from('tables').select('name').eq('id', input.tableId).single();
      if (tableError) throw tableError;
      const { error: rowError } = await supabase.from('table_rows').select('id').eq('id', input.rowId).eq('table_id', input.tableId).single();
      if (rowError) throw rowError;
      const element = await createElement({
        title: input.title.trim(),
        description: `${input.detail.trim()}\n\nSource: ${table.name}\nTable: ${input.tableId}\nRecord: ${input.rowId}\nAnalysis captured: ${new Date().toISOString()}`,
        object_id: input.objectId,
        owner_id: input.objectId ? null : userId,
        status: 'todo',
        priority: 'high',
      });
      void queryClient.invalidateQueries({ queryKey: ['my-elements'] });
      return element;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not create the Element. Your draft is preserved.';
      setError(message);
      throw new Error(message);
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return { create, saving, error };
}
