import { supabase } from '@/lib/supabase';
import { extractPlainText } from './contentUtils';
import type { TicketStructured } from './types';

// Calls the summarize-note Edge Function and returns a Loop-style
// structured recap. The caller passes raw BlockNote JSON (or plain
// text) as `content`; this helper flattens it to plain text before
// sending, so the Edge Function can stay model-focused.
export async function summarizeNoteContent(args: {
  title: string;
  content: string;
}): Promise<TicketStructured> {
  const plainText = extractPlainText(args.content);
  const { data, error } = await supabase.functions.invoke('summarize-note', {
    body: { title: args.title, plainText },
  });
  if (error) throw error;
  const result = data as (TicketStructured & { error?: string });
  if (result.error) throw new Error(result.error);
  return {
    overview: result.overview ?? '',
    summary: result.summary ?? '',
    decisions: result.decisions ?? [],
    action_items: result.action_items ?? [],
    questions: result.questions ?? [],
    participants: result.participants ?? [],
  };
}
