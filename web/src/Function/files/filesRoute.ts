// Where Artifacts is in a window tab: which tab (and its Domain or Object),
// a folder of its tree (the top without one), or the trash — and the file
// open beside the list.

export interface FilesRoute {
  /** The trash; otherwise the folder tree. */
  view?: 'trash';
  /** Whose artifacts: the Space's (the default), a Domain's, an Object's, or yours. */
  tab?: 'space' | 'domain' | 'object' | 'my';
  /** The Domain open in the Domain tab. */
  domainId?: string | null;
  /** The Object open in the Objects tab. */
  objectId?: string | null;
  /** The open folder; the top of the tree without one. */
  folderId?: string | null;
  /** The file open beside the list. */
  fileId?: string | null;
}
