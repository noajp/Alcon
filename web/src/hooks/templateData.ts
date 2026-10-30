'use client';

import { getQueryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';
import type { ElementTemplate, ElementTemplateInsert, ElementTemplateUpdate } from '@/types/database';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';


// ============================================
// Element Templates (Settings > Elements > Templates, el_QLT-029)
// Domain-scoped saved Element shapes. RLS: any Domain member can read (and
// use, from QuickAdd); only an owner/admin can author — see the migration.
// ============================================

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

function parseElementTemplate(row: Record<string, unknown>): ElementTemplate {
  return {
    id: row.id as string,
    domain_id: row.domain_id as string,
    name: row.name as string,
    type: (row.type as string | null) ?? null,
    status: (row.status as ElementTemplate['status']) ?? null,
    priority: (row.priority as ElementTemplate['priority']) ?? null,
    labels: toStringArray(row.labels),
    assignee_worker_ids: toStringArray(row.assignee_worker_ids),
    description: (row.description as string | null) ?? null,
    estimated_hours: (row.estimated_hours as number | null) ?? null,
    order_index: (row.order_index as number) ?? 0,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

async function fetchElementTemplates(domainId: string): Promise<ElementTemplate[]> {
  const { data, error } = await supabase
    .from('element_templates')
    .select('*')
    .eq('domain_id', domainId)
    .order('order_index')
    .order('name');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(parseElementTemplate);
}

// Same cross-instance-sync problem `useDomains` already solved for the
// Domain list (DOMAINS_CHANGED_EVENT/notifyDomainsChanged in domainsStore.ts)
// — a plain useState+useEffect fetch has no shared cache, so a Settings-page
// edit would otherwise leave an already-mounted QuickAdd popup's own
// `useElementTemplates(domainId)` (a different tab, or one that just hasn't
// remounted) showing stale template contents indefinitely.
const ELEMENT_TEMPLATES_CHANGED_EVENT = 'alcon:element-templates-changed';
function notifyElementTemplatesChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ELEMENT_TEMPLATES_CHANGED_EVENT));
}

export async function createElementTemplate(input: ElementTemplateInsert): Promise<ElementTemplate> {
  const { data, error } = await supabase
    .from('element_templates')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  notifyElementTemplatesChanged();
  return parseElementTemplate(data as Record<string, unknown>);
}

export async function updateElementTemplate(id: string, updates: ElementTemplateUpdate): Promise<ElementTemplate> {
  const { data, error } = await supabase
    .from('element_templates')
    .update(updates)
    .eq('id', id)
    .select('*');
  if (error) throw error;
  // RLS-blocked update: PostgREST answers with an empty success, not an
  // error, when the row exists but the actor isn't an owner/admin of its
  // Domain — a Settings page must not read that as saved.
  if (!data || data.length === 0) {
    throw new Error(translate('Couldn’t save — you may not have owner/admin access to this Domain.'));
  }
  notifyElementTemplatesChanged();
  return parseElementTemplate(data[0] as Record<string, unknown>);
}

export async function deleteElementTemplate(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('element_templates')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(translate('Couldn’t delete — you may not have owner/admin access to this Domain.'));
  }
  notifyElementTemplatesChanged();
}

const ELEMENT_TEMPLATES_QUERY_PREFIX = ['element-templates'] as const;
const EMPTY_TEMPLATES: ElementTemplate[] = [];

// Template edits broadcast ELEMENT_TEMPLATES_CHANGED_EVENT (notifyElementTemplatesChanged
// above); one module-level listener invalidates every mounted reader.
if (typeof window !== 'undefined') {
  window.addEventListener(ELEMENT_TEMPLATES_CHANGED_EVENT, () => {
    void getQueryClient().invalidateQueries({ queryKey: ELEMENT_TEMPLATES_QUERY_PREFIX });
  });
}

export function useElementTemplates(domainId: string | null) {
  const qc = useQueryClient();
  const key = useMemo(() => [...ELEMENT_TEMPLATES_QUERY_PREFIX, domainId ?? ''] as const, [domainId]);
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchElementTemplates(domainId!),
    enabled: !!domainId,
  });
  const refetch = useCallback(async () => { await qc.invalidateQueries({ queryKey: key }); }, [qc, key]);
  return {
    templates: query.data ?? EMPTY_TEMPLATES,
    loading: !!domainId && query.isPending,
    error: query.error ? (query.error instanceof Error ? query.error.message : 'Failed to load templates') : null,
    refetch,
  };
}
