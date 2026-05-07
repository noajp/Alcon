// Client wrapper around the generate-craft Edge Function.
// Sends the running chat history + element context, returns the model's
// prose reply and (when present) the extracted HTML draft.

import { supabase } from '@/lib/supabase';
import type { CraftFormat, CraftMessage } from './types';

export interface GenerateCraftArgs {
  element: { title: string; description?: string | null };
  format: CraftFormat;
  prompt: string;
  history: CraftMessage[];
  currentHtml: string | null;
}

export interface GenerateCraftResult {
  reply: string;
  html: string | null;
}

export async function generateCraft(args: GenerateCraftArgs): Promise<GenerateCraftResult> {
  const body = {
    element: { title: args.element.title, description: args.element.description ?? null },
    format: args.format,
    prompt: args.prompt,
    history: args.history.map((m) => ({ role: m.role, content: m.content })),
    currentHtml: args.currentHtml ?? undefined,
  };
  const { data, error } = await supabase.functions.invoke('generate-craft', { body });
  if (error) throw error;
  const result = data as { reply?: string; html?: string | null; error?: string };
  if (result.error) throw new Error(result.error);
  return {
    reply: result.reply ?? '',
    html: result.html ?? null,
  };
}
