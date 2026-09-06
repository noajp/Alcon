import { getCurrentUserId, supabase } from '@/lib/supabase';
import type { Intent, IntentInsert } from '@/types/database';

/** Stable ids make retries safe even if the response is lost after an insert. */
export async function recordDecisionLabDecision(input: IntentInsert & { id: string }, bindingId: string, elementId: string): Promise<Intent> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Sign in to record a decision.');
  const { error } = await supabase.from('intents').upsert({ ...input, created_by: userId }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw new Error('Could not confirm the decision was saved. Retry to confirm this same record.');
  const { data: saved, error: readError } = await supabase.from('intents').select('*').eq('id', input.id).single();
  if (readError || !saved) throw new Error('Could not confirm the saved decision. Retry to confirm this same record.');
  if (saved.strategy_id !== input.strategy_id || saved.parent_intent_id !== (input.parent_intent_id ?? null)
    || saved.subtitle !== (input.subtitle ?? null) || saved.created_by !== userId
    || saved.title !== input.title || saved.abandoned !== (input.abandoned ?? null)
    || saved.kind !== (input.kind ?? 'decision') || saved.slug !== (input.slug ?? null)) {
    throw new Error('This decision was changed elsewhere. Refresh before recording a new decision.');
  }
  const { error: linkError } = await supabase.from('intent_bindings').upsert({
    id: bindingId, intent_id: input.id, target_type: 'element', target_id: elementId, relationship_type: 'delivers',
  }, { onConflict: 'intent_id,target_type,target_id,relationship_type', ignoreDuplicates: true });
  if (linkError) throw new Error('The decision is saved, but its Element link could not be saved. Retry to complete the link.');
  const { error: verifyError } = await supabase.from('intent_bindings').select('id')
    .eq('intent_id', input.id).eq('target_type', 'element').eq('target_id', elementId).eq('relationship_type', 'delivers').single();
  if (verifyError) throw new Error('The decision is saved. Its Element link could not be confirmed; retry to check it.');
  return saved as Intent;
}
