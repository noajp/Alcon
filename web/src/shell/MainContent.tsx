'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { NavigationState } from '@/types/navigation';
import type { ExplorerData } from '@/hooks/useSupabase';
import {
  createElement as createElementRow,
  createObject as createObjectRow,
  moveObject,
} from '@/hooks/useSupabase';
import { useNotes, useNoteContent, useDefaultFileId } from '@/hooks/useNotesDb';

import { NotesView, ActionsView, InboxView, StrategyView } from '@/alcon/element/actions';
import { ElementsByObjectView } from '@/alcon/element/actions/ElementsByObjectView';
import { MyElementsView } from '@/alcon/element/actions/MyElementsView';
import { RoomView } from '@/alcon/room/RoomView';
import { ChatView } from '@/alcon/chat/ChatView';
import {
  PageView,
  NotesSidebar,
  BriefsEmptyState,
  ObjectDraftDialog,
} from '@/alcon/brief';
import { summarizeNoteContent } from '@/alcon/brief/aiSummary';
import { draftObjectFromBrief, type ObjectDraft, type ObjectDraftElement } from '@/alcon/brief/objectDraft';
import type { Brief } from '@/types/notes';

import { DomainsView } from '@/alcon/domain/DomainsView';
import { DomainView } from '@/alcon/object/DomainView';
import { ReferenceView } from '@/alcon/reference/ReferenceView';
import { SettingsView } from '@/alcon/settings/SettingsView';
import { IslandCard } from '@/shell/IslandCard';

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
  const { nodes, createNode, renameNode, deleteNode, moveNode, setLinkedObject } = useNotes();
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const resolvedFileId = useDefaultFileId(nodes, selectedFileId);
  const { html, loading: contentLoading, save: saveContent } = useNoteContent(resolvedFileId);

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

  const handleCreateNode = async (type: 'file' | 'folder') => {
    try {
      const node = await createNode(type, type === 'folder' ? 'New Folder' : 'Untitled', null);
      if (type === 'file') setSelectedFileId(node.id);
    } catch (e) { console.error(e); }
  };

  const handleDeleteNode = async (id: string) => {
    try {
      await deleteNode(id);
      if (resolvedFileId === id) setSelectedFileId(null);
    } catch (e) { console.error(e); }
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
              <NotesSidebar
                nodes={nodes}
                selectedFileId={resolvedFileId}
                onSelectFile={setSelectedFileId}
                onCreateNode={handleCreateNode}
                onDeleteNode={handleDeleteNode}
                onMoveNode={moveNode}
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
              {objectizing?.phase === 'error' && (
                <div
                  className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6"
                  onMouseDown={() => setObjectizing(null)}
                >
                  <div
                    className="bg-card border border-border rounded-2xl shadow-2xl px-5 py-4 max-w-sm text-center"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="text-[12px] text-destructive mb-2">Obj化に失敗しました</div>
                    <div className="text-[11px] text-muted-foreground break-words">{objectizing.message}</div>
                  </div>
                </div>
              )}
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
              <StrategyView />
            </div>
          )}

          {activeActivity === 'domains' && (
            <div className="flex-1 overflow-auto bg-card">
              <DomainsView explorerData={explorerData} onOpen={() => onViewChange?.('projects')} />
            </div>
          )}

          {activeActivity === 'mytasks' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <ElementsByObjectView
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
