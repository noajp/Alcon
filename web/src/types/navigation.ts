export interface NavigationState {
  objectId: string | null;
  noteId?: string | null;
  /** Note Folder currently focused in the middle pane (a root folder id). */
  noteFolderId?: string | null;
  /** What the Home main island is showing, when on the Home view. A pinned
   *  item's content renders in place (no layer/view switch) instead of the
   *  welcome. null = the welcome landing. */
  homeSelection?: { type: 'note_folder' | 'domain'; id: string } | null;
  documentId?: string | null;
  canvasId?: string | null;
  roomChannelId?: string | null;
  chatConversationId?: string | null;
}
