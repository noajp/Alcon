import { supabase } from '@/lib/supabase';
import type { Ticket } from './types';

export interface ObjectDraft {
  name: string;
  description: string;
  color?: string;
}

// Calls the draft-object Edge Function and returns an Alcon Object
// proposal derived from the Commit's structured content.
export async function draftObjectFromTicket(ticket: Ticket): Promise<ObjectDraft> {
  const body = {
    title: ticket.title,
    overview: ticket.structured?.overview,
    summary: ticket.summary,
    decisions: ticket.structured?.decisions,
    action_items: ticket.structured?.action_items,
  };
  const { data, error } = await supabase.functions.invoke('draft-object', { body });
  if (error) throw error;
  const result = data as { name?: string; description?: string; color?: string | null; error?: string };
  if (result.error) throw new Error(result.error);
  return {
    name: result.name ?? '',
    description: result.description ?? '',
    color: result.color ?? undefined,
  };
}
