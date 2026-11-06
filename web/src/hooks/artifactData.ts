'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// What Artifacts lists besides files and folders: this person's notebooks
// (top-level notes) and the Space's slide decks, with the Artifacts folder
// each sits in — and placing a new one in a folder. A notebook is listed only
// to whom it already shows (the notes rules), wherever it is placed.

export interface ArtifactNotebook { id: string; name: string; folder_id: string | null; updated_at: string }
export interface ArtifactDeck { id: string; name: string; artifact_folder_id: string | null; updated_at: string }

export const ARTIFACT_DECKS_KEY = ['artifact-decks'] as const;

export function useNotebooksAndDecks(spaceId: string | null) {
  const notebooks = useQuery({
    queryKey: ['artifact-notebooks'],
    queryFn: async (): Promise<ArtifactNotebook[]> => {
      const { data, error } = await supabase.from('notes').select('id, name, folder_id, updated_at').eq('type', 'folder').is('parent_id', null).order('order_index');
      if (error) throw error;
      return (data ?? []) as ArtifactNotebook[];
    },
  });
  const decks = useQuery({
    queryKey: [...ARTIFACT_DECKS_KEY, spaceId],
    enabled: !!spaceId,
    queryFn: async (): Promise<ArtifactDeck[]> => {
      const { data, error } = await supabase.from('decks').select('id, name, artifact_folder_id, updated_at').eq('activity_space_id', spaceId!).order('name');
      if (error) throw error;
      return (data ?? []) as ArtifactDeck[];
    },
  });
  return { notebooks: notebooks.data ?? [], decks: decks.data ?? [], loading: notebooks.isPending || (!!spaceId && decks.isPending) };
}

/** Puts a notebook in an Artifacts folder. */
export async function placeNotebook(notebookId: string, folderId: string): Promise<void> {
  const { error } = await supabase.from('notes').update({ folder_id: folderId }).eq('id', notebookId);
  if (error) throw error;
}

/** Puts a deck in an Artifacts folder; false while Slides has not saved it yet. */
export async function placeDeck(deckId: string, folderId: string): Promise<boolean> {
  const { data, error } = await supabase.from('decks').update({ artifact_folder_id: folderId }).eq('id', deckId).select('id');
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
