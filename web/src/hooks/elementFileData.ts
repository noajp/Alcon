'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';
import { applyOfficeEdits, type OfficeEdit } from '@/Function/office/officeEdits';
import { latestVersions, versionChain } from '@/Function/shared/fileVersions';

// Files attached to an Element from the person's computer. The bytes live in
// the private `element-files` bucket under "<element id>/…" and each one is
// listed in element_files; both follow the Element's visibility (RLS), so a
// file is opened through a short-lived signed link, never a public URL.
//
// Removing a file moves it to a trash for TRASH_DAYS: the row is marked
// deleted and the bytes stay, so its uploader can restore it. Once the days
// are up the file is no longer listed, and the uploader's next visit erases
// the bytes and the row (Storage takes deletes only through its API).
//
// A file edited in Alcon is saved as a new version: new bytes and a new row
// naming the row it replaces (previous_id). A replaced row is never listed;
// the listing, the trash and anything pinned to a file follow the latest.
// Edits are applied to the newest version when they are saved, not to the
// one they were made on, so two people editing one file keep each other's
// changes; a version takes one successor (unique index), so a save that
// loses the race is applied again onto the winner.

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
  /** The version this one replaces (null for a file as first attached). */
  previous_id: string | null;
}

const COLUMNS = 'id, element_id, path, name, size, mime_type, uploaded_by, created_at, deleted_at, previous_id';

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
  // A file due goes with its earlier versions (those the uploader can erase).
  const due = latestVersions(files)
    .filter((f) => f.deleted_at && f.uploaded_by === userId && trashDaysLeft(f.deleted_at) === 0)
    .flatMap((f) => versionChain(files, f.id).filter((v) => v.uploaded_by === userId));
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
        .select(COLUMNS)
        .eq('element_id', elementId!).order('created_at');
      if (error) throw error;
      const rows = (data ?? []) as ElementFile[];
      const { data: auth } = await supabase.auth.getUser();
      void purgeExpired(rows, auth.user?.id);
      return rows;
    },
  });
  const rows = query.data ?? EMPTY;
  const latest = latestVersions(rows);
  return {
    data: latest.filter((f) => !f.deleted_at),
    trashed: latest.filter((f) => f.deleted_at && trashDaysLeft(f.deleted_at) > 0),
    /** Every version of the Element's files, for a file's history. */
    all: rows,
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
  /** Saves edits as the file's next version, under the same name: applied
   *  to whatever version is newest when saving. */
  const saveEdits = useMutation({
    mutationFn: async ({ file, edits }: { file: ElementFile; edits: OfficeEdit[] }): Promise<SavedEdits> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: rows, error: listErr } = await supabase.from('element_files').select(COLUMNS).eq('element_id', elementId);
        if (listErr) throw listErr;
        const head = versionChain((rows ?? []) as ElementFile[], file.id)[0];
        if (!head || head.deleted_at) throw new Error(translate('This file was removed.'));
        const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(head.path);
        if (dlErr || !blob) throw dlErr ?? new Error('Could not read the file.');
        const result = await applyOfficeEdits(await blob.arrayBuffer(), edits);
        const saved = await insertVersion(elementId, head, result.bytes);
        if (saved) return { file: saved, conflicts: result.conflicts.length, skipped: result.skipped.length, newer: head.id !== file.id };
      }
      throw new Error(translate('Someone else keeps saving this file. Try again in a moment.'));
    },
    onSettled: () => {
      void refresh();
      void qc.invalidateQueries({ queryKey: ['element-file'] });
      void qc.invalidateQueries({ queryKey: ['element-files-in'] });
    },
  });
  return { upload, remove, restore, saveEdits };
}

export interface SavedEdits {
  file: ElementFile;
  /** Edits whose cell or paragraph someone else had changed meanwhile (theirs was overwritten). */
  conflicts: number;
  /** Edits whose paragraph is gone in the newest version (not applied). */
  skipped: number;
  /** Someone saved a newer version while this one was open; the edits went onto theirs. */
  newer: boolean;
}

/** Writes bytes as the version after `head`. Null when another version took
 *  that place first (the caller applies its edits again onto that one). */
async function insertVersion(elementId: string, head: ElementFile, bytes: Uint8Array): Promise<ElementFile | null> {
  if (bytes.byteLength > MAX_BYTES) throw new Error(translate('Files up to 50 MB can be attached.'));
  const path = elementFilePath(elementId, head.name, crypto.randomUUID());
  const type = head.mime_type || undefined;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, new Blob([bytes as BlobPart], { type }), { contentType: type });
  if (upErr) throw upErr;
  const { data, error } = await supabase.from('element_files').insert({
    element_id: elementId, path, name: head.name, size: bytes.byteLength, mime_type: head.mime_type, previous_id: head.id,
  }).select(COLUMNS).single();
  if (!error && data) return data as ElementFile;
  await supabase.storage.from(BUCKET).remove([path]);
  if (error?.code === '23505') return null;
  throw error ?? new Error('Could not save the file.');
}

/** A short-lived signed link to a file, for previewing it in the page. */
async function elementFileUrl(file: ElementFile, seconds = 300): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.path, seconds);
  if (error || !data?.signedUrl) throw error ?? new Error('Could not open the file.');
  return data.signedUrl;
}

/** Opens a file through a signed link that lasts a minute. The tab opens
 *  at once (inside the click, so no popup blocker stops it) and goes to the
 *  link when it arrives. */
async function openElementFile(file: ElementFile): Promise<void> {
  const tab = window.open('', '_blank');
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.path, 60);
  if (error || !data?.signedUrl) { tab?.close(); throw error ?? new Error('Could not open the file.'); }
  if (tab) { tab.opener = null; tab.location.href = data.signedUrl; }
  else window.location.assign(data.signedUrl);
}

/** Saves a file to the person's computer under its own name, through a
 *  signed link that asks the browser to download rather than show it. */
async function downloadElementFile(file: ElementFile): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.path, 60, { download: file.name });
  if (error || !data?.signedUrl) throw error ?? new Error('Could not download the file.');
  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Every listed (not trashed) file attached to these Elements — what a
 *  board's widget can pin. RLS leaves out what the viewer cannot see. */
export function useElementFilesIn(elementIds: string[]) {
  const key = [...elementIds].sort();
  const query = useQuery({
    queryKey: ['element-files-in', key],
    enabled: key.length > 0,
    queryFn: async (): Promise<ElementFile[]> => {
      const { data, error } = await supabase.from('element_files')
        .select(COLUMNS)
        .in('element_id', key.slice(0, 500)).order('created_at', { ascending: false });
      if (error) throw error;
      return latestVersions((data ?? []) as ElementFile[]).filter((f) => !f.deleted_at);
    },
  });
  return { data: query.data ?? EMPTY, loading: key.length > 0 && query.isPending };
}

/** One attached file by id, as its latest version (null when gone, trashed
 *  or not visible) — a board pinned to a file shows it as last edited. */
export function useElementFile(fileId: string | null) {
  return useQuery({
    queryKey: ['element-file', fileId],
    enabled: !!fileId,
    queryFn: async (): Promise<ElementFile | null> => {
      const { data: one, error } = await supabase.from('element_files').select('element_id').eq('id', fileId!).maybeSingle();
      if (error) throw error;
      if (!one) return null;
      const { data, error: listErr } = await supabase.from('element_files').select(COLUMNS).eq('element_id', (one as { element_id: string }).element_id);
      if (listErr) throw listErr;
      const latest = versionChain((data ?? []) as ElementFile[], fileId!)[0];
      return latest && !latest.deleted_at ? latest : null;
    },
  });
}

/** Where an attached file's bytes come from, for the shared preview and
 *  for anything else that reads one (a widget's chart or value). */
export const elementFileSource = {
  signedUrl: (f: { id: string }) => elementFileUrl(f as ElementFile),
  download: (f: { id: string }) => downloadElementFile(f as ElementFile),
  open: (f: { id: string }) => openElementFile(f as ElementFile),
};
