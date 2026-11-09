'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { TableInsert } from '@/types/db';
import { translate } from '@/Function/i18n/I18nProvider';
import { getQueryClient } from '@/lib/queryClient';
import { applyOfficeEdits, type OfficeEdit } from '@/Function/office/officeEdits';
import { latestVersions, versionChain, versionsPastKeeping } from '@/Function/shared/fileVersions';
import { fileText } from '@/Function/office/fileText';

// Files attached to one thing in the Space — an Element, an Object, an
// Strategy, or one of the Space's folders — from the person's
// computer. The file is evidence for what it is attached to: it is seen by
// exactly those who can see that thing (attachments' RLS asks the owner's),
// and goes with it. The bytes live in the private `element-files` bucket
// under "<owner kind>/<owner id>/…", opened through a short-lived signed
// link, never a public URL.
//
// A file edited in Alcon is saved as a new version: new bytes and a new row
// naming the row it replaces (previous_id). A replaced row is never listed;
// the listing, the trash and anything pinned to a file follow the latest.
// Edits are applied to the newest version when they are saved, not to the
// one they were made on, so two people editing one file keep each other's
// changes; a version takes one successor (unique index), so a save that
// loses the race is applied again onto the winner.
//
// Removing a file moves every version of it to a trash for TRASH_DAYS;
// anyone who can see the owner can trash and restore it. Once the days are
// up, the next visit by anyone who can see it erases the bytes (through the
// Storage API) and the rows.

const BUCKET = 'element-files';
const MAX_BYTES = 50 * 1024 * 1024;
export const TRASH_DAYS = 30;
const DAY = 86_400_000;

/** What a file can be attached to, and the column that names it. */
export type AttachmentOwnerKind = 'element' | 'object' | 'strategy' | 'folder';
export interface AttachmentOwner { kind: AttachmentOwnerKind; id: string }
/** Pure. What a board's subject attaches files as (null: it cannot hold files). */
export function attachmentOwnerOf(subject: { kind: string; id: string | null }): AttachmentOwner | null {
  const kind = ({ element: 'element', object: 'object', initiative: 'strategy' } as Record<string, AttachmentOwnerKind>)[subject.kind];
  return kind && subject.id ? { kind, id: subject.id } : null;
}
type OwnerColumn = 'element_id' | 'object_id' | 'strategy_id' | 'folder_id';
const OWNER_COLUMN: Record<AttachmentOwnerKind, OwnerColumn> = {
  element: 'element_id', object: 'object_id', strategy: 'strategy_id', folder: 'folder_id',
};

export interface Attachment {
  id: string;
  path: string;
  name: string;
  size: number;
  mime_type: string | null;
  uploaded_by: string;
  created_at: string;
  deleted_at: string | null;
  /** The version this one replaces (null for a file as first attached). */
  previous_id: string | null;
  element_id: string | null;
  object_id: string | null;
  strategy_id: string | null;
  folder_id: string | null;
}

const COLUMNS = 'id, path, name, size, mime_type, uploaded_by, created_at, deleted_at, previous_id, element_id, object_id, strategy_id, folder_id';
const EMPTY: Attachment[] = [];

/** Pure. What a file is attached to (exactly one owner column is set). */
export function ownerOf(file: Attachment): AttachmentOwner {
  const kind = (Object.keys(OWNER_COLUMN) as AttachmentOwnerKind[]).find((k) => file[OWNER_COLUMN[k] as keyof Attachment]);
  return { kind: kind ?? 'element', id: String(file[OWNER_COLUMN[kind ?? 'element'] as keyof Attachment] ?? '') };
}

const listKey = (owner: AttachmentOwner) => ['attachments', owner.kind, owner.id] as const;

/** Pure. Days left before a trashed file is erased (0 = due). */
export function trashDaysLeft(deletedAt: string, now = Date.now()): number {
  return Math.max(0, TRASH_DAYS - Math.floor((now - new Date(deletedAt).getTime()) / DAY));
}

/** Erases files whose trash days are up — the bytes through the Storage
 *  API, then the rows; best effort, as the next visit tries again. */
async function purgeExpired(rows: Attachment[]) {
  const due = rows.filter((f) => f.deleted_at && trashDaysLeft(f.deleted_at) === 0);
  if (!due.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(due.map((f) => f.path));
  if (!error) await supabase.from('attachments').delete().in('id', due.map((f) => f.id));
}

/** Erases versions past keeping (fileVersions) the same way; best effort. */
async function pruneOldVersions(rows: Attachment[]) {
  const old = versionsPastKeeping(rows);
  if (!old.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(old.map((v) => v.path));
  if (!error) await supabase.from('attachments').delete().in('id', old.map((v) => v.id));
}

async function rowsOf(owner: AttachmentOwner): Promise<Attachment[]> {
  const { data, error } = await supabase.from('attachments').select(COLUMNS).eq(OWNER_COLUMN[owner.kind], owner.id).order('created_at');
  if (error) throw error;
  return (data ?? []) as Attachment[];
}

/** A thing's attached files, as their latest versions: listed, and in the trash. */
export function useAttachments(owner: AttachmentOwner | null) {
  const query = useQuery({
    queryKey: owner ? listKey(owner) : ['attachments', 'none'],
    enabled: !!owner?.id,
    queryFn: async () => {
      const rows = await rowsOf(owner!);
      void purgeExpired(rows);
      void pruneOldVersions(rows);
      return rows;
    },
  });
  const all = query.data ?? EMPTY;
  const latest = latestVersions(all);
  return {
    data: latest.filter((f) => !f.deleted_at),
    trashed: latest.filter((f) => f.deleted_at && trashDaysLeft(f.deleted_at) > 0),
    /** Every version of every file, for a file's history. */
    all,
    loading: !!owner?.id && query.isPending,
  };
}

/** Pure. A storage key under its owner. Storage accepts ASCII keys only (a
 *  Japanese file name is refused as an invalid key), so the key is a random
 *  id plus the name's extension; the name itself is kept in the row. */
function attachmentPath(owner: AttachmentOwner, name: string, random: string): string {
  const ext = /\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1]?.toLowerCase();
  return `${owner.kind}/${owner.id}/${random}${ext ? `.${ext}` : ''}`;
}

/** Writes bytes as a new row (a first upload, or the version after
 *  `previous`). Null when another version took that place first. */
async function insertFile(owner: AttachmentOwner, name: string, mime: string | null, bytes: Blob, previous: Attachment | null): Promise<Attachment | null> {
  if (bytes.size > MAX_BYTES) throw new Error(translate('Files up to 50 MB can be attached.'));
  const path = attachmentPath(owner, name, crypto.randomUUID());
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mime || undefined });
  if (upErr) throw upErr;
  const row: TableInsert<'attachments'> = { path, name, size: bytes.size, mime_type: mime, previous_id: previous?.id ?? null };
  row[OWNER_COLUMN[owner.kind]] = owner.id;
  const { data, error } = await supabase.from('attachments').insert(row).select(COLUMNS).single();
  if (!error && data) {
    // Its words, for finding it (in the background; a file that cannot be
    // read is found by its name only).
    void indexText(data as Attachment, bytes);
    return data as Attachment;
  }
  // The listing was refused: don't leave the bytes behind unlisted.
  await supabase.storage.from(BUCKET).remove([path]);
  if (error?.code === '23505') return null;
  throw error ?? new Error('Could not save the file.');
}

export interface SavedEdits {
  file: Attachment;
  /** Edits whose cell or paragraph someone else had changed meanwhile (theirs was overwritten). */
  conflicts: number;
  /** Edits whose paragraph is gone in the newest version (not applied). */
  skipped: number;
  /** Someone saved a newer version while this one was open; the edits went onto theirs. */
  newer: boolean;
}

export function useAttachmentActions(owner: AttachmentOwner) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: listKey(owner) });
    void qc.invalidateQueries({ queryKey: ['attachment'] });
    void qc.invalidateQueries({ queryKey: ['attachments-of'] });
  };
  const upload = useMutation({
    mutationFn: async (file: File) => { await insertFile(owner, file.name, file.type || null, file, null); },
    onSettled: refresh,
  });
  // Trash and restore mark every version of the file, so the trash, the
  // days left and erasing follow the file as a whole.
  const mark = async (file: Attachment, deleted: boolean) => {
    const ids = versionChain(await rowsOf(owner), file.id).map((v) => v.id);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from('attachments')
      .update(deleted ? { deleted_at: new Date().toISOString(), deleted_by: auth.user?.id ?? null } : { deleted_at: null, deleted_by: null })
      .in('id', ids.length ? ids : [file.id]);
    if (error) throw error;
    // A file restored into a deleted folder brings the folder back.
    if (!deleted && file.folder_id) await supabase.from('folders').update({ deleted_at: null }).eq('id', file.folder_id).not('deleted_at', 'is', null);
  };
  const remove = useMutation({ mutationFn: (file: Attachment) => mark(file, true), onSettled: refresh });
  const restore = useMutation({ mutationFn: (file: Attachment) => mark(file, false), onSettled: () => { refresh(); void qc.invalidateQueries({ queryKey: ['folders'] }); } });
  /** Saves edits as the file's next version, under the same name: applied
   *  to whatever version is newest when saving. */
  const saveEdits = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: async ({ file, edits }: { file: Attachment; edits: OfficeEdit[] }): Promise<SavedEdits> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const head = versionChain(await rowsOf(owner), file.id)[0];
        if (!head || head.deleted_at) throw new Error(translate('This file was removed.'));
        const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(head.path);
        if (dlErr || !blob) throw dlErr ?? new Error('Could not read the file.');
        const result = await applyOfficeEdits(await blob.arrayBuffer(), edits);
        const bytes = new Blob([result.bytes as BlobPart], { type: head.mime_type || undefined });
        const saved = await insertFile(owner, head.name, head.mime_type, bytes, head);
        if (saved) return { file: saved, conflicts: result.conflicts.length, skipped: result.skipped.length, newer: head.id !== file.id };
      }
      throw new Error(translate('Someone else keeps saving this file. Try again in a moment.'));
    },
    onSettled: refresh,
  });
  /** Makes an earlier version the newest again, as a new version with its
   *  bytes (the versions after it stay in the history). */
  const restoreVersion = useMutation({
    mutationFn: async (version: Attachment): Promise<Attachment> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const head = versionChain(await rowsOf(owner), version.id)[0];
        if (!head || head.deleted_at) throw new Error(translate('This file was removed.'));
        if (head.id === version.id) return head;
        const { data: blob, error } = await supabase.storage.from(BUCKET).download(version.path);
        if (error || !blob) throw error ?? new Error('Could not read the file.');
        const saved = await insertFile(owner, head.name, head.mime_type, blob, head);
        if (saved) return saved;
      }
      throw new Error(translate('Someone else keeps saving this file. Try again in a moment.'));
    },
    onSettled: refresh,
  });
  return { upload, remove, restore, saveEdits, restoreVersion };
}

/** Puts a folder's file — every version of it — in another folder. */
export async function moveFileToFolder(file: Attachment, folderId: string): Promise<void> {
  if (!file.folder_id) throw new Error(translate('Only a file kept in a folder can move between folders.'));
  const ids = versionChain(await rowsOf({ kind: 'folder', id: file.folder_id }), file.id).map((v) => v.id);
  const { error } = await supabase.from('attachments').update({ folder_id: folderId }).in('id', ids.length ? ids : [file.id]);
  if (error) throw error;
  const qc = getQueryClient();
  void qc.invalidateQueries({ queryKey: ['attachments'] });
  void qc.invalidateQueries({ queryKey: ['attachments-of'] });
}

/** A short-lived signed link to a file, for previewing it in the page. */
async function signedUrl(file: Attachment, seconds = 300): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.path, seconds);
  if (error || !data?.signedUrl) throw error ?? new Error('Could not open the file.');
  return data.signedUrl;
}

/** Opens a file through a signed link that lasts a minute. The tab opens
 *  at once (inside the click, so no popup blocker stops it) and goes to the
 *  link when it arrives. */
async function openAttachment(file: Attachment): Promise<void> {
  const tab = window.open('', '_blank');
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.path, 60);
  if (error || !data?.signedUrl) { tab?.close(); throw error ?? new Error('Could not open the file.'); }
  if (tab) { tab.opener = null; tab.location.href = data.signedUrl; }
  else window.location.assign(data.signedUrl);
}

/** Saves a file to the person's computer under its own name, through a
 *  signed link that asks the browser to download rather than show it. */
async function downloadAttachment(file: Attachment): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.path, 60, { download: file.name });
  if (error || !data?.signedUrl) throw error ?? new Error('Could not download the file.');
  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Every listed (not trashed) file attached to these things of one kind —
 *  what a board's widget can pin. RLS leaves out what the viewer cannot see. */
export function useAttachmentsOf(kind: AttachmentOwnerKind, ids: string[]) {
  const key = [...ids].sort();
  const query = useQuery({
    queryKey: ['attachments-of', kind, key],
    enabled: key.length > 0,
    queryFn: async (): Promise<Attachment[]> => {
      const { data, error } = await supabase.from('attachments').select(COLUMNS)
        .in(OWNER_COLUMN[kind], key.slice(0, 500)).order('created_at', { ascending: false });
      if (error) throw error;
      return latestVersions((data ?? []) as Attachment[]).filter((f) => !f.deleted_at);
    },
  });
  return { data: query.data ?? EMPTY, loading: key.length > 0 && query.isPending };
}

/** A file in the Files app: its latest version, what it is attached to
 *  (by name) and how many versions it has. */
export interface SpaceFile extends Attachment {
  owner_label: string | null;
  /** For a file on an Element: the Object it is in, to open it there. */
  element_object_id: string | null;
  /** For a file on an Element: its quotable id (ELE_OBJ-017); null otherwise. */
  element_display_id: string | null;
  /** The Domain it sits in (through its Element, Object or folder); none for a Strategy's. */
  domain_id: string | null;
  versions: number;
}

/** Every file attached in a Space, as its latest version, newest first —
 *  or, `trashed`, those in the trash (within their days), most recently
 *  trashed first. RLS leaves out what the viewer cannot see. */
export function useSpaceAttachments(spaceId: string | null, trashed = false) {
  const query = useQuery({
    queryKey: ['attachments-of', 'space', spaceId, trashed],
    enabled: !!spaceId,
    queryFn: async (): Promise<SpaceFile[]> => {
      if (!spaceId) return [];
      const { data, error } = await supabase.rpc('space_attachments', { p_space: spaceId, p_trashed: trashed });
      if (error) throw error;
      return (data ?? []) as SpaceFile[];
    },
  });
  return { data: query.data ?? (EMPTY as SpaceFile[]), loading: !!spaceId && query.isPending };
}

/** One attached file by any of its versions' ids, as its latest version
 *  (null when gone, trashed or not visible). */
export async function latestVersionOf(fileId: string): Promise<Attachment | null> {
  const { data: one, error } = await supabase.from('attachments').select(COLUMNS).eq('id', fileId).maybeSingle();
  if (error) throw error;
  if (!one) return null;
  const latest = versionChain(await rowsOf(ownerOf(one as Attachment)), fileId)[0];
  return latest && !latest.deleted_at ? latest : null;
}

/** One attached file by id, as its latest version (null when gone, trashed
 *  or not visible) — a board pinned to a file shows it as last edited. */
export function useAttachment(fileId: string | null) {
  return useQuery({
    queryKey: ['attachment', fileId],
    enabled: !!fileId,
    queryFn: () => latestVersionOf(fileId!),
  });
}

/** Where an attached file's bytes come from, for the shared preview and
 *  for anything else that reads one (a widget's chart or value). */
export const attachmentSource = {
  signedUrl: (f: { id: string }) => signedUrl(f as Attachment),
  download: (f: { id: string }) => downloadAttachment(f as Attachment),
  open: (f: { id: string }) => openAttachment(f as Attachment),
};

// ── Finding a file by its words ─────────────────────────────────────────

/** How taking a file's words went, kept beside the words themselves:
 *  ok (words stored) · empty (read, and there are genuinely none — an
 *  image, a PDF with no text layer) · failed (could not be read; the
 *  backfill tries again) · too_large (over the size the indexing
 *  reads). Until the state was kept, a failure and a wordless file were
 *  the same '' and neither could be told apart or repaired. */
export type AttachmentTextStatus = 'ok' | 'empty' | 'failed' | 'too_large';

/** Pure. What a settled extraction means for the index: the words it
 *  found, or the empty state when it found none. A read that threw is
 *  the caller's 'failed', not this function's — it maps only a read
 *  that finished. */
export function textOutcomeOf(text: string | null): { body: string; status: AttachmentTextStatus } {
  return text ? { body: text, status: 'ok' } : { body: '', status: 'empty' };
}

/** Pure. The one quiet line said about a file whose words are not
 *  searchable (null: nothing to say — its words are in, or its state is
 *  not known yet). A file with no row yet and one whose read failed say
 *  the same thing: the backfill is still to reach it, or to try again. */
export function textSearchCaptionOf(status: AttachmentTextStatus | null | undefined): string | null {
  switch (status) {
    case 'ok': return null;
    case 'empty': return 'No readable text in this file';
    case 'too_large': return 'Too large to search its contents';
    case undefined: return null;
    default: return 'Contents are not searchable yet';
  }
}

/** A file's text state (undefined while it loads; null when no row
 *  exists yet), for the pane's one quiet line about it. */
export function useAttachmentTextStatus(fileId: string | null): AttachmentTextStatus | null | undefined {
  const query = useQuery({
    queryKey: ['attachment-text-status', fileId],
    enabled: !!fileId,
    queryFn: async (): Promise<AttachmentTextStatus | null> => {
      const { data } = await supabase.from('attachment_texts').select('status').eq('attachment_id', fileId!).maybeSingle();
      return ((data as { status: AttachmentTextStatus } | null)?.status) ?? null;
    },
  });
  return query.data;
}

/** Takes a version's text out and stores it, with how the taking went
 *  (an empty state when there is none to read, a failed one when it
 *  could not be read — the backfill tries the failed again). Best
 *  effort. */
async function indexText(file: Pick<Attachment, 'id' | 'name' | 'mime_type'>, bytes: Blob): Promise<void> {
  try {
    const outcome = textOutcomeOf(await fileText(await bytes.arrayBuffer(), file.name, file.mime_type));
    await supabase.from('attachment_texts').upsert({ attachment_id: file.id, body: outcome.body, status: outcome.status, extracted_at: new Date().toISOString() });
  } catch {
    // An unreadable file (damaged, password-protected) is a failure, not
    // a file with no words: the state says so, and the backfill retries it.
    await supabase.from('attachment_texts').upsert({ attachment_id: file.id, body: '', status: 'failed' });
  }
}

const INDEX_MAX_BYTES = 20 * 1024 * 1024;
const indexing = new Set<string>();

/** Reads, in the background, the text of a Space's files that have none
 *  yet (attached before their words were kept) or whose read failed, a
 *  few at a time. A file over the size the indexing reads is recorded
 *  too_large instead — stated, and not tried again. */
export async function indexSpaceFiles(spaceId: string): Promise<void> {
  if (indexing.has(spaceId)) return;
  indexing.add(spaceId);
  try {
    const { data } = await supabase.rpc('attachments_to_index', { p_space: spaceId, p_limit: 20 });
    for (const f of (data ?? []) as { id: string; path: string; name: string; mime_type: string | null; size: number }[]) {
      if (f.size > INDEX_MAX_BYTES) { await supabase.from('attachment_texts').upsert({ attachment_id: f.id, body: '', status: 'too_large' }); continue; }
      const { data: blob } = await supabase.storage.from(BUCKET).download(f.path);
      if (blob) await indexText(f, blob);
    }
  } finally {
    indexing.delete(spaceId);
  }
}

/** A file found by its name, what it is attached to, or its words. */
export interface FoundFile extends Pick<Attachment, 'id' | 'name' | 'mime_type' | 'element_id' | 'object_id' | 'strategy_id' | 'folder_id'> {
  owner_label: string | null;
  element_object_id: string | null;
  /** For a file on an Element: its quotable id (ELE_OBJ-017); null otherwise. */
  element_display_id: string | null;
  /** The Domain it sits in (none for a Strategy's). */
  domain_id: string | null;
  /** The words around where the text matched (null when the name did). */
  snippet: string | null;
}

/** Files in a Space whose name, owner or text holds `query`. */
export async function searchAttachments(spaceId: string, query: string, limit = 8): Promise<FoundFile[]> {
  const { data, error } = await supabase.rpc('search_attachments', { p_space: spaceId, p_query: query.normalize('NFKC'), p_limit: limit });
  if (error) return [];
  return (data ?? []) as FoundFile[];
}

/** A file's text, to hand to the AI: the stored text, or — for a file not
 *  read yet — read now (and stored). */
export async function attachmentText(file: Pick<Attachment, 'id' | 'name' | 'mime_type' | 'path'>): Promise<string> {
  const { data } = await supabase.from('attachment_texts').select('body').eq('attachment_id', file.id).maybeSingle();
  const stored = (data as { body: string } | null)?.body;
  if (stored) return stored;
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(file.path);
  if (error || !blob) throw error ?? new Error('Could not read the file.');
  const outcome = textOutcomeOf(await fileText(await blob.arrayBuffer(), file.name, file.mime_type));
  void supabase.from('attachment_texts').upsert({ attachment_id: file.id, body: outcome.body, status: outcome.status });
  return outcome.body;
}
