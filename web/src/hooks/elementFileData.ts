'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';

// Files attached to an Element from the person's computer. The bytes live in
// the private `element-files` bucket under "<element id>/…" and each one is
// listed in element_files; both follow the Element's visibility (RLS), so a
// file is opened through a short-lived signed link, never a public URL.
//
// Removing a file moves it to a trash for TRASH_DAYS: the row is marked
// deleted and the bytes stay, so its uploader can restore it. Once the days
// are up the file is no longer listed, and the uploader's next visit erases
// the bytes and the row (Storage takes deletes only through its API).

const BUCKET = 'element-files';
const MAX_BYTES = 50 * 1024 * 1024;
export const TRASH_DAYS = 30;
const DAY = 86_400_000;

export interface ElementFile {
  id: string;
  element_id: string;
  path: string;
  name: string;
  size: number;
  mime_type: string | null;
  uploaded_by: string;
  created_at: string;
  deleted_at: string | null;
}

const filesKey = (elementId: string) => ['element', elementId, 'files'] as const;
const EMPTY: ElementFile[] = [];

/** Pure. Days left before a trashed file is erased (0 = due). */
export function trashDaysLeft(deletedAt: string, now = Date.now()): number {
  return Math.max(0, TRASH_DAYS - Math.floor((now - new Date(deletedAt).getTime()) / DAY));
}

/** Erases files whose trash days are up — the bytes through the Storage
 *  API, then the rows. Only the uploader's own; best effort, as the next
 *  visit tries again. */
async function purgeExpired(files: ElementFile[], userId: string | undefined) {
  const due = files.filter((f) => f.deleted_at && f.uploaded_by === userId && trashDaysLeft(f.deleted_at) === 0);
  if (!due.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(due.map((f) => f.path));
  if (!error) await supabase.from('element_files').delete().in('id', due.map((f) => f.id));
}

export function useElementFiles(elementId: string | null) {
  const query = useQuery({
    queryKey: filesKey(elementId ?? ''),
    enabled: !!elementId,
    queryFn: async (): Promise<ElementFile[]> => {
      const { data, error } = await supabase.from('element_files')
        .select('id, element_id, path, name, size, mime_type, uploaded_by, created_at, deleted_at')
        .eq('element_id', elementId!).order('created_at');
      if (error) throw error;
      const rows = (data ?? []) as ElementFile[];
      const { data: auth } = await supabase.auth.getUser();
      void purgeExpired(rows, auth.user?.id);
      return rows.filter((f) => !f.deleted_at || trashDaysLeft(f.deleted_at) > 0);
    },
  });
  const all = query.data ?? EMPTY;
  return {
    data: all.filter((f) => !f.deleted_at),
    trashed: all.filter((f) => f.deleted_at),
    loading: !!elementId && query.isPending,
  };
}

/** Pure. A storage key under the Element. Storage accepts ASCII keys only
 *  (a Japanese file name is refused as an invalid key), so the key is a
 *  random id plus the name's extension; the name itself is kept in
 *  element_files for display. */
function elementFilePath(elementId: string, name: string, random: string): string {
  const ext = /\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1]?.toLowerCase();
  return `${elementId}/${random}${ext ? `.${ext}` : ''}`;
}

export function useElementFileActions(elementId: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: filesKey(elementId) });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_BYTES) throw new Error(translate('Files up to 50 MB can be attached.'));
      const path = elementFilePath(elementId, file.name, crypto.randomUUID());
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
      if (upErr) throw upErr;
      const { error } = await supabase.from('element_files').insert({
        element_id: elementId, path, name: file.name, size: file.size, mime_type: file.type || null,
      });
      if (error) {
        // The listing was refused: don't leave the bytes behind unlisted.
        await supabase.storage.from(BUCKET).remove([path]);
        throw error;
      }
    },
    onSettled: refresh,
  });
  // Trash and restore both write the two trash columns only; RLS lets the
  // uploader alone, so an empty result means someone else's file.
  const mark = async (file: ElementFile, deleted: boolean) => {
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('element_files')
      .update(deleted ? { deleted_at: new Date().toISOString(), deleted_by: auth.user?.id ?? null } : { deleted_at: null, deleted_by: null })
      .eq('id', file.id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error(translate('Only the person who attached a file can remove it.'));
  };
  const remove = useMutation({ mutationFn: (file: ElementFile) => mark(file, true), onSettled: refresh });
  const restore = useMutation({ mutationFn: (file: ElementFile) => mark(file, false), onSettled: refresh });
  return { upload, remove, restore };
}

/** A short-lived signed link to a file, for previewing it in the page. */
export async function elementFileUrl(file: ElementFile, seconds = 300): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.path, seconds);
  if (error || !data?.signedUrl) throw error ?? new Error('Could not open the file.');
  return data.signedUrl;
}

/** Opens a file through a signed link that lasts a minute. The tab opens
 *  at once (inside the click, so no popup blocker stops it) and goes to the
 *  link when it arrives. */
export async function openElementFile(file: ElementFile): Promise<void> {
  const tab = window.open('', '_blank');
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.path, 60);
  if (error || !data?.signedUrl) { tab?.close(); throw error ?? new Error('Could not open the file.'); }
  if (tab) { tab.opener = null; tab.location.href = data.signedUrl; }
  else window.location.assign(data.signedUrl);
}

/** Saves a file to the person's computer under its own name, through a
 *  signed link that asks the browser to download rather than show it. */
export async function downloadElementFile(file: ElementFile): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.path, 60, { download: file.name });
  if (error || !data?.signedUrl) throw error ?? new Error('Could not download the file.');
  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
