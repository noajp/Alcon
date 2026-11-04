'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Settings › Customize: the catalog of definitions and packs Alcon offers
// (catalog_items, read by everyone, seeded by migration), and the public MCP
// registry searched through the connector-directory function.

export interface CatalogDefinition { id: string; kind: 'definition'; name: string; description: string; body: string; sort: number }
export type PackConnector = { preset: string } | { registry: string; title?: string };
export interface CatalogPack { id: string; kind: 'pack'; name: string; description: string; sort: number; definitions: string[]; connectors: PackConnector[] }

function readPack(row: { id: string; name: string; description: string; sort: number; payload: unknown }): CatalogPack {
  const p = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {};
  const definitions = Array.isArray(p.definitions) ? p.definitions.filter((d): d is string => typeof d === 'string') : [];
  const connectors = (Array.isArray(p.connectors) ? p.connectors : []).flatMap((c): PackConnector[] => {
    const x = c && typeof c === 'object' ? c as Record<string, unknown> : {};
    if (typeof x.preset === 'string') return [{ preset: x.preset }];
    if (typeof x.registry === 'string') return [{ registry: x.registry, title: typeof x.title === 'string' ? x.title : undefined }];
    return [];
  });
  return { id: row.id, kind: 'pack', name: row.name, description: row.description, sort: row.sort, definitions, connectors };
}

export function useCatalog() {
  const query = useQuery({
    queryKey: ['catalog-items'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('catalog_items').select('id, kind, name, description, body, payload, sort').order('sort');
      if (error) throw error;
      const rows = (data ?? []) as { id: string; kind: string; name: string; description: string; body: string | null; payload: unknown; sort: number }[];
      return {
        definitions: rows.filter((r) => r.kind === 'definition').map((r): CatalogDefinition => ({ id: r.id, kind: 'definition', name: r.name, description: r.description, body: r.body ?? '', sort: r.sort })),
        packs: rows.filter((r) => r.kind === 'pack').map(readPack),
      };
    },
  });
  return { definitions: query.data?.definitions ?? [], packs: query.data?.packs ?? [], loading: query.isPending, error: (query.error as Error | null) ?? null };
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
