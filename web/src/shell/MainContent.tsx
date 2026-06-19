'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { NavigationState } from '@/types/navigation';
import type { ExplorerData } from '@/hooks/useSupabase';
import {
  createElement as createElementRow,
  createObject as createObjectRow,
  moveObject,
} from '@/hooks/useSupabase';
import { useNotes, useNoteContent } from '@/hooks/useNotesDb';
import { FilesPane } from '@/alcon/brief/FilesPane';
import {
  resolveFolderSelection,
  filesInFolder,
  folderDisplayName,
} from '@/alcon/brief/noteTree';

import { ElementsListView } from '@/alcon/element/actions/ElementsListView';
import { MyElementsView } from '@/alcon/element/actions/MyElementsView';

// Lazy-loaded views — the landing view is 'projects' (DomainView), and the
// core list views (DomainView / ElementsListView / MyElementsView) stay
// eager. Everything else is split into its own chunk and fetched only when
// the user actually opens that activity, so the first paint ships less JS.
// These views also pull the heaviest leaf deps (note editor, DAG/charts,
// realtime chat), which is exactly what we don't want in the entry bundle.
const viewLoading = () => (
  <div className="flex-1 flex items-center justify-center bg-card text-[13px] text-muted-foreground">
    Loading…
  </div>
);
const NotesView = dynamic(() => import('@/alcon/element/actions/NotesView').then(m => m.NotesView), { ssr: false, loading: viewLoading });
const ActionsView = dynamic(() => import('@/alcon/element/actions/ActionsView').then(m => m.ActionsView), { ssr: false, loading: viewLoading });
const InboxView = dynamic(() => import('@/alcon/element/actions/InboxView').then(m => m.InboxView), { ssr: false, loading: viewLoading });
const StrategyShell = dynamic(() => import('@/alcon/element/actions/StrategyShell').then(m => m.StrategyShell), { ssr: false, loading: viewLoading });
const RoomView = dynamic(() => import('@/alcon/room/RoomView').then(m => m.RoomView), { ssr: false, loading: viewLoading });
const ChatView = dynamic(() => import('@/alcon/chat/ChatView').then(m => m.ChatView), { ssr: false, loading: viewLoading });
import {
  PageView,
  BriefsEmptyState,
  ObjectDraftDialog,
} from '@/alcon/brief';
import { summarizeNoteContent } from '@/alcon/brief/aiSummary';
import { draftObjectFromBrief, type ObjectDraft, type ObjectDraftElement } from '@/alcon/brief/objectDraft';
import type { Brief } from '@/types/notes';

import { DomainView } from '@/alcon/object/DomainView'; // eager — default landing view
const DomainsView = dynamic(() => import('@/alcon/domain/DomainsView').then(m => m.DomainsView), { ssr: false, loading: viewLoading });
const ReferenceView = dynamic(() => import('@/alcon/reference/ReferenceView').then(m => m.ReferenceView), { ssr: false, loading: viewLoading });
const TableView = dynamic(() => import('@/alcon/table').then(m => m.TableView), { ssr: false, loading: viewLoading });
const SettingsView = dynamic(() => import('@/alcon/settings/SettingsView').then(m => m.SettingsView), { ssr: false, loading: viewLoading });
import { IslandCard } from '@/shell/IslandCard';
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';

export { IslandCard };

interface MainContentProps {
  activeActivity: string;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
  explorerData: ExplorerData;
  onRefresh?: () => void;
  pendingNewNote?: number;
  onNewNoteHandled?: () => void;
  activeDomainId?: string | null;
}

export function MainContent({ activeActivity, navigation, onNavigate, onViewChange, explorerData, onRefresh, pendingNewNote, onNewNoteHandled, activeDomainId }: MainContentProps) {
  const { nodes, createNode, deleteNode, renameNode, setLinkedObject } = useNotes();
  // Note selection lives in navigation state so the sidebar (Cabinet/Folder,
  // in AppSidebar), the middle FilesPane, and the PageView here all stay in
  // lock-step without a separate local store.
  const selectedFileId = navigation.noteId ?? null;
  const setSelectedFileId = (id: string | null) => onNavigate({ noteId: id });
  // OneNote 3-pane resolution: pick the active Folder (middle-pane source),
  // then the active File within it. The Folder wins from an explicit sidebar
  // click, else is derived from the open file, else the first folder.
  const resolvedFolderId = resolveFolderSelection(nodes, navigation.noteFolderId ?? null, selectedFileId);
  const folderFiles = useMemo(
    () => filesInFolder(nodes, resolvedFolderId),
    [nodes, resolvedFolderId],
  );
  const resolvedFileId = (selectedFileId && folderFiles.some((f) => f.id === selectedFileId))
    ? selectedFileId
    : (folderFiles[0]?.id ?? null);
  const { html, loading: contentLoading, save: saveContent } = useNoteContent(resolvedFileId);

  // Create a new File under the focused Folder, then select it. Wired to the
  // FilesPane "+" (disabled when no folder is focused).
  const handleAddFile = async () => {
    if (!resolvedFolderId) return;
    try {
      const node = await createNode('file', 'Untitled', resolvedFolderId);
      setSelectedFileId(node.id);
    } catch (e) { console.error('Failed to create note file', e); }
  };
  const handleDeleteFile = async (id: string) => {
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
        const node = await createNode('file', 'Untitled', null);
        setSelectedFileId(node.id);
      } catch (e) {
        console.error('Failed to create note:', e);
      } finally {
        onNewNoteHandled?.();
      }
    })();
  }, [pendingNewNote, createNode, onNewNoteHandled]);

  const selectedFile = resolvedFileId
    ? nodes.find((n) => n.id === resolvedFileId && n.type === 'file') ?? null
    : null;

  const handleTitleChange = async (newTitle: string) => {
    if (!selectedFile) return;
    try { await renameNode(selectedFile.id, newTitle); } catch (e) { console.error(e); }
  };

  // Create + delete handlers moved to NoteSidebarPanel (AppSidebar) since
  // that's where the NotesSidebar tree now lives.

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
      setObjectizing({ phase: 'error', message: (err as Error).message || 'Failed to objectize note' });
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
    onViewChange?.('projects');
  };

  return (
    <div className="flex-1 flex flex-col bg-card overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
          {activeActivity === 'note' && (
            <div className="flex-1 flex overflow-hidden bg-card">
              {/* OneNote-style middle pane: the focused Folder's file list.
                  The Cabinet/Folder tree itself lives in AppSidebar (left
                  rail); the editor is the wide pane on the right. */}
              <FilesPane
                folderName={folderDisplayName(nodes, resolvedFolderId)}
                files={folderFiles}
                selectedFileId={resolvedFileId}
                onSelectFile={setSelectedFileId}
                onAddFile={handleAddFile}
                onDeleteFile={handleDeleteFile}
              />
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
                  explorerData={explorerData}
                />
              ) : (
                <BriefsEmptyState />
              )}
              <Dialog
                open={objectizing?.phase === 'error'}
                onOpenChange={(o) => { if (!o) setObjectizing(null); }}
              >
                <DialogContent className="max-w-sm text-center">
                  <DialogTitle className="text-[12px] text-destructive">Obj化に失敗しました</DialogTitle>
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
          )}

          {activeActivity === 'room' && (
            <RoomView
              domainId={activeDomainId ?? null}
              selectedChannelId={navigation.roomChannelId ?? null}
              onSelectChannel={(id) => onNavigate({ roomChannelId: id })}
              hideSidebar
            />
          )}

          {activeActivity === 'chat' && (
            <ChatView
              selectedConversationId={navigation.chatConversationId ?? null}
              onSelectConversation={(id) => onNavigate({ chatConversationId: id })}
            />
          )}

          {activeActivity === 'home' && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-[13px] bg-card">
              Home — coming soon
            </div>
          )}

          {activeActivity === 'inbox' && (
            <div className="flex-1 overflow-hidden bg-card">
              <InboxView onNavigate={onNavigate} onViewChange={onViewChange} />
            </div>
          )}

          {activeActivity === 'strategy' && (
            <div className="flex-1 overflow-hidden bg-card">
              <StrategyShell />
            </div>
          )}

          {activeActivity === 'domains' && (
            <div className="flex-1 overflow-auto bg-card">
              <DomainsView explorerData={explorerData} onOpen={() => onViewChange?.('projects')} />
            </div>
          )}

          {activeActivity === 'mytasks' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <ElementsListView
                explorerData={explorerData}
                onRefresh={onRefresh}
                activeDomainId={activeDomainId}
                onNavigate={onNavigate}
                onViewChange={onViewChange}
              />
            </div>
          )}

          {activeActivity === 'my-elements' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <MyElementsView
                onRefresh={onRefresh}
                onNavigate={onNavigate}
                onViewChange={onViewChange}
              />
            </div>
          )}

          {activeActivity === 'projects' && (
            <DomainView
              explorerData={explorerData}
              navigation={navigation}
              onNavigate={onNavigate}
              onRefresh={onRefresh}
              activeDomainId={activeDomainId}
            />
          )}

          {activeActivity === 'notes' && (
            <div className="flex-1 overflow-auto bg-card">
              <NotesView navigation={navigation} onNavigate={onNavigate} />
            </div>
          )}

          {activeActivity === 'actions' && (
            <div className="flex-1 overflow-auto bg-card">
              <ActionsView navigation={navigation} onNavigate={onNavigate} />
            </div>
          )}

          {activeActivity === 'tables' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <TableView />
            </div>
          )}

          {activeActivity === 'reference' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <ReferenceView />
            </div>
          )}

          {activeActivity === 'settings' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <SettingsView />
            </div>
          )}
      </div>
    </div>
  );
}

// Cheap djb2-style hash so the objectize cache can detect note edits without
// keeping the whole HTML body around as a cache key.
function quickHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}
