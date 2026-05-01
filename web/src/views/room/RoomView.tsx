'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Plus, ChevronDown, ChevronRight, Hash, Volume2, UserPlus, Settings as SettingsIcon, Check } from 'lucide-react';
import { NavRoomIcon } from '@/layout/sidebar/NavIcons';
import { useSystems, getActiveSystemId, setActiveSystemId, type SystemEntry } from '@/alcon/system/systemsStore';
import { useRoom } from '@/hooks/useRoom';
import type { Channel } from '@/types/database';

// ============================================
// Room — 1 System = 1 Room. Channels only (text/voice).
// Top header acts as System (= Room) switcher.
// ============================================

function RoomSwitcher() {
  const SYSTEMS = useSystems();
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>(SYSTEMS[0]?.id ?? '');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = getActiveSystemId();
    if (saved && SYSTEMS.some((s) => s.id === saved)) setActiveId(saved);
    else if (SYSTEMS[0]) setActiveId(SYSTEMS[0].id);

    const handler = (e: Event) => {
      const ce = e as CustomEvent<string>;
      if (ce.detail) setActiveId(ce.detail);
    };
    window.addEventListener('alcon:active-system-change', handler as EventListener);
    return () => window.removeEventListener('alcon:active-system-change', handler as EventListener);
  }, [SYSTEMS]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const active: SystemEntry | undefined = SYSTEMS.find((s) => s.id === activeId) ?? SYSTEMS[0];
  if (!active) return null;

  return (
    <div ref={ref} className="relative px-2 pt-2 pb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-10 flex items-center gap-2 px-2.5 rounded-lg border border-border/60 bg-muted/20 hover:bg-muted/40 transition-colors"
        title={active.name}
      >
        {active.icon ? (
          <img src={active.icon} alt={active.name} className="w-5 h-5 rounded object-cover flex-shrink-0" />
        ) : (
          <div className="w-5 h-5 rounded bg-muted flex items-center justify-center text-[9px] font-semibold text-muted-foreground flex-shrink-0">
            {active.name.charAt(0)}
          </div>
        )}
        <span className="flex-1 text-left text-[13px] font-semibold text-foreground truncate">{active.name}</span>
        <ChevronDown size={14} className="text-muted-foreground flex-shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-2 right-2 top-full mt-1 bg-popover border border-border rounded-xl shadow-xl z-50 py-1 overflow-hidden">
            <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Systems
            </div>
            {SYSTEMS.map((sys) => (
              <button
                key={sys.id}
                type="button"
                onClick={() => { setActiveId(sys.id); setActiveSystemId(sys.id); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
              >
                {sys.icon ? (
                  <img src={sys.icon} alt={sys.name} className="w-5 h-5 rounded object-cover" />
                ) : (
                  <div className="w-5 h-5 rounded bg-muted flex items-center justify-center text-[9px] font-semibold text-muted-foreground">
                    {sys.name.charAt(0)}
                  </div>
                )}
                <span className="flex-1 text-left truncate">{sys.name}</span>
                {sys.id === active.id && <Check size={14} className="text-foreground shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ChannelSection({
  title,
  kind,
  channels,
  selectedId,
  onSelect,
}: {
  title: string;
  kind: Channel['kind'];
  channels: Channel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const filtered = channels.filter((c) => c.kind === kind);
  const ChannelIcon = kind === 'text' ? Hash : Volume2;

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
          className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:bg-muted/40 hover:text-foreground transition-opacity"
          title={`New ${kind} channel`}
        >
          <Plus size={12} />
        </button>
      </div>

      {!collapsed && filtered.map((channel) => {
        const isSelected = channel.id === selectedId;
        return (
          <button
            key={channel.id}
            type="button"
            onClick={() => onSelect(channel.id)}
            className={`group w-full flex items-center gap-2 h-[28px] pl-2 pr-1 mx-1 rounded-md transition-colors ${
              isSelected
                ? 'bg-accent text-foreground'
                : 'text-foreground/70 hover:bg-muted/40 hover:text-foreground'
            }`}
            title={channel.name}
          >
            <ChannelIcon size={14} className="text-muted-foreground flex-shrink-0" />
            <span className="text-[13px] truncate flex-1 text-left">{channel.name}</span>
            {isSelected && (
              <span className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
                <span className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground">
                  <UserPlus size={12} />
                </span>
                <span className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground">
                  <SettingsIcon size={12} />
                </span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function RoomSidebar({
  channels,
  selectedId,
  onSelect,
}: {
  channels: Channel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
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
        />
        <ChannelSection
          title="Voice channels"
          kind="voice"
          channels={channels}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

function ChannelHeader({ channel }: { channel: Channel }) {
  const Icon = channel.kind === 'text' ? Hash : Volume2;
  return (
    <div className="h-12 flex items-center gap-2 px-4 border-b border-border/60 flex-shrink-0">
      <Icon size={18} className="text-muted-foreground" />
      <span className="text-[14px] font-semibold text-foreground">{channel.name}</span>
      {channel.topic && (
        <>
          <span className="w-px h-5 bg-border/60 mx-2" />
          <span className="text-[12px] text-muted-foreground truncate">{channel.topic}</span>
        </>
      )}
    </div>
  );
}

function TextChannelPlaceholder({ channel }: { channel: Channel }) {
  return (
    <div className="flex-1 flex flex-col">
      <ChannelHeader channel={channel} />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center rounded-xl bg-muted text-foreground/60">
            <Hash size={24} />
          </div>
          <h2 className="text-[15px] font-semibold text-foreground mb-1">#{channel.name}</h2>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            メッセージ機能は Phase 2 で実装予定です。ここにテキストチャットの UI が入ります。
          </p>
        </div>
      </div>
    </div>
  );
}

function VoiceChannelPlaceholder({ channel }: { channel: Channel }) {
  return (
    <div className="flex-1 flex flex-col">
      <ChannelHeader channel={channel} />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center rounded-xl bg-muted text-foreground/60">
            <Volume2 size={24} />
          </div>
          <h2 className="text-[15px] font-semibold text-foreground mb-1">{channel.name}</h2>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            通話機能は Phase 3 で LiveKit を使って実装予定です。
          </p>
        </div>
      </div>
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

export function RoomView({
  systemId,
  selectedChannelId,
  onSelectChannel,
}: {
  systemId: string | null;
  selectedChannelId: string | null;
  onSelectChannel: (id: string | null) => void;
}) {
  const { room, channels, loading, error } = useRoom(systemId);

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

  return (
    <div className="h-full flex overflow-hidden bg-card">
      <RoomSidebar
        channels={channels}
        selectedId={selectedChannelId}
        onSelect={onSelectChannel}
      />
      <div className="flex-1 flex flex-col overflow-hidden border-l border-border">
        {loading && <RoomEmpty message="Loading..." />}
        {!loading && error && <RoomEmpty message={`エラー: ${error.message}`} />}
        {!loading && !error && !channel && <RoomEmpty message="左から Channel を選んでください。" />}
        {!loading && !error && channel?.kind === 'text' && <TextChannelPlaceholder channel={channel} />}
        {!loading && !error && channel?.kind === 'voice' && <VoiceChannelPlaceholder channel={channel} />}
      </div>
    </div>
  );
}
