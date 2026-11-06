'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';

// Folders. Each app has its own: Artifacts' folders nest without limit (one
// tree per Space) and hold files, notebooks and slide decks; Table's are a
// Domain's, one level deep, and hold Tables. Every member of the Space sees
// and arranges them. A folder is deleted only once nothing live is in it, and
// then hidden rather than erased: files of it in the trash still belong to it
// (restoring one brings the folder back), and its Tables show out of any
// folder.

/** Which app a folder belongs to. */
export type FolderApp = 'files' | 'tables';
export interface Folder { id: string; activity_space_id: string; domain_id: string | null; parent_id: string | null; app: FolderApp; name: string; position: number }

const key = (spaceId: string | null, app: FolderApp) => ['folders', spaceId, app] as const;

/** The active Space's folders for one app, in their order — a Domain's
 *  only when `domainId` is given. */
export function useFolders(app: FolderApp, domainId?: string | null) {
  const spaceId = useActiveSpaceId();
  const query = useQuery({
    queryKey: key(spaceId, app),
    enabled: !!spaceId,
    queryFn: async (): Promise<Folder[]> => {
      const { data, error } = await supabase.from('folders').select('id, activity_space_id, domain_id, parent_id, app, name, position')
        .eq('activity_space_id', spaceId!).eq('app', app).is('deleted_at', null).order('position').order('name');
      if (error) throw error;
      return (data ?? []) as Folder[];
    },
  });
  const all = query.data ?? EMPTY;
  return { data: domainId ? all.filter((f) => f.domain_id === domainId) : all, loading: !!spaceId && query.isPending };
}
const EMPTY: Folder[] = [];

/** Making, renaming and deleting an app's folders; a new one goes in
 *  `domainId` (Table) or inside `parentId` (Artifacts). */
export function useFolderActions(app: FolderApp, domainId: string | null = null, parentId: string | null = null) {
  const spaceId = useActiveSpaceId();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['folders'] });
    void qc.invalidateQueries({ queryKey: ['attachments-of'] });
    void qc.invalidateQueries({ queryKey: ['data-tables'] });
  };
  const create = useMutation({
    mutationFn: async (name: string): Promise<Folder> => {
      if (!spaceId) throw new Error(translate('Choose a Space first.'));
      const last = (qc.getQueryData<Folder[]>(key(spaceId, app)) ?? []).reduce((m, f) => Math.max(m, f.position), 0);
      const { data, error } = await supabase.from('folders').insert({ activity_space_id: spaceId, domain_id: domainId, parent_id: parentId, app, name: name.trim().slice(0, 200), position: last + 1 })
        .select('id, activity_space_id, domain_id, parent_id, app, name, position').single();
      if (error || !data) throw error ?? new Error('Could not create the folder.');
      return data as Folder;
    },
    onSettled: refresh,
  });
  const rename = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('folders').update({ name: name.trim().slice(0, 200) }).eq('id', id);
      if (error) throw error;
    },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { count, error: countError } = await supabase.from('attachments').select('id', { count: 'exact', head: true })
        .eq('folder_id', id).is('deleted_at', null);
      if (countError) throw countError;
      if (count) throw new Error(translate('Move or delete the files in this folder first.'));
      // Nor anything else an Artifacts folder holds: folders, notebooks, decks.
      if (app === 'files') {
        const held = await Promise.all([
          supabase.from('folders').select('id', { count: 'exact', head: true }).eq('parent_id', id).is('deleted_at', null),
          supabase.from('notes').select('id', { count: 'exact', head: true }).eq('folder_id', id),
          supabase.from('decks').select('id', { count: 'exact', head: true }).eq('artifact_folder_id', id),
        ]);
        for (const r of held) if (r.error) throw r.error;
        if (held.some((r) => r.count)) throw new Error(translate('Move or delete what is in this folder first.'));
      }
      const { error } = await supabase.from('folders').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
    onSettled: refresh,
  });
  return { create, rename, remove };
}
