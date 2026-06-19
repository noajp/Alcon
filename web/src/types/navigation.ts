export interface NavigationState {
  objectId: string | null;
  noteId?: string | null;
  /** Note Folder currently focused in the middle pane. Holds a folder id, or
   *  the synthetic string `unfiled:<cabinetId>` to mean "files parked
   *  directly under that cabinet with no folder". */
  noteFolderId?: string | null;
  documentId?: string | null;
  canvasId?: string | null;
  roomChannelId?: string | null;
  chatConversationId?: string | null;
}
