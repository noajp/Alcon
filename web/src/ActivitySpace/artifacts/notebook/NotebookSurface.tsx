'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigationState } from '@/types/navigation';
import {
  createElement as createElementRow,
  createObject as createObjectRow,
  moveObject,
} from '@/hooks/useSupabase';
import { useNotes, useNoteContent } from '@/hooks/useNotesDb';
import { FilesPane } from '@/ActivitySpace/artifacts/notebook/FilesPane';
import { NotebookBreadcrumb } from '@/ActivitySpace/artifacts/notebook/NotebookBreadcrumb';
import { appDialog } from '@/Function/shared/appDialogStore';
import { NoteContentStatus } from '@/ActivitySpace/artifacts/notebook/NoteContentStatus';
import {
  resolveFolderSelection,
  resolveSectionSelection,
  sectionsInFolder,
  filesInFolder,
  folderDisplayName,
} from '@/ActivitySpace/artifacts/notebook/noteTree';
import { NotebookList } from './NotebookList';

import { PageView } from '@/ActivitySpace/artifacts/notebook/PageView';
import { ObjectDraftDialog } from '@/ActivitySpace/artifacts/notebook/ObjectDraftDialog';
import { summarizeNoteContent } from '@/hooks/noteSummary';
import { draftObjectFromBrief, type ObjectDraft, type ObjectDraftElement } from '@/hooks/objectDraft';
import type { Brief } from '@/types/notes';

import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';
import { useI18n } from '@/Function/i18n/I18nProvider';
interface NotebookSurfaceProps {
  visible: boolean;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
  onRefresh?: () => void;
  pendingNewNote?: number;
  onNewNoteHandled?: () => void;
  activeDomainId?: string | null;
}

// Keep per-tab notebook state and draft cache across activity switches.
export function NotebookSurface({ visible, navigation, onNavigate, onViewChange, onRefresh, pendingNewNote, onNewNoteHandled, activeDomainId }: NotebookSurfaceProps) {
  const { t } = useI18n();
  const { nodes, createNode, deleteNode, renameNode, setLinkedObject } = useNotes();
  // Note selection lives in navigation state so the Folder sidebar (in
  // AppSidebar), the middle FilesPane, and the PageView here all stay in
  // lock-step without a separate local store.
  const selectedFileId = navigation.noteId ?? null;
  const setSelectedFileId = useCallback((id: string | null) => onNavigate({ noteId: id }), [onNavigate]);
  // Note landing state — no explicit Folder or File selected yet. The notebook
  // list lives in the sidebar; this pane shows a placeholder until one's picked.
  const noteGridMode = !navigation.noteFolderId && !selectedFileId;
  // OneNote resolution: active Folder (sidebar / grid) → active Section (the
  // tab strip along the top of this surface) → active File. The Folder wins
  // from an explicit click, else is derived from the open file, else the
  // first folder.
  const resolvedFolderId = resolveFolderSelection(nodes, navigation.noteFolderId ?? null, selectedFileId);
  const folderSections = useMemo(
    () => sectionsInFolder(nodes, resolvedFolderId),
    [nodes, resolvedFolderId],
  );
  // The Section comes from the sidebar's tree (navigation.noteSectionId).
  // A page opened from outside the notebook (Profile's My Notes, a
  // notification, ⌘K) arrives with only its id, and the page wins over any
  // earlier pick so the list shows where it actually lives.
  const openFile = selectedFileId ? nodes.find((n) => n.id === selectedFileId) : undefined;
  const fileSectionId = openFile && folderSections.some((s) => s.id === openFile.parentId) ? openFile.parentId! : null;
  const resolvedSectionId = resolveSectionSelection(nodes, resolvedFolderId, fileSectionId ?? navigation.noteSectionId ?? null, selectedFileId);
  // Where the file list (and new files) hang: the active Section, or the
  // folder itself while it has no Sections yet.
  const filesParentId = resolvedSectionId ?? resolvedFolderId;
  const folderFiles = useMemo(
    () => filesInFolder(nodes, filesParentId),
    [nodes, filesParentId],
  );
  const activeSectionName = folderSections.find((s) => s.id === resolvedSectionId)?.name ?? null;
  const resolvedFileId = (selectedFileId && folderFiles.some((f) => f.id === selectedFileId))
    ? selectedFileId
    : (folderFiles[0]?.id ?? null);
  const { html, loading: contentLoading, saving: contentSaving, error: contentError, errorKind, retry: retryContent, save: saveContent } = useNoteContent(resolvedFileId);
  // Collapse the middle file-list pane to widen the editor (toggled from the
  // PageView header).
  const [filesPaneOpen, setFilesPaneOpen] = useState(true);

  // Create a new File under the active Section (or the Folder while
  // sectionless), then select it — the breadcrumb "+" and the pane's
  // "New page" row.
  const handleAddFile = async () => {
    if (!filesParentId) return;
    try {
      const node = await createNode('file', t('Untitled'), filesParentId);
      setSelectedFileId(node.id);
    } catch (e) { console.error('Failed to create note file', e); }
  };
  const handleRenameNode = async (id: string, name: string) => {
    try { await renameNode(id, name); } catch (e) { console.error('Failed to rename note', e); }
  };
  const handleDeleteFile = async (id: string) => {
    const file = nodes.find((n) => n.id === id);
    if (!await appDialog.confirm(t('Delete the page "{name}"? This cannot be undone.', { name: file?.name || t('Untitled') }))) return;
    try {
      await deleteNode(id);
      if (selectedFileId === id) setSelectedFileId(null);
    } catch (e) { console.error('Failed to delete note file', e); }
  };
  // Note → Obj化 session cache. Key is the note's id; entry is only reused
  // when the note body's hash matches, so editing the note re-triggers AI.
  // Cleared when the page unloads — that's what the user wants (skip the
  // re-spend of tokens within a session, accept the cost on the next visit).
  const [objectizeCache, setObjectizeCache] = useState<Record<string, { hash: string; brief: Brief; draft: ObjectDraft }>>({});
  const [objectizing, setObjectizing] = useState<
    | { phase: 'loading' }
    | { phase: 'ready'; brief: Brief; initialDraft: ObjectDraft }
    | { phase: 'error'; message: string }
    | null
  >(null);

  const handledNewNoteRef = useRef(0);
  useEffect(() => {
    if (!pendingNewNote || handledNewNoteRef.current === pendingNewNote) return;
    handledNewNoteRef.current = pendingNewNote;
    (async () => {
      try {
        const node = await createNode('file', t('Untitled'), null);
        setSelectedFileId(node.id);
      } catch (e) {
        console.error('Failed to create note:', e);
      } finally {
        onNewNoteHandled?.();
      }
    })();
  }, [pendingNewNote, createNode, onNewNoteHandled, setSelectedFileId, t]);

  const selectedFile = resolvedFileId
    ? nodes.find((n) => n.id === resolvedFileId && n.type === 'file') ?? null
    : null;

  const handleTitleChange = async (newTitle: string) => {
    if (!selectedFile) return;
    try { await renameNode(selectedFile.id, newTitle); } catch (e) { console.error(e); }
  };

  const handleObjectize = async () => {
    if (!selectedFile) return;
    const hash = quickHash(html);
    const cached = objectizeCache[selectedFile.id];
    if (cached && cached.hash === hash) {
      setObjectizing({ phase: 'ready', brief: cached.brief, initialDraft: cached.draft });
      return;
    }
    setObjectizing({ phase: 'loading' });
    try {
      const { structured } = await summarizeNoteContent({ title: selectedFile.name, content: html });
      const tempBrief: Brief = {
        id: `mem-${selectedFile.id}`,
        sourceFileId: selectedFile.id,
        sourceFileName: selectedFile.name,
        title: selectedFile.name,
        summary: structured.summary ?? '',
        structured,
        sourceSnapshot: html,
        createdBy: '',
        createdAt: new Date().toISOString(),
      };
      const draft = await draftObjectFromBrief(tempBrief);
      setObjectizeCache((prev) => ({ ...prev, [selectedFile.id]: { hash, brief: tempBrief, draft } }));
      setObjectizing({ phase: 'ready', brief: tempBrief, initialDraft: draft });
    } catch (err) {
      console.error('[objectize] failed', err);
      setObjectizing({ phase: 'error', message: (err as Error).message || t('Could not turn this Note into an Object.') });
    }
  };

  const handleCreateObjectFromBrief = async (input: {
    name: string;
    description?: string;
    color?: string;
    domainId: string | null;
    elements: ObjectDraftElement[];
  }) => {
    const created = await createObjectRow({ name: input.name, description: input.description, color: input.color, domain_id: input.domainId ?? activeDomainId ?? null });
    try { await moveObject(created.id, null, 0); } catch (err) { console.error('Failed to move Object to top', err); }
    for (const el of input.elements) {
      try {
        await createElementRow({ title: el.title, object_id: created.id, description: el.description, priority: el.priority ?? 'medium' });
      } catch (err) { console.error('Failed to create Element', el.title, err); }
    }
    onRefresh?.();
    setObjectizing(null);
    onNavigate({ objectId: created.id });
    onViewChange?.('objects');
  };


  if (!visible) return null;

  return (
            noteGridMode ? (
            /* No notebook chosen yet: Note opens on the list of them. */
            <NotebookList
              onOpenBook={(folderId) => onNavigate({ noteFolderId: folderId, noteSectionId: null, noteId: null })}
              onOpenPage={(page) => onNavigate({ noteId: page.id })}
            />
            ) : (
            <div className="relative flex-1 flex flex-col overflow-hidden bg-card">
            {/* Breadcrumb — the open Notebook's name. Books and Sections are
                the sidebar's tree; pages are added from the list's "New page". */}
            {resolvedFolderId && (
              <NotebookBreadcrumb
                folderName={folderDisplayName(nodes, resolvedFolderId)}
                onBack={() => onNavigate({ noteFolderId: null, noteSectionId: null, noteId: null })}
              />
            )}
            <div className="flex-1 flex overflow-hidden bg-card">
              {/* Middle pane: the active Section's file list. The Folder tree
                  itself lives in AppSidebar (left rail); the editor is the wide
                  pane on the right. */}
              {filesPaneOpen && (
                <FilesPane
                  title={activeSectionName ?? folderDisplayName(nodes, resolvedFolderId)}
                  files={folderFiles}
                  selectedFileId={resolvedFileId}
                  onSelectFile={(id) => {
                    setSelectedFileId(id);
                    // Phones can't fit the list + editor side by side, so the
                    // two panes are mutually exclusive there: opening a file
                    // collapses the list to hand the editor the full width.
                    if (typeof window !== 'undefined' && window.innerWidth < 640) {
                      setFilesPaneOpen(false);
                    }
                  }}
                  onAddFile={() => void handleAddFile()}
                  onRenameNode={(id, name) => void handleRenameNode(id, name)}
                  onDeleteFile={(id) => void handleDeleteFile(id)}
                />
              )}
              {/* When the list is open on a phone it owns the whole row; hide
                  the editor pane (it reappears once a file is chosen). On ≥sm
                  both always show side by side. */}
              <div className={`relative flex-1 min-w-0 flex flex-col overflow-hidden ${filesPaneOpen ? 'hidden sm:flex' : 'flex'}`}>
              {selectedFile && (
                <NoteContentStatus quiet loading={contentLoading} saving={contentSaving} error={contentError} errorKind={errorKind} onRetry={retryContent} />
              )}
              {selectedFile && !contentLoading ? (
                <PageView
                  key={selectedFile.id}
                  fileId={selectedFile.id}
                  title={selectedFile.name}
                  icon={selectedFile.icon}
                  content={html}
                  linkedObjectId={selectedFile.linkedObjectId ?? null}
                  onLinkedObjectChange={(objectId) => setLinkedObject(selectedFile.id, objectId)}
                  onTitleChange={handleTitleChange}
                  onContentChange={saveContent}
                  onObjectize={handleObjectize}
                  objectizing={objectizing?.phase === 'loading'}
                  activeDomainId={activeDomainId}
                  onElementsCreated={() => onRefresh?.()}
                  filesPaneOpen={filesPaneOpen}
                  onToggleFilesPane={() => setFilesPaneOpen((v) => !v)}
                />
              ) : selectedFile ? (
                !contentError && <div role="status" className="flex-1 flex items-center justify-center text-sm text-muted-foreground">{t('Loading Note…')}</div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-center px-8 py-12">
                  <p className="text-[13px] text-muted-foreground">{t('Select a page to start writing.')}</p>
                </div>
              )}
              </div>
              <Dialog
                open={objectizing?.phase === 'error'}
                onOpenChange={(o) => { if (!o) setObjectizing(null); }}
              >
                <DialogContent className="max-w-sm text-center">
                  <DialogTitle className="text-[12px] text-destructive">{t('Could not turn this Note into an Object.')}</DialogTitle>
                  <div className="text-[11px] text-muted-foreground break-words">
                    {objectizing?.phase === 'error' ? objectizing.message : ''}
                  </div>
                </DialogContent>
              </Dialog>
              {objectizing?.phase === 'ready' && selectedFile && (
                <ObjectDraftDialog
                  brief={objectizing.brief}
                  initialDraft={objectizing.initialDraft}
                  defaultDomainId={activeDomainId}
                  onDraftReady={(draft) => {
                    setObjectizeCache((prev) => {
                      const noteId = objectizing.brief.sourceFileId;
                      const existing = prev[noteId];
                      const hash = existing?.hash ?? quickHash(html);
                      return { ...prev, [noteId]: { hash, brief: objectizing.brief, draft } };
                    });
                  }}
                  onClose={() => setObjectizing(null)}
                  onCreate={handleCreateObjectFromBrief}
                />
              )}
            </div>
            </div>
            )
  );
}

// Cheap djb2-style hash so the objectize cache can detect note edits without
// keeping the whole HTML body around as a cache key.
function quickHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}
