'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { ElementWithDetails } from '@/types/database';
import type { ElementAssigneeWithWorker } from '@/types/database';

export interface MyTask extends ElementWithDetails {
  object_name?: string;
}

export function useMyTasks() {
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchMyTasks = useCallback(async () => {
    try {
      setLoading(true);

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setTasks([]); setLoading(false); return; }

      // Find worker linked to this user
      const { data: workers } = await supabase
        .from('workers')
        .select('id')
        .eq('user_id', user.id);

      const workerIds = workers?.map(w => w.id) || [];

      if (workerIds.length === 0) {
        // No worker linked → surface Domain-direct Elements (object_id IS NULL)
        // as personal tasks for this user.
        const { data: rootElements } = await supabase
          .from('elements')
          .select('*')
          .is('object_id', null)
          .order('created_at', { ascending: false });

        setTasks((rootElements || []) as MyTask[]);
        setLoading(false);
        return;
      }

      // Get element IDs assigned to this worker
      const { data: assignees } = await supabase
        .from('element_assignees')
        .select('element_id')
        .in('worker_id', workerIds);

      const elementIds = assignees?.map(a => a.element_id) || [];

      if (elementIds.length === 0) {
        setTasks([]);
        setLoading(false);
        return;
      }

      // Fetch those elements with details
      const { data: elements } = await supabase
        .from('elements')
        .select('*')
        .in('id', elementIds)
        .order('created_at', { ascending: false });

      if (!elements) { setTasks([]); setLoading(false); return; }

      // Fetch subelements for these elements
      const { data: subelements } = await supabase
        .from('subelements')
        .select('*')
        .in('element_id', elementIds)
        .order('order_index');

      // Fetch all assignees for these elements
      const { data: allAssignees } = await supabase
        .from('element_assignees')
        .select('*, worker:workers(*)')
        .in('element_id', elementIds);

      // Fetch object names for context
      const objectIds = [...new Set(elements.map(e => e.object_id).filter(Boolean))];
      let objectMap: Record<string, string> = {};
      if (objectIds.length > 0) {
        const { data: objects } = await supabase
          .from('objects')
          .select('id, name')
          .in('id', objectIds);
        objectMap = Object.fromEntries((objects || []).map(o => [o.id, o.name]));
      }

      // Assemble MyTask objects
      const myTasks: MyTask[] = elements.map(el => ({
        ...el,
        subelements: (subelements || []).filter(s => s.element_id === el.id),
        assignees: ((allAssignees || []) as ElementAssigneeWithWorker[]).filter(a => a.element_id === el.id),
        object_name: el.object_id ? objectMap[el.object_id] || undefined : undefined,
      }));

      setTasks(myTasks);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch tasks'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMyTasks(); }, [fetchMyTasks]);

  return { tasks, loading, error, refetch: fetchMyTasks };
}
