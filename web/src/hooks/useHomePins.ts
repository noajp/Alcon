'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// What can be surfaced on the Home dashboard. The Home layer/section an entity
// lands in is derived from its type — see HOME_LAYER below.
export type HomePinEntity =
  | 'domain' | 'object' | 'element'        // → Execution
  | 'note_folder' | 'strategy' | 'diagram' // → Materialization
  | 'chat' | 'talk';                       // → Action

export type HomeLayer = 'action' | 'materialization' | 'execution';

/** entity type → Home section. Single source of truth for the mapping. */
export const HOME_LAYER: Record<HomePinEntity, HomeLayer> = {
  chat: 'action',
  talk: 'action',
  note_folder: 'materialization',
  strategy: 'materialization',
  diagram: 'materialization',
  domain: 'execution',
  object: 'execution',
  element: 'execution',
};

export interface HomePin {
  id: string;
  entityType: HomePinEntity;
  entityId: string;
  position: number;
}

interface HomePinRow {
  id: string;
  entity_type: HomePinEntity;
  entity_id: string;
  position: number;
}

const rowToPin = (r: HomePinRow): HomePin => ({
  id: r.id,
  entityType: r.entity_type,
  entityId: r.entity_id,
  position: r.position,
});

/**
 * Per-user Home pins. A pin surfaces an entity (Domain / Note folder / …) on
 * the Home dashboard under its layer's section. Owner-scoped via RLS.
 */
export function useHomePins() {
  const [pins, setPins] = useState<HomePin[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('home_pins')
      .select('id, entity_type, entity_id, position')
      .order('position', { ascending: true });
    if (!error && data) setPins((data as HomePinRow[]).map(rowToPin));
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const isPinned = useCallback(
    (entityType: HomePinEntity, entityId: string) =>
      pins.some((p) => p.entityType === entityType && p.entityId === entityId),
    [pins],
  );

  const add = useCallback(async (entityType: HomePinEntity, entityId: string) => {
    const { data, error } = await supabase
      .from('home_pins')
      .insert({ entity_type: entityType, entity_id: entityId })
      .select('id, entity_type, entity_id, position')
      .single();
    if (error) throw error;
    setPins((prev) => [...prev, rowToPin(data as HomePinRow)]);
  }, []);

  const remove = useCallback(async (entityType: HomePinEntity, entityId: string) => {
    setPins((prev) => prev.filter((p) => !(p.entityType === entityType && p.entityId === entityId)));
    const { error } = await supabase
      .from('home_pins')
      .delete()
      .eq('entity_type', entityType)
      .eq('entity_id', entityId);
    if (error) throw error;
  }, []);

  /** Convenience toggle used by "Show on Home" menu items. */
  const toggle = useCallback(
    async (entityType: HomePinEntity, entityId: string) => {
      if (isPinned(entityType, entityId)) await remove(entityType, entityId);
      else await add(entityType, entityId);
    },
    [isPinned, add, remove],
  );

  return { pins, loading, reload, isPinned, add, remove, toggle };
}
