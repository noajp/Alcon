// Where the Files app is in a window tab, as Execution's sidebar has it:
// every file in the Space; or a Domain — its home, its folders (or one
// folder), its files; or the trash — and the file open beside a list. The
// sidebar and the pages read and write the same route.

export interface FilesRoute {
  /** A Domain's pages; without it, every file in the Space (or the trash). */
  domainId?: string | null;
  /** The page: a Domain's home (the default), its folders or its files; the trash. */
  view?: 'home' | 'folders' | 'files' | 'trash';
  /** One folder: what is in it. */
  folderId?: string | null;
  /** The file open beside the list. */
  fileId?: string | null;
}
