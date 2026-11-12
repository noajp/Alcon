'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { attachFile, type Attachment } from './attachmentData';

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

/** Which tab of Artifacts: the Space, one Domain, one Object, or your own. */
export type ArtifactPlace =
  | { scope: 'space' }
  | { scope: 'domain'; domainId: string }
  | { scope: 'object'; objectId: string }
  | { scope: 'my'; userId: string };

/** The scope columns a tab's folders carry. */
function placeColumns(place: ArtifactPlace) {
  return {
    scope: place.scope,
    domain_id: place.scope === 'domain' ? place.domainId : null,
    object_id: place.scope === 'object' ? place.objectId : null,
    owner_id: place.scope === 'my' ? place.userId : null,
  };
}

const FOLDER_COLUMNS = 'id, activity_space_id, domain_id, parent_id, app, name, position, scope, object_id, owner_id, is_root';

/** The tab's root folder, made on first use. Two people making it at once
 *  meet the unique index; the loser reads the winner's. */
export async function ensureArtifactRoot(spaceId: string, place: ArtifactPlace): Promise<string> {
  const cols = placeColumns(place);
  const find = async () => {
    let q = supabase.from('folders').select('id').eq('activity_space_id', spaceId).eq('app', 'files')
      .eq('is_root', true).eq('scope', cols.scope).is('deleted_at', null);
    q = cols.domain_id ? q.eq('domain_id', cols.domain_id) : q.is('domain_id', null);
    q = cols.object_id ? q.eq('object_id', cols.object_id) : q.is('object_id', null);
    q = cols.owner_id ? q.eq('owner_id', cols.owner_id) : q.is('owner_id', null);
    const { data, error } = await q.limit(1);
    if (error) throw error;
    return (data?.[0]?.id as string | undefined) ?? null;
  };
  const found = await find();
  if (found) return found;
  const { data, error } = await supabase.from('folders')
    .insert({ activity_space_id: spaceId, app: 'files', name: 'root', position: 0, is_root: true, ...cols })
    .select('id').single();
  if (!error && data) return data.id as string;
  const again = await find();
  if (again) return again;
  throw error ?? new Error('Could not open this place.');
}

/** A folder inside `parentId`; it takes the parent's scope (a database rule). */
export async function createArtifactFolder(spaceId: string, parentId: string, name: string) {
  const { data, error } = await supabase.from('folders')
    .insert({ activity_space_id: spaceId, app: 'files', parent_id: parentId, name: name.trim().slice(0, 200) })
    .select(FOLDER_COLUMNS).single();
  if (error || !data) throw error ?? new Error('Could not create the folder.');
  return data as { id: string };
}

/** Puts a file at the top of the Space's Artifacts (a file inserted into a
 *  note or a description lives there, so everyone who reads the text can
 *  open it). */
export async function uploadToArtifacts(spaceId: string, file: File): Promise<Attachment> {
  const root = await ensureArtifactRoot(spaceId, { scope: 'space' });
  return attachFile({ kind: 'folder', id: root }, file);
}
