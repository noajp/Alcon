'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Plus, ChevronDown, ChevronRight, Hash, Volume2, UserPlus, Settings as SettingsIcon, Check } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { NavRoomIcon } from '@/shell/sidebar/NavIcons';
import { useDomains } from '@/hooks/useSupabase';
import { getActiveDomainId, setActiveDomainId, ACTIVE_DOMAIN_CHANGE_EVENT } from '@/alcon/domain/domainsStore';
import type { Domain } from '@/hooks/useSupabase';
import { useRoom } from '@/hooks/useRoom';
import type { Channel, ChannelKind } from '@/types/database';
import { ChannelDialog } from './ChannelDialog';
import { TextChannelView } from './TextChannelView';
import { VoiceChannelView } from './VoiceChannelView';

// ============================================
// Room — 1 System = 1 Room. Channels only (text/voice).
// Top header acts as System (= Room) switcher.
// ============================================

function RoomSwitcher() {
  const { data: domains } = useDomains();
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>(getActiveDomainId() ?? '');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = getActiveDomainId();
    if (saved && domains.some((d) => d.id === saved)) setActiveId(saved);
    else if (domains[0]) setActiveId(domains[0].id);

    const handler = (e: Event) => {
      const ce = e as CustomEvent<string>;
      if (ce.detail) setActiveId(ce.detail);
    };
    window.addEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
    return () => window.removeEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
  }, [domains]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const active: Domain | undefined = domains.find((d) => d.id === activeId) ?? domains[0];
  if (!active) return null;

  return (
    <div ref={ref} className="relative px-2 pt-2 pb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-10 flex items-center gap-2 px-2.5 rounded-lg border border-border/30 bg-muted/20 hover:bg-muted/40 transition-colors"
        title={active.name}
      >
        <div className="w-5 h-5 rounded bg-muted flex items-center justify-center text-[9px] font-semibold text-muted-foreground flex-shrink-0">
          {active.name.charAt(0)}
        </div>
        <span className="flex-1 text-left text-[13px] font-semibold text-foreground truncate">{active.name}</span>
        <ChevronDown size={14} className="text-muted-foreground flex-shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-2 right-2 top-full mt-1 bg-popover border border-border rounded-xl shadow-xl z-50 py-1 overflow-hidden">
            <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Domains
            </div>
            {domains.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => { setActiveId(d.id); setActiveDomainId(d.id); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
              >
                <div className="w-5 h-5 rounded bg-muted flex items-center justify-center text-[9px] font-semibold text-muted-foreground">
                    {d.name.charAt(0)}
                  </div>
                <span className="flex-1 text-left truncate">{d.name}</span>
                {d.id === active.id && <Check size={14} className="text-foreground shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SortableChannelRow({
  channel,
  selected,
  onSelect,
  onEdit,
}: {
  channel: Channel;
  selected: boolean;
  onSelect: (id: string) => void;
  onEdit: (channel: Channel) => void;
}) {
  const ChannelIcon = channel.kind === 'text' ? Hash : Volume2;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: channel.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="mx-1">
      <div
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(channel.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(channel.id);
          }
        }}
        className={`group w-full flex items-center gap-2 h-[28px] pl-2 pr-1 rounded-md transition-colors cursor-pointer ${
          selected
            ? 'bg-accent text-foreground'
            : 'text-foreground/70 hover:bg-muted/40 hover:text-foreground'
        }`}
        title={channel.name}
      >
        <ChannelIcon size={14} className="text-muted-foreground flex-shrink-0" />
        <span className="text-[13px] truncate flex-1 text-left">{channel.name}</span>
        {selected && (
          <span className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
            <span
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              title="Invite"
            >
              <UserPlus size={12} />
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(channel); }}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              title="Channel settings"
            >
              <SettingsIcon size={12} />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function ChannelSection({
  title,
  kind,
  channels,
  selectedId,
  onSelect,
  onCreate,
  onEdit,
  onReorder,
}: {
  title: string;
  kind: ChannelKind;
  channels: Channel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (kind: ChannelKind) => void;
  onEdit: (channel: Channel) => void;
  onReorder: (kind: ChannelKind, orderedIds: string[]) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const filtered = channels.filter((c) => c.kind === kind);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = filtered.map((c) => c.id);
    const from = ids.indexOf(active.id as string);
    const to = ids.indexOf(over.id as string);
    if (from === -1 || to === -1) return;
    const next = arrayMove(ids, from, to);
    onReorder(kind, next);
  };

  return (
    <div className="mb-2">
      <div className="group flex items-center justify-between h-[24px] px-2 mx-1 text-muted-foreground">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1 hover:text-foreground"
        >
          {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          <span className="text-[10px] font-semibold uppercase tracking-wider">{title}</span>
        </button>
        <button
          type="button"
          onClick={() => onCreate(kind)}
          className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:bg-muted/40 hover:text-foreground transition-opacity"
          title={`New ${kind} channel`}
        >
          <Plus size={12} />
        </button>
      </div>

      {!collapsed && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={filtered.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {filtered.map((channel) => (
              <SortableChannelRow
                key={channel.id}
                channel={channel}
                selected={channel.id === selectedId}
                onSelect={onSelect}
                onEdit={onEdit}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function RoomSidebar({
  channels,
  selectedId,
  onSelect,
  onCreate,
  onEdit,
  onReorder,
}: {
  channels: Channel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (kind: ChannelKind) => void;
  onEdit: (channel: Channel) => void;
  onReorder: (kind: ChannelKind, orderedIds: string[]) => void;
}) {
  return (
    <div className="w-60 flex-shrink-0 flex flex-col overflow-hidden bg-transparent">
      <RoomSwitcher />

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        <ChannelSection
          title="Text channels"
          kind="text"
          channels={channels}
          selectedId={selectedId}
          onSelect={onSelect}
          onCreate={onCreate}
          onEdit={onEdit}
          onReorder={onReorder}
        />
        <ChannelSection
          title="Voice channels"
          kind="voice"
          channels={channels}
          selectedId={selectedId}
          onSelect={onSelect}
          onCreate={onCreate}
          onEdit={onEdit}
          onReorder={onReorder}
        />
      </div>
    </div>
  );
}

function ChannelHeader({ channel }: { channel: Channel }) {
  const Icon = channel.kind === 'text' ? Hash : Volume2;
  return (
    <div className="h-12 flex items-center gap-2 px-4 border-b border-border/30 flex-shrink-0">
      <Icon size={18} className="text-muted-foreground" />
      <span className="text-[14px] font-semibold text-foreground">{channel.name}</span>
      {channel.topic && (
        <>
          <span className="w-px h-5 bg-border/30 mx-2" />
          <span className="text-[12px] text-muted-foreground truncate">{channel.topic}</span>
        </>
      )}
    </div>
  );
}

function RoomEmpty({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-card">
      <div className="text-center max-w-sm px-6">
        <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center rounded-xl bg-muted text-foreground/60">
          <NavRoomIcon size={24} />
        </div>
        <h2 className="text-[15px] font-semibold text-foreground mb-1">Room</h2>
        <p className="text-[12px] text-muted-foreground leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

type DialogMode =
  | { mode: 'create'; kind: ChannelKind }
  | { mode: 'edit'; channel: Channel }
  | null;

export function RoomView({
  domainId,
  selectedChannelId,
  onSelectChannel,
}: {
  domainId: string | null;
  selectedChannelId: string | null;
  onSelectChannel: (id: string | null) => void;
}) {
  const { room, channels, loading, error, createChannel, updateChannel, deleteChannel, reorderChannels } = useRoom(domainId);
  const [dialog, setDialog] = useState<DialogMode>(null);

  // Auto-select default (or first available) channel when none is chosen
  useEffect(() => {
    if (selectedChannelId) return;
    if (!channels.length) return;
    const fallback = (room?.default_channel_id && channels.find((c) => c.id === room.default_channel_id))
      || channels.find((c) => c.kind === 'text')
      || channels[0];
    if (fallback) onSelectChannel(fallback.id);
  }, [selectedChannelId, channels, room, onSelectChannel]);

  // If the chosen channel is no longer in the list (e.g., system switch), clear it
  useEffect(() => {
    if (selectedChannelId && channels.length && !channels.some((c) => c.id === selectedChannelId)) {
      onSelectChannel(null);
    }
  }, [selectedChannelId, channels, onSelectChannel]);

  const channel = channels.find((c) => c.id === selectedChannelId) ?? null;

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
    <div className="h-full flex overflow-hidden bg-card">
      <RoomSidebar
        channels={channels}
        selectedId={selectedChannelId}
        onSelect={onSelectChannel}
        onCreate={(kind) => setDialog({ mode: 'create', kind })}
        onEdit={(ch) => setDialog({ mode: 'edit', channel: ch })}
        onReorder={reorderChannels}
      />
      <div className="flex-1 flex flex-col overflow-hidden border-l border-border/30">
        {loading && <RoomEmpty message="Loading..." />}
        {!loading && error && <RoomEmpty message={`エラー: ${error.message}`} />}
        {!loading && !error && !channel && <RoomEmpty message="左から Channel を選んでください。" />}
        {!loading && !error && channel?.kind === 'text' && <TextChannelView channel={channel} />}
        {!loading && !error && channel?.kind === 'voice' && <VoiceChannelView channel={channel} />}
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
