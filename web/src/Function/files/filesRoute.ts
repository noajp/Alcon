// Where Artifacts is in a window tab: a folder of the tree (the top without
// one), or the trash — and the file open beside the list.

export interface FilesRoute {
  /** The trash; otherwise the folder tree. */
  view?: 'trash';
  /** The open folder; the top of the tree without one. */
  folderId?: string | null;
  /** The file open beside the list. */
  fileId?: string | null;
}
