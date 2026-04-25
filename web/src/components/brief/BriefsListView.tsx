'use client';

import { useMemo, useState } from 'react';
import type { Brief } from './types';

interface BriefsListViewProps {
  briefs: Brief[];
  onSelectBrief: (id: string) => void;
  onOpenSource: (fileId: string) => void;
  onDelete: (id: string) => void;
}

type SortKey = 'newest' | 'oldest' | 'title';

export function BriefsListView({ briefs, onSelectBrief, onOpenSource, onDelete }: BriefsListViewProps) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('newest');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? briefs.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.summary.toLowerCase().includes(q) ||
            t.sourceFileName.toLowerCase().includes(q)
        )
      : briefs;
    const sorted = [...base];
    sorted.sort((a, b) => {
      if (sortKey === 'title') return a.title.localeCompare(b.title);
      if (sortKey === 'oldest') return a.createdAt.localeCompare(b.createdAt);
      return b.createdAt.localeCompare(a.createdAt); // newest
    });
    return sorted;
  }, [briefs, query, sortKey]);

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[var(--card)]">
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-8 pt-12 pb-16">
          {/* Header */}
          <div className="flex items-end justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-[-0.5px]">Briefs</h1>
              <p className="text-[13px] text-muted-foreground mt-1">
                Note から確定したスナップショット — {briefs.length} 件
              </p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 mb-4">
            <div className="relative flex-1 max-w-sm">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title, summary, source…"
                className="w-full bg-background border border-border px-3 py-1.5 text-[13px] outline-none focus:border-foreground/40 placeholder:text-muted-foreground/60"
              />
            </div>
            <div className="flex items-center gap-1 text-[12px]">
              <span className="text-muted-foreground">Sort</span>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="bg-background border border-border px-2 py-1.5 text-foreground outline-none focus:border-foreground/40"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="title">Title</option>
              </select>
            </div>
          </div>

          {/* Management box */}
          <div className="border border-border bg-background">
            {filtered.length === 0 ? (
              <div className="py-14 text-center">
                <p className="text-[13px] text-muted-foreground">
                  {briefs.length === 0
                    ? 'まだ Brief がありません — Note の「Brief」ボタンから作成してください'
                    : 'No commits matched your search.'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((t) => (
                  <li key={t.id} className="group">
                    <div className="flex items-start gap-3 px-4 py-3 hover:bg-accent/40 transition-colors">
                      <BriefDot />
                      <button
                        type="button"
                        onClick={() => onSelectBrief(t.id)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="text-[14px] font-semibold text-foreground truncate">
                          {t.title}
                        </div>
                        {t.summary && (
                          <div className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2 leading-[1.5]">
                            {t.summary}
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80 mt-1.5">
                          <span
                            className="truncate hover:text-foreground hover:underline underline-offset-2 cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenSource(t.sourceFileId);
                            }}
                          >
                            {t.sourceFileName}
                          </span>
                          <span className="opacity-40">·</span>
                          <span>{t.createdBy}</span>
                          <span className="opacity-40">·</span>
                          <span>{formatRelative(t.createdAt)}</span>
                        </div>
                      </button>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => onOpenSource(t.sourceFileId)}
                          className="text-[11px] px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-accent"
                          title="Open source Note"
                        >
                          Open Note
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(t.id)}
                          className="text-[11px] px-2 py-1 text-muted-foreground hover:text-destructive"
                          title="Delete commit"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BriefDot() {
  return (
    <span
      aria-hidden
      className="mt-1.5 w-[8px] h-[8px] shrink-0 rounded-full"
      style={{ backgroundColor: '#8B5CF6' }}
    />
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return `${diffD}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
