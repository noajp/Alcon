import type { AttachmentOwnerKind } from '@/hooks/attachmentData';

// Where the Files app is in a window tab: which files it lists (a folder,
// or what they are attached to), which one is open beside the list, or the
// trash. The sidebar and the list read and write the same route.

export interface FilesRoute {
  /** One folder: what is in it. */
  folderId?: string | null;
  /** Only files attached to this kind of thing. */
  where?: AttachmentOwnerKind | null;
  /** The file open beside the list. */
  fileId?: string | null;
  /** The trash instead of the files: what was removed, to restore. */
  trash?: boolean;
}
