import { supabase } from '@/lib/supabase';
import type { Brief } from './types';

export type ObjectDraftElementPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface ObjectDraftElement {
  title: string;
  description?: string;
  priority?: ObjectDraftElementPriority;
}

export interface ObjectDraft {
  name: string;
  description: string;
  color?: string;
  elements: ObjectDraftElement[];
}

// Calls the draft-object Edge Function and returns an Alcon Object +
// Elements proposal derived from the Brief's structured content.
export async function draftObjectFromBrief(brief: Brief): Promise<ObjectDraft> {
  const body = {
    title: brief.title,
    overview: brief.structured?.overview,
    summary: brief.summary,
    decisions: brief.structured?.decisions,
    action_items: brief.structured?.action_items,
  };
  const { data, error } = await supabase.functions.invoke('draft-object', { body });
  if (error) throw error;
  const result = data as {
    name?: string;
    description?: string;
    color?: string | null;
    elements?: Array<{ title?: string; description?: string | null; priority?: string | null }>;
    error?: string;
  };
  if (result.error) throw new Error(result.error);

  const elements: ObjectDraftElement[] = (result.elements ?? [])
    .filter((e): e is { title: string; description?: string | null; priority?: string | null } => !!e?.title)
    .map((e) => ({
      title: e.title,
      description: e.description ?? undefined,
      priority: toPriority(e.priority ?? undefined),
    }));

  return {
    name: result.name ?? '',
    description: result.description ?? '',
    color: result.color ?? undefined,
    elements,
  };
}

function toPriority(raw?: string): ObjectDraftElementPriority | undefined {
  if (!raw) return undefined;
  if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'urgent') return raw;
  return undefined;
}
