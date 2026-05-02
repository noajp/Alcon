'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { NavigationState } from '@/types/navigation';
import type { ExplorerData } from '@/hooks/useSupabase';
import {
  createElement as createElementRow,
  createObject as createObjectRow,
  addElementToObject,
  moveObject,
} from '@/hooks/useSupabase';
import { useNotes, useNoteContent, useBriefs, useDefaultFileId } from '@/hooks/useNotesDb';

import { TabBar } from './TabBar';

import { NotesView, ActionsView, InboxView } from '@/alcon/element/actions';
import { MyTasksView } from '@/alcon/element/actions/MyTasksView';
import { HomeView } from '@/alcon/widget/home';
import { RoomView } from '@/alcon/room/RoomView';
import {
  PageView,
  NotesSidebar,
  BriefsEmptyState,
  BriefsListView,
  BriefDialog,
  BriefViewDialog,
  ObjectDraftDialog,
  type BriefStructured,
} from '@/alcon/brief';
import type { BriefDraft } from '@/alcon/brief/BriefDialog';
import type { ObjectDraftElement } from '@/alcon/brief/objectDraft';

import { DomainsView } from '@/alcon/domain/DomainsView';
import { ObjectsView, MyObjectsList, MyObjectsSidebar } from '@/alcon/object/ObjectsView';
import { ObjectDetailView } from '@/alcon/object/ObjectDetailView';
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
  const { nodes, createNode, renameNode, deleteNode } = useNotes();
  const { briefs, createBrief, deleteBrief } = useBriefs();
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const resolvedFileId = useDefaultFileId(nodes, selectedFileId);
  const { content, loading: contentLoading, save: saveContent } = useNoteContent(resolvedFileId);
  const [briefDialogOpen, setBriefDialogOpen] = useState(false);
  const [viewingBriefId, setViewingBriefId] = useState<string | null>(null);
  const [objectizeBriefId, setObjectizeBriefId] = useState<string | null>(null);
  const [briefDrafts, setBriefDrafts] = useState<Record<string, BriefDraft>>({});

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
  const viewingBrief = viewingBriefId ? briefs.find((t) => t.id === viewingBriefId) ?? null : null;
  const objectizeBrief = objectizeBriefId ? briefs.find((t) => t.id === objectizeBriefId) ?? null : null;

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

  const handleCreateBrief = async (input: { title: string; summary: string; structured?: BriefStructured }) => {
    if (!selectedFile) return;
    await createBrief({
      sourceNoteId: selectedFile.id,
      sourceNoteName: selectedFile.name,
      title: input.title,
      summary: input.summary,
      structured: input.structured,
      sourceSnapshot: content,
    });
    setBriefDrafts((prev) => { const next = { ...prev }; delete next[selectedFile.id]; return next; });
    setBriefDialogOpen(false);
  };

  const handleDeleteBrief = async (id: string) => {
    try { await deleteBrief(id); setViewingBriefId(null); } catch (e) { console.error(e); }
  };

  const handleCreateObjectFromBrief = async (input: {
    name: string;
    description?: string;
    color?: string;
    domainId: string | null;
    elements: ObjectDraftElement[];
  }) => {
    const created = await createObjectRow({ name: input.name, description: input.description, color: input.color, domain_id: input.domainId ?? activeDomainId ?? null });
    try { await moveObject(created.id, null, 0); } catch (err) { console.error('Failed to move Brief Object to top', err); }
    for (const el of input.elements) {
      try {
        const row = await createElementRow({ title: el.title, object_id: created.id, description: el.description, priority: el.priority ?? 'medium' });
        try { await addElementToObject(row.id, created.id, true); } catch { /* already written */ }
      } catch (err) { console.error('Failed to create Element', el.title, err); }
    }
    onRefresh?.();
    setObjectizeBriefId(null);
    setViewingBriefId(null);
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
                briefs={briefs}
                onSelectBrief={setViewingBriefId}
                onCreateNode={handleCreateNode}
                onDeleteNode={handleDeleteNode}
              />
              {selectedFile && !contentLoading ? (
                <PageView
                  key={selectedFile.id}
                  fileId={selectedFile.id}
                  title={selectedFile.name}
                  icon={selectedFile.icon}
                  content={content}
                  onTitleChange={handleTitleChange}
                  onContentChange={saveContent}
                  onBrief={() => setBriefDialogOpen(true)}
                />
              ) : (
                <BriefsEmptyState />
              )}
              {briefDialogOpen && selectedFile && (
                <BriefDialog
                  defaultTitle={selectedFile.name}
                  sourceFileName={selectedFile.name}
                  sourceContent={content}
                  initialDraft={briefDrafts[selectedFile.id]}
                  onDraftChange={(draft) => setBriefDrafts((prev) => ({ ...prev, [selectedFile.id]: draft }))}
                  onClose={() => setBriefDialogOpen(false)}
                  onCreate={handleCreateBrief}
                />
              )}
              {viewingBrief && (
                <BriefViewDialog
                  brief={viewingBrief}
                  onClose={() => setViewingBriefId(null)}
                  onOpenSource={() => { setSelectedFileId(viewingBrief.sourceFileId); setViewingBriefId(null); }}
                  onDelete={() => handleDeleteBrief(viewingBrief.id)}
                  onObjectize={() => setObjectizeBriefId(viewingBrief.id)}
                />
              )}
              {objectizeBrief && (
                <ObjectDraftDialog
                  brief={objectizeBrief}
                  defaultDomainId={activeDomainId}
                  onClose={() => setObjectizeBriefId(null)}
                  onCreate={handleCreateObjectFromBrief}
                />
              )}
            </div>
          )}

          {activeActivity === 'brief' && (
            <div className="flex-1 flex overflow-hidden bg-card">
              <BriefsListView
                briefs={briefs}
                onOpenSource={(fileId) => { setSelectedFileId(fileId); onViewChange?.('note'); }}
                onDelete={handleDeleteBrief}
                onObjectize={(briefId) => setObjectizeBriefId(briefId)}
              />
              {objectizeBrief && (
                <ObjectDraftDialog
                  brief={objectizeBrief}
                  defaultDomainId={activeDomainId}
                  onClose={() => setObjectizeBriefId(null)}
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
            />
          )}

          {activeActivity === 'home' && (
            <div className="flex-1 overflow-auto bg-card">
              <HomeView explorerData={explorerData} />
            </div>
          )}

          {activeActivity === 'inbox' && (
            <div className="flex-1 overflow-hidden bg-card">
              <InboxView onNavigate={onNavigate} onViewChange={onViewChange} />
            </div>
          )}

          {activeActivity === 'domains' && (
            <div className="flex-1 overflow-auto bg-card">
              <DomainsView explorerData={explorerData} onOpen={() => onViewChange?.('projects')} />
            </div>
          )}

          {activeActivity === 'mytasks' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <MyTasksView />
            </div>
          )}

          {activeActivity === 'projects' && (
            <div className="flex-1 flex overflow-hidden bg-card">
              <MyObjectsSidebar
                objects={explorerData.objects}
                selectedId={navigation.objectId}
                onSelect={(id) => onNavigate({ objectId: id })}
                onRefresh={onRefresh}
              />
              <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                {navigation.objectId ? (
                  <ObjectsView
                    explorerData={explorerData}
                    navigation={navigation}
                    onNavigate={onNavigate}
                    onRefresh={onRefresh}
                  />
                ) : (
                  <MyObjectsList
                    explorerData={explorerData}
                    onSelect={(id) => onNavigate({ objectId: id })}
                    onRefresh={onRefresh}
                  />
                )}
              </div>
            </div>
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
      </div>
    </div>
  );
}
