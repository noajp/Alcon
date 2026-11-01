'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';
import { applyOfficeEdits, type OfficeEdit } from '@/Function/office/officeEdits';
import { latestVersions, versionChain } from '@/Function/shared/fileVersions';

// Files attached to one thing in the Space — an Element, an Object, an
// Initiative, a Portfolio, a CRM deal or company — from the person's
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
export type AttachmentOwnerKind = 'element' | 'object' | 'strategy' | 'portfolio' | 'deal' | 'company';
export interface AttachmentOwner { kind: AttachmentOwnerKind; id: string }
/** Pure. What a board's subject attaches files as (null: it cannot hold files). */
export function attachmentOwnerOf(subject: { kind: string; id: string | null }): AttachmentOwner | null {
  const kind = ({ element: 'element', object: 'object', initiative: 'strategy' } as Record<string, AttachmentOwnerKind>)[subject.kind];
  return kind && subject.id ? { kind, id: subject.id } : null;
}
const OWNER_COLUMN: Record<AttachmentOwnerKind, string> = {
  element: 'element_id', object: 'object_id', strategy: 'strategy_id', portfolio: 'portfolio_id', deal: 'deal_id', company: 'company_id',
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
  portfolio_id: string | null;
  deal_id: string | null;
  company_id: string | null;
}

const COLUMNS = 'id, path, name, size, mime_type, uploaded_by, created_at, deleted_at, previous_id, element_id, object_id, strategy_id, portfolio_id, deal_id, company_id';
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
  const { data, error } = await supabase.from('attachments').insert({
    [OWNER_COLUMN[owner.kind]]: owner.id, path, name, size: bytes.size, mime_type: mime, previous_id: previous?.id ?? null,
  }).select(COLUMNS).single();
  if (!error && data) return data as Attachment;
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
  };
  const remove = useMutation({ mutationFn: (file: Attachment) => mark(file, true), onSettled: refresh });
  const restore = useMutation({ mutationFn: (file: Attachment) => mark(file, false), onSettled: refresh });
  /** Saves edits as the file's next version, under the same name: applied
   *  to whatever version is newest when saving. */
  const saveEdits = useMutation({
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
  versions: number;
}

/** Every file attached in a Space, as its latest version (not trashed),
 *  newest first. RLS leaves out what the viewer cannot see. */
export function useSpaceAttachments(spaceId: string | null) {
  const query = useQuery({
    queryKey: ['attachments-of', 'space', spaceId],
    enabled: !!spaceId,
    queryFn: async (): Promise<SpaceFile[]> => {
      const { data, error } = await supabase.rpc('space_attachments', { p_space: spaceId });
      if (error) throw error;
      return (data ?? []) as SpaceFile[];
    },
  });
  return { data: query.data ?? (EMPTY as SpaceFile[]), loading: !!spaceId && query.isPending };
}

/** One attached file by id, as its latest version (null when gone, trashed
 *  or not visible) — a board pinned to a file shows it as last edited. */
export function useAttachment(fileId: string | null) {
  return useQuery({
    queryKey: ['attachment', fileId],
    enabled: !!fileId,
    queryFn: async (): Promise<Attachment | null> => {
      const { data: one, error } = await supabase.from('attachments').select(COLUMNS).eq('id', fileId!).maybeSingle();
      if (error) throw error;
      if (!one) return null;
      const latest = versionChain(await rowsOf(ownerOf(one as Attachment)), fileId!)[0];
      return latest && !latest.deleted_at ? latest : null;
    },
  });
}

/** Where an attached file's bytes come from, for the shared preview and
 *  for anything else that reads one (a widget's chart or value). */
export const attachmentSource = {
  signedUrl: (f: { id: string }) => signedUrl(f as Attachment),
  download: (f: { id: string }) => downloadAttachment(f as Attachment),
  open: (f: { id: string }) => openAttachment(f as Attachment),
};
