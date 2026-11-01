'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';

// Files attached to an Element from the person's computer. The bytes live in
// the private `element-files` bucket under "<element id>/…" and each one is
// listed in element_files; both follow the Element's visibility (RLS), so a
// file is opened through a short-lived signed link, never a public URL.

const BUCKET = 'element-files';
const MAX_BYTES = 50 * 1024 * 1024;

export interface ElementFile {
  id: string;
  element_id: string;
  path: string;
  name: string;
  size: number;
  mime_type: string | null;
  uploaded_by: string;
  created_at: string;
}

const filesKey = (elementId: string) => ['element', elementId, 'files'] as const;
const EMPTY: ElementFile[] = [];

export function useElementFiles(elementId: string | null) {
  const query = useQuery({
    queryKey: filesKey(elementId ?? ''),
    enabled: !!elementId,
    queryFn: async (): Promise<ElementFile[]> => {
      const { data, error } = await supabase.from('element_files')
        .select('id, element_id, path, name, size, mime_type, uploaded_by, created_at')
        .eq('element_id', elementId!).order('created_at');
      if (error) throw error;
      return (data ?? []) as ElementFile[];
    },
  });
  return { data: query.data ?? EMPTY, loading: !!elementId && query.isPending };
}

/** Pure. A storage key for `name` under the Element: a random prefix keeps
 *  two files of the same name apart; characters storage rejects become "_". */
function elementFilePath(elementId: string, name: string, random: string): string {
  const safe = name.normalize('NFC').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(-120) || 'file';
  return `${elementId}/${random}-${safe}`;
}

export function useElementFileActions(elementId: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: filesKey(elementId) });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_BYTES) throw new Error(translate('Files up to 50 MB can be attached.'));
      const path = elementFilePath(elementId, file.name, crypto.randomUUID().slice(0, 8));
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
  const remove = useMutation({
    mutationFn: async (file: ElementFile) => {
      const { data, error } = await supabase.from('element_files').delete().eq('id', file.id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error(translate('Only the person who attached a file can remove it.'));
      await supabase.storage.from(BUCKET).remove([file.path]);
    },
    onSettled: refresh,
  });
  return { upload, remove };
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
