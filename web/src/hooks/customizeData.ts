'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Settings › AI: the catalog of harnesses Alcon offers (catalog_items, read
// by everyone, seeded by migration), and the public MCP registry searched
// through the connector-directory function.
//
// Catalog versioning rule for migrations: a migration that inserts a
// catalog definition writes version = 1; one that changes an existing
// row's name, description or body increments version by 1 in the same
// update. An installed copy records the version it came from
// (definitions.source_version), which is how the library can tell that the
// catalog moved.

export interface CatalogDefinition { id: string; kind: 'definition'; name: string; description: string; body: string; sort: number; version: number }
export function useCatalog() {
  const query = useQuery({
    queryKey: ['catalog-items'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('catalog_items').select('id, kind, name, description, body, sort, version').order('sort');
      if (error) throw error;
      const rows = (data ?? []) as { id: string; kind: string; name: string; description: string; body: string | null; sort: number; version: number }[];
      return rows.filter((r) => r.kind === 'definition').map((r): CatalogDefinition => ({ id: r.id, kind: 'definition', name: r.name, description: r.description, body: r.body ?? '', sort: r.sort, version: r.version }));
    },
  });
  return { definitions: query.data ?? [], loading: query.isPending, error: (query.error as Error | null) ?? null };
}

/** A remote MCP server from the public registry, as adding it needs. */
export interface DirectoryEntry {
  id: string; title: string; description: string; endpoint: string;
  auth: 'none' | 'bearer' | 'header'; authHeader: string | null; website: string | null; icon: string | null; version: string;
}

export function useConnectorDirectory(q: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ['connector-directory', q],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('connector-directory', { body: { q } });
      if (error) throw error;
      const d = data as { entries?: DirectoryEntry[]; nextCursor?: string | null; error?: string } | null;
      if (d?.error) throw new Error(d.error);
      return d?.entries ?? [];
    },
  });
  return { data: query.data ?? [], loading: enabled && query.isPending, error: (query.error as Error | null) ?? null };
}
