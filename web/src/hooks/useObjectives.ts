'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ============================================
// Types
// ============================================

export interface Objective {
  id: string;
  title: string;
  description: string | null;
  type: 'objective' | 'key_result';
  parent_id: string | null;
  target_value: number | null;
  current_value: number | null;
  status: string;
  due_date: string | null;
  order_index: number;
}

export interface ObjectiveLink {
  id: string;
  objective_id: string;
  object_id: string;
}

export interface KeyResultWithLinks extends Objective {
  links: ObjectiveLink[];
}

export interface ObjectiveWithDetails extends Objective {
  keyResults: KeyResultWithLinks[];
}

// ============================================
// Hook: Fetch All Objectives (grouped hierarchy)
// ============================================

export function useObjectives() {
  const [objectives, setObjectives] = useState<ObjectiveWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch all objectives
      const { data: objectivesData, error: objectivesError } = await supabase
        .from('objectives')
        .select('*')
        .order('order_index');

      if (objectivesError) throw objectivesError;
      const allObjectives = (objectivesData || []) as Objective[];

      // Fetch all objective links
      const { data: linksData, error: linksError } = await supabase
        .from('objective_links')
        .select('*');

      if (linksError) throw linksError;
      const allLinks = (linksData || []) as ObjectiveLink[];

      // Group: top-level objectives with nested key results
      const topLevel = allObjectives.filter(o => o.type === 'objective');
      const keyResults = allObjectives.filter(o => o.type === 'key_result');

      const grouped: ObjectiveWithDetails[] = topLevel.map(obj => ({
        ...obj,
        keyResults: keyResults
          .filter(kr => kr.parent_id === obj.id)
          .map(kr => ({
            ...kr,
            links: allLinks.filter(link => link.objective_id === kr.id),
          })),
      }));

      setObjectives(grouped);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  return { objectives, loading, error, refetch };
}

// ============================================
// Objective CRUD
// ============================================

export async function createObjective(data: Partial<Objective>): Promise<Objective> {
  const { data: result, error } = await supabase
    .from('objectives')
    .insert({
      title: data.title ?? '',
      description: data.description ?? null,
      type: data.type ?? 'objective',
      parent_id: data.parent_id ?? null,
      target_value: data.target_value ?? null,
      current_value: data.current_value ?? null,
      status: data.status ?? 'on_track',
      due_date: data.due_date ?? null,
      order_index: data.order_index ?? 0,
    })
    .select()
    .single();

  if (error) throw error;
  return result as Objective;
}

export async function updateObjective(id: string, data: Partial<Objective>): Promise<void> {
  const { error } = await supabase
    .from('objectives')
    .update(data)
    .eq('id', id);

  if (error) throw error;
}

export async function deleteObjective(id: string): Promise<void> {
  // Delete child key results first
  await supabase
    .from('objectives')
    .delete()
    .eq('parent_id', id);

  // Delete links referencing this objective
  await supabase
    .from('objective_links')
    .delete()
    .eq('objective_id', id);

  const { error } = await supabase
    .from('objectives')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// Objective Link CRUD
// ============================================

export async function createObjectiveLink(objectiveId: string, objectId: string): Promise<void> {
  const { error } = await supabase
    .from('objective_links')
    .insert({
      objective_id: objectiveId,
      object_id: objectId,
    });

  if (error) throw error;
}

export async function deleteObjectiveLink(id: string): Promise<void> {
  const { error } = await supabase
    .from('objective_links')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
