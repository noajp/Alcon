// Where the Files app is in a window tab, as Execution's sidebar has it:
// the Space's home, its folders (or one folder), every file, or the trash —
// and the file open beside a list. The sidebar and the pages read and write
// the same route.

export interface FilesRoute {
  /** The page; a folder's page when `folderId` is set. Home when unset. */
  view?: 'home' | 'folders' | 'files' | 'trash';
  /** One folder: what is in it. */
  folderId?: string | null;
  /** The file open beside the list. */
  fileId?: string | null;
}
