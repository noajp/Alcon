'use client';

import React, { useState } from 'react';
import { Calendar, Shield, Plus, ChevronDown, ChevronRight, Hash, Volume2, UserPlus, Settings as SettingsIcon } from 'lucide-react';
import { NavServerIcon } from '@/layout/sidebar/NavIcons';

// ============================================
// Server Room — Phase 1b skeleton (mock data)
// 1 System = 1 Server. Channels only (text/voice).
// ============================================

type ChannelKind = 'text' | 'voice';

type Channel = {
  id: string;
  kind: ChannelKind;
  name: string;
  topic?: string;
};

type Server = {
  id: string;
  name: string;
  channels: Channel[];
};

const MOCK_SERVER: Server = {
  id: 'mock-server',
  name: "noa's server",
  channels: [
    { id: 'general', kind: 'text', name: 'general', topic: 'みんなで雑談' },
    { id: 'voice-1', kind: 'voice', name: 'Voice' },
  ],
};

function ServerHeader({ name }: { name: string }) {
  return (
    <div className="h-10 flex items-center justify-between px-3 flex-shrink-0 border-b border-border/60">
      <button
        type="button"
        className="flex items-center gap-1 text-[13px] font-semibold text-foreground hover:text-foreground/80 truncate"
        title={name}
      >
        <span className="truncate">{name}</span>
        <ChevronDown size={14} className="text-muted-foreground" />
      </button>
      <button
        type="button"
        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        title="Invite members"
      >
        <UserPlus size={14} />
      </button>
    </div>
  );
}

function HeaderRow({ icon: Icon, label }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string }) {
  return (
    <button
      type="button"
      className="w-full flex items-center gap-2 h-[28px] px-2 mx-1 rounded-md text-foreground/70 hover:bg-muted/40 hover:text-foreground transition-colors"
    >
      <Icon size={14} className="text-muted-foreground" />
      <span className="text-[12px]">{label}</span>
    </button>
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
  kind: ChannelKind;
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

function ServerSidebar({
  server,
  selectedId,
  onSelect,
}: {
  server: Server;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="w-60 flex-shrink-0 flex flex-col overflow-hidden bg-transparent">
      <ServerHeader name={server.name} />

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        <HeaderRow icon={Calendar} label="Events" />
        <HeaderRow icon={Shield} label="Server Boosts" />

        <div className="h-px bg-border/60 mx-3 my-2" />

        <ChannelSection
          title="Text channels"
          kind="text"
          channels={server.channels}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        <ChannelSection
          title="Voice channels"
          kind="voice"
          channels={server.channels}
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

function ServerEmpty() {
  return (
    <div className="flex-1 flex items-center justify-center bg-card">
      <div className="text-center max-w-sm px-6">
        <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center rounded-xl bg-muted text-foreground/60">
          <NavServerIcon size={24} />
        </div>
        <h2 className="text-[15px] font-semibold text-foreground mb-1">Server Room</h2>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          左から Channel を選んでください。
        </p>
      </div>
    </div>
  );
}

export function ServerView() {
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>('general');
  const server = MOCK_SERVER;
  const channel = server.channels.find((c) => c.id === selectedChannelId) ?? null;

  return (
    <div className="h-full flex overflow-hidden bg-card">
      <ServerSidebar
        server={server}
        selectedId={selectedChannelId}
        onSelect={setSelectedChannelId}
      />
      <div className="flex-1 flex flex-col overflow-hidden border-l border-border">
        {!channel && <ServerEmpty />}
        {channel?.kind === 'text' && <TextChannelPlaceholder channel={channel} />}
        {channel?.kind === 'voice' && <VoiceChannelPlaceholder channel={channel} />}
      </div>
    </div>
  );
}
