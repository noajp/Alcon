'use client';

import { useState } from 'react';
import { ChevronRight, Folder as FolderIcon, FolderInput, FolderPlus, MessageSquare, Pencil, SquarePen, Trash2 } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { SidebarRow, SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import { useCopilotConversation } from '@/AIP/copilot/CopilotProvider';
import type { AiSessionSummary } from '@/hooks/useAiConversations';
import { RenameInput } from '@/Function/shared/RenameInput';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent,
  ContextMenuSubTrigger, ContextMenuTrigger,
} from '@/ui/context-menu';

/**
 * The AI screen's sidebar: this person's conversations in the Space, in two
 * layers — folders, and the conversations in them or loose below. Picking one
 * opens it on the AI screen; each row carries its actions on a right-click.
 */
export function AiSidebar({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const { library, sessionId, openSession, newConversation } = useCopilotConversation();
  const { folders, sessions } = library;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  // Radix hands focus back to the trigger as the menu closes; renaming after
  // that lets the field keep it.
  const startRename = (id: string) => { window.setTimeout(() => setRenaming(id), 0); };

  const startChat = (folderId: string | null = null) => { newConversation(folderId); onOpen(); };
  const open = (id: string) => { void openSession(id); onOpen(); };
  const addFolder = async () => {
    const id = await library.createFolder(t('New folder'));
    if (id) startRename(id);
  };
  const toggle = (id: string) => setClosed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const deleteFolder = async (id: string, name: string, count: number) => {
    const message = count === 0
      ? t('Delete the folder "{name}"? This cannot be undone.', { name })
      : t('Delete the folder "{name}" and its {count} conversations? This cannot be undone.', { name, count });
    if (!(await appDialog.confirm(message))) return;
    if (sessions.some((s) => s.folder_id === id && s.id === sessionId)) newConversation();
    void library.deleteFolder(id);
  };
  const deleteSession = async (session: AiSessionSummary) => {
    const name = session.title || t('Untitled');
    if (!(await appDialog.confirm(t('Delete the conversation "{name}"? This cannot be undone.', { name })))) return;
    if (session.id === sessionId) newConversation();
    void library.deleteSession(session.id);
  };

  const nameOrInput = (id: string, name: string, commit: (v: string) => void, onClick: () => void) => renaming === id ? (
    <RenameInput
      initial={name}
      onCommit={(v) => { if (v && v !== name) commit(v); setRenaming(null); }}
      onCancel={() => setRenaming(null)}
      className="min-w-0 flex-1 bg-transparent text-foreground"
    />
  ) : (
    <button type="button" onClick={onClick} onDoubleClick={() => startRename(id)} title={name} className="h-full min-w-0 flex-1 truncate text-left outline-none">
      {name}
    </button>
  );

  const sessionRow = (session: AiSessionSummary, nested: boolean) => (
    <ContextMenu key={session.id}>
      <ContextMenuTrigger asChild>
        <SidebarRow active={session.id === sessionId} size={nested ? 'sm' : 'md'} icon={<MessageSquare size={14} />} className={nested ? 'pl-3' : undefined}>
          {nameOrInput(session.id, session.title || t('Untitled'), (v) => void library.renameSession(session.id, v), () => open(session.id))}
        </SidebarRow>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[180px]" onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem onSelect={() => startRename(session.id)}><Pencil /> {t('Rename')}</ContextMenuItem>
        {(folders.length > 0) && (
          <ContextMenuSub>
            <ContextMenuSubTrigger><FolderInput /> {t('Move to')}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-[160px]">
              {folders.filter((f) => f.id !== session.folder_id).map((f) => (
                <ContextMenuItem key={f.id} onSelect={() => void library.moveSession(session.id, f.id)}><FolderIcon /> {f.name}</ContextMenuItem>
              ))}
              {session.folder_id && (
                <ContextMenuItem onSelect={() => void library.moveSession(session.id, null)}>{t('No folder')}</ContextMenuItem>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => void deleteSession(session)}><Trash2 /> {t('Delete conversation')}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );

  const loose = sessions.filter((s) => !s.folder_id);

  return (
    <div className="mt-1">
      <div className="flex flex-col">
        <SidebarRow icon={<SquarePen size={15} />} label={t('New chat')} onClick={() => startChat()} />
        <SidebarRow icon={<FolderPlus size={15} />} label={t('New folder')} onClick={() => void addFolder()} />
      </div>

      {folders.length > 0 && <SidebarSectionLabel>{t('Folders')}</SidebarSectionLabel>}
      <div className="flex flex-col">
        {folders.map((folder) => {
          const inside = sessions.filter((s) => s.folder_id === folder.id);
          const isOpen = !closed.has(folder.id);
          return (
            <div key={folder.id}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <SidebarRow
                    icon={<ChevronRight size={13} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />}
                    meta={inside.length || undefined}>
                    {nameOrInput(folder.id, folder.name, (v) => void library.renameFolder(folder.id, v), () => toggle(folder.id))}
                  </SidebarRow>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-[180px]" onCloseAutoFocus={(e) => e.preventDefault()}>
                  <ContextMenuItem onSelect={() => startChat(folder.id)}><SquarePen /> {t('New chat')}</ContextMenuItem>
                  <ContextMenuItem onSelect={() => startRename(folder.id)}><Pencil /> {t('Rename')}</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onSelect={() => void deleteFolder(folder.id, folder.name, inside.length)}><Trash2 /> {t('Delete folder')}</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {isOpen && inside.map((s) => sessionRow(s, true))}
            </div>
          );
        })}
      </div>

      {loose.length > 0 && <SidebarSectionLabel>{t('Conversations')}</SidebarSectionLabel>}
      <div className="flex flex-col">
        {loose.map((s) => sessionRow(s, false))}
      </div>
      {library.error && <p role="alert" className="px-2.5 pt-2 text-[12px] text-[var(--status-danger)]">{library.error}</p>}
    </div>
  );
}
