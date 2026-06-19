'use client';

import { useEffect, useState } from 'react';
import type { Channel, ChannelKind } from '@/types/database';
import { useRoom } from '@/hooks/useRoom';
import { RoomSwitcher, ChannelSection } from './RoomView';
import { ChannelDialog } from './ChannelDialog';

type DialogMode =
  | { mode: 'create'; kind: ChannelKind }
  | { mode: 'edit'; channel: Channel }
  | null;

interface RoomSidebarPanelProps {
  domainId: string | null;
  selectedChannelId: string | null;
  onSelectChannel: (id: string | null) => void;
}

// Channel-list sidebar mounted by AppSidebar when the Mode strip is in
// Room mode. Owns the dialog state and useRoom call so RoomView in the
// main content area can run with hideSidebar and just render the message
// pane.
export function RoomSidebarPanel({ domainId, selectedChannelId, onSelectChannel }: RoomSidebarPanelProps) {
  const { room, channels, createChannel, updateChannel, deleteChannel, reorderChannels } = useRoom(domainId);
  const [dialog, setDialog] = useState<DialogMode>(null);

  // The bottom "+ Create new" button in AppSidebar fires this event in
  // Room mode with the chosen channel kind ('text' | 'voice') so the
  // ChannelDialog state stays co-located with the panel that owns it.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ kind?: ChannelKind }>).detail;
      const kind = detail?.kind ?? 'text';
      setDialog({ mode: 'create', kind });
    };
    window.addEventListener('alcon:room-new-channel', handler);
    return () => window.removeEventListener('alcon:room-new-channel', handler);
  }, []);

  // Mirror RoomView's auto-select: when no channel is chosen and channels
  // exist, pick the room default (or first text, or first overall).
  useEffect(() => {
    if (selectedChannelId) return;
    if (!channels.length) return;
    const fallback = (room?.default_channel_id && channels.find((c) => c.id === room.default_channel_id))
      || channels.find((c) => c.kind === 'text')
      || channels[0];
    if (fallback) onSelectChannel(fallback.id);
  }, [selectedChannelId, channels, room, onSelectChannel]);

  // Clear stale selection when the chosen channel disappears.
  useEffect(() => {
    if (selectedChannelId && channels.length && !channels.some((c) => c.id === selectedChannelId)) {
      onSelectChannel(null);
    }
  }, [selectedChannelId, channels, onSelectChannel]);

  const handleCreate = async (input: { kind: ChannelKind; name: string; topic?: string }) => {
    const created = await createChannel(input);
    onSelectChannel(created.id);
  };

  const handleUpdate = async (id: string, patch: { name: string; topic: string | null }) => {
    await updateChannel(id, patch);
  };

  const handleDelete = async (id: string) => {
    await deleteChannel(id);
    if (selectedChannelId === id) onSelectChannel(null);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* TalkSpace header — matches the per-mode "Space" labels (NoteSpace,
          ChatSpace, Activity Space). Sits above the room switcher. */}
      <div className="flex items-center px-3 pt-2.5 pb-1">
        <span className="text-[11px] font-bold text-muted-foreground/60 select-none">
          TalkSpace
        </span>
      </div>
      <RoomSwitcher />
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        <ChannelSection
          title="Text channels"
          kind="text"
          channels={channels}
          selectedId={selectedChannelId}
          onSelect={onSelectChannel}
          onCreate={(kind) => setDialog({ mode: 'create', kind })}
          onEdit={(ch) => setDialog({ mode: 'edit', channel: ch })}
          onReorder={reorderChannels}
        />
        <ChannelSection
          title="Voice channels"
          kind="voice"
          channels={channels}
          selectedId={selectedChannelId}
          onSelect={onSelectChannel}
          onCreate={(kind) => setDialog({ mode: 'create', kind })}
          onEdit={(ch) => setDialog({ mode: 'edit', channel: ch })}
          onReorder={reorderChannels}
        />
      </div>

      {dialog && (
        <ChannelDialog
          mode={dialog}
          open
          onOpenChange={(o) => { if (!o) setDialog(null); }}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
