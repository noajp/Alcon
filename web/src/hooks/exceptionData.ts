'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Exception installs (B13): a Space's installs of catalog exception
// entries. Members read the installs table (RLS); every change goes
// through the owner-checked RPCs — there is no client write path to
// the table, so an entry can only start speaking for a Space by its
// owner's act, at the catalog version that act recorded.

export interface ExceptionInstall {
  catalogItemId: string;
  version: number;
  enabled: boolean;
  installedBy: string | null;
  createdAt: string;
}

export function useExceptionInstalls(spaceId: string | null) {
  const qc = useQueryClient();
  const queryKey = ['exception-installs', spaceId ?? 'none'] as const;
  const query = useQuery({
    queryKey,
    enabled: !!spaceId,
    queryFn: async (): Promise<ExceptionInstall[]> => {
      const { data, error } = await supabase.from('space_exception_installs')
        .select('catalog_item_id, version, enabled, installed_by, created_at')
        .eq('activity_space_id', spaceId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as { catalog_item_id: string; version: number; enabled: boolean; installed_by: string | null; created_at: string }[])
        .map((r) => ({ catalogItemId: r.catalog_item_id, version: r.version, enabled: r.enabled, installedBy: r.installed_by, createdAt: r.created_at }));
    },
  });
  return {
    data: query.data ?? [],
    loading: !!spaceId && query.isPending,
    refetch: () => qc.invalidateQueries({ queryKey }),
  };
}

/** The owner's install — or re-install, which is the update act: it
 *  takes the catalog's current version and re-enables the entry. */
export async function installCatalogException(spaceId: string, itemId: string): Promise<void> {
  const { error } = await supabase.rpc('install_catalog_exception', { p_space_id: spaceId, p_item_id: itemId });
  if (error) throw error;
}

/** The owner's removal of an entry from the Space. */
export async function uninstallCatalogException(spaceId: string, itemId: string): Promise<void> {
  const { error } = await supabase.rpc('uninstall_catalog_exception', { p_space_id: spaceId, p_item_id: itemId });
  if (error) throw error;
}

/** Stopping an entry without removing it (or starting it again). */
export async function setCatalogExceptionEnabled(spaceId: string, itemId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_catalog_exception_enabled', { p_space_id: spaceId, p_item_id: itemId, p_enabled: enabled });
  if (error) throw error;
}
