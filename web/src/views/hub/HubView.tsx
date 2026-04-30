'use client';

import React, { useState } from 'react';
import { NavHubIcon } from '@/layout/sidebar/NavIcons';
import { MessageSquare, Video, Inbox as InboxIcon, Bot, Plug } from 'lucide-react';

// ============================================
// Hub — 外部入力 (Chat / Inbox / Meetings / AI) を Brief/Element に変換する集約点
// ============================================
type HubLeaf = {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number }>;
  soon?: boolean;
};

type HubGroup = {
  id: string;
  label: string;
  items: HubLeaf[];
};

const HUB_TREE: HubGroup[] = [
  {
    id: 'communication',
    label: 'Communication',
    items: [
      { id: 'chat', label: 'Chat', description: 'チーム会話 → Brief 化', icon: MessageSquare, soon: true },
      { id: 'meetings', label: 'Meetings', description: '会議ノート → Element 抽出', icon: Video, soon: true },
      { id: 'inbox', label: 'Inbox', description: 'メール / 外部受信をまとめる', icon: InboxIcon, soon: true },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      { id: 'ai-assistant', label: 'AI Assistant', description: 'AI と対話して整理', icon: Bot, soon: true },
      { id: 'integrations', label: 'Integrations', description: 'Slack / GitHub など外部連携', icon: Plug, soon: true },
    ],
  },
];

function findHubLeaf(id: string | null): HubLeaf | null {
  if (!id) return null;
  for (const group of HUB_TREE) {
    for (const leaf of group.items) if (leaf.id === id) return leaf;
  }
  return null;
}

function HubSidebar({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const total = HUB_TREE.reduce((n, g) => n + g.items.length, 0);
  return (
    <div className="w-52 flex-shrink-0 flex flex-col overflow-hidden bg-transparent">
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-3 flex-shrink-0">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Hub
        </span>
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">
          {total}
        </span>
      </div>

      {/* Grouped tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        {HUB_TREE.map((group) => (
          <div key={group.id} className="mb-3">
            {/* Group header (bold, non-selectable) */}
            <div className="w-full flex items-center gap-2 h-[26px] px-2 mx-1 text-foreground">
              <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground">
                <NavHubIcon size={13} />
              </div>
              <span className="text-[13px] font-semibold truncate">{group.label}</span>
            </div>

            {/* Leaves */}
            {group.items.map((leaf) => {
              const Icon = leaf.icon;
              const isSelected = leaf.id === selectedId;
              return (
                <button
                  key={leaf.id}
                  type="button"
                  onClick={() => onSelect(leaf.id)}
                  className={`w-full flex items-center gap-2 h-[26px] pl-6 pr-2 mx-1 rounded-md transition-colors ${
                    isSelected
                      ? 'bg-accent text-foreground'
                      : 'text-foreground/75 hover:bg-muted/40'
                  }`}
                  title={leaf.label}
                >
                  <div className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 text-muted-foreground/70">
                    <Icon size={11} />
                  </div>
                  <span className="text-[12px] truncate flex-1 text-left">{leaf.label}</span>
                  {leaf.soon && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-muted text-muted-foreground/80 uppercase tracking-wider shrink-0">
                      Soon
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function HubEmpty() {
  return (
    <div className="h-full flex items-center justify-center bg-card">
      <div className="text-center max-w-sm px-6">
        <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center rounded-xl bg-muted text-foreground/60">
          <NavHubIcon size={24} />
        </div>
        <h2 className="text-[15px] font-semibold text-foreground mb-1">Hub</h2>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          外部の会話・メール・会議・AI 対話を取り込み、Brief や Element に落とす入口。左から機能を選択してください。
        </p>
      </div>
    </div>
  );
}

function HubLeafView({ leaf }: { leaf: HubLeaf }) {
  const Icon = leaf.icon;
  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-muted text-foreground/70 shrink-0">
            <Icon size={20} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground tracking-tight">{leaf.label}</h1>
              {leaf.soon && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider">
                  Soon
                </span>
              )}
            </div>
            <p className="text-[13px] text-muted-foreground mt-0.5">{leaf.description}</p>
          </div>
        </div>

        <div className="mt-6 border border-dashed border-border rounded-lg p-8 bg-muted/20">
          <p className="text-[12px] text-muted-foreground/80 text-center">
            この機能は準備中です。実装されると、ここから {leaf.label} のデータを閲覧・
            Brief/Element に変換できるようになります。
          </p>
        </div>
      </div>
    </div>
  );
}

export function HubView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const leaf = findHubLeaf(selectedId);

  return (
    <div className="h-full flex overflow-hidden bg-card">
      <HubSidebar selectedId={selectedId} onSelect={setSelectedId} />
      <div className="flex-1 overflow-hidden border-l border-border">
        {leaf ? <HubLeafView leaf={leaf} /> : <HubEmpty />}
      </div>
    </div>
  );
}
