import type { AttachmentOwnerKind } from '@/hooks/attachmentData';

// Where the Files app is in a window tab: which files it lists (by what
// they are attached to, or by their kind) and which one is open beside the
// list. The sidebar and the list read and write the same route.

/** What a file is, as Files groups it. */
export type FileKind = 'doc' | 'sheet' | 'deck' | 'pdf' | 'image' | 'other';

export interface FilesRoute {
  /** Only files attached to this kind of thing. */
  where?: AttachmentOwnerKind | null;
  /** Only files of this kind. */
  kind?: FileKind | null;
  /** The file open beside the list. */
  fileId?: string | null;
  /** The trash instead of the files: what was removed, to restore. */
  trash?: boolean;
}

/** Pure. A file's kind, from its name and type. */
export function fileKindOf(name: string, mime: string | null): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['docx', 'doc', 'odt', 'rtf', 'txt', 'md'].includes(ext)) return 'doc';
  if (['xlsx', 'xls', 'csv', 'ods', 'tsv'].includes(ext)) return 'sheet';
  if (['pptx', 'ppt', 'odp', 'key'].includes(ext)) return 'deck';
  if (ext === 'pdf') return 'pdf';
  if (mime?.startsWith('image/')) return 'image';
  return 'other';
}
