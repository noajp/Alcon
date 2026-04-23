import { supabase } from '@/lib/supabase';
import { extractPlainText } from './contentUtils';

// Calls the summarize-note Edge Function and returns a 3-5 line summary.
// The caller passes raw BlockNote JSON (or plain text) as `content`; this
// helper flattens it to plain text before sending, so the Edge Function
// can stay model-focused and not worry about block parsing.
export async function summarizeNoteContent(args: {
  title: string;
  content: string;
}): Promise<string> {
  const plainText = extractPlainText(args.content);
  const { data, error } = await supabase.functions.invoke('summarize-note', {
    body: { title: args.title, plainText },
  });
  if (error) throw error;
  const result = data as { summary?: string; error?: string };
  if (result.error) throw new Error(result.error);
  return (result.summary ?? '').trim();
}
