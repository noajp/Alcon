'use client';

import { useMemo, useState } from 'react';
import type { Brief } from './types';
import { useBriefComments } from '@/hooks/useNotesDb';
import { BlockEditor } from '@/components/editor/BlockEditor';
import { CommentsPanel } from './CommentsPanel';

interface BriefsListViewProps {
  briefs: Brief[];
  onOpenSource: (fileId: string) => void;
  onDelete: (id: string) => void;
  onObjectize: (briefId: string) => void;
}

type SortKey = 'newest' | 'oldest' | 'title';

export function BriefsListView({
  briefs,
  onOpenSource,
  onDelete,
  onObjectize,
}: BriefsListViewProps) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [selectedId, setSelectedId] = useState<string | null>(briefs[0]?.id ?? null);
  const [sourceOpen, setSourceOpen] = useState(false);

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
      return b.createdAt.localeCompare(a.createdAt);
    });
    return sorted;
  }, [briefs, query, sortKey]);

  // Auto-select first item if current selection drops out (e.g. delete or filter).
  if (selectedId && !filtered.some((b) => b.id === selectedId)) {
    setSelectedId(filtered[0]?.id ?? null);
  }

  const selected = filtered.find((b) => b.id === selectedId) ?? null;

  return (
    <div className="flex-1 flex overflow-hidden bg-card">
      <aside className="w-[300px] shrink-0 border-r border-border flex flex-col bg-background/30">
        <div className="px-4 pt-4 pb-3 border-b border-border/60">
          <h1 className="text-[18px] font-semibold text-foreground tracking-[-0.3px]">Briefs</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Note から確定したスナップショット — {briefs.length} 件
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="flex-1 min-w-0 bg-background border border-border px-2 py-1 text-[12px] outline-none focus:border-foreground/40 placeholder:text-muted-foreground/60"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="bg-background border border-border px-1 py-1 text-[11px] text-foreground outline-none focus:border-foreground/40"
            >
              <option value="newest">New</option>
              <option value="oldest">Old</option>
              <option value="title">A→Z</option>
            </select>
          </div>
        </div>

        <ul className="flex-1 overflow-auto">
          {filtered.length === 0 ? (
            <li className="px-4 py-8 text-[12px] text-muted-foreground/70 text-center">
              {briefs.length === 0 ? 'まだ Brief がありません' : 'ヒットしませんでした'}
            </li>
          ) : (
            filtered.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(b.id)}
                  className={[
                    'w-full text-left px-4 py-3 border-b border-border/40 transition-colors',
                    selectedId === b.id ? 'bg-accent' : 'hover:bg-accent/50',
                  ].join(' ')}
                >
                  <div className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-1.5 w-[6px] h-[6px] shrink-0 rounded-full"
                      style={{ backgroundColor: '#8B5CF6' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-foreground truncate">
                        {b.title}
                      </div>
                      <div className="text-[11px] text-muted-foreground/80 truncate mt-0.5">
                        {b.sourceFileName}
                      </div>
                      <div className="text-[10px] text-muted-foreground/60 mt-0.5 tabular-nums">
                        {formatRelative(b.createdAt)}
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {selected ? (
          <BriefDetail
            key={selected.id}
            brief={selected}
            onOpenSource={() => onOpenSource(selected.sourceFileId)}
            onObjectize={() => onObjectize(selected.id)}
            onDelete={() => onDelete(selected.id)}
            sourceOpen={sourceOpen}
            setSourceOpen={setSourceOpen}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground/60 text-[13px]">
            左から Brief を選んでください
          </div>
        )}
      </main>
    </div>
  );
}

function BriefDetail({
  brief,
  onOpenSource,
  onObjectize,
  onDelete,
  sourceOpen,
  setSourceOpen,
}: {
  brief: Brief;
  onOpenSource: () => void;
  onObjectize: () => void;
  onDelete: () => void;
  sourceOpen: boolean;
  setSourceOpen: (v: boolean) => void;
}) {
  const { comments, loading: commentsLoading, addComment, deleteComment } = useBriefComments(brief.id);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const s = brief.structured;
  const hasStructured =
    !!s &&
    (s.overview ||
      s.decisions.length ||
      s.action_items.length ||
      s.questions.length ||
      s.participants.length);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-4 py-2 flex items-center gap-1.5">
        <ActionButton
          icon={<CommentIcon />}
          label="Comment"
          badge={comments.length || undefined}
          active={commentsOpen}
          onClick={() => setCommentsOpen((v) => !v)}
        />
        <ActionButton icon={<MeetingIcon />} label="Meeting" soon disabled onClick={() => {}} />
        <ActionButton icon={<ObjectIcon />} label="Object化" primary onClick={onObjectize} />
        <div className="ml-auto text-[11px] text-muted-foreground flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSource}
            className="text-foreground/80 hover:text-foreground underline-offset-2 hover:underline"
          >
            {brief.sourceFileName}
          </button>
          <span className="opacity-40">·</span>
          <span>{formatAbsolute(brief.createdAt)}</span>
          <button
            type="button"
            onClick={onDelete}
            className="ml-2 text-muted-foreground/70 hover:text-destructive"
            title="Delete"
            aria-label="Delete"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      <div className="flex-1 flex overflow-hidden">

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-8 pt-8 pb-4">
          <h2 className="text-[22px] font-semibold text-foreground tracking-[-0.4px] leading-[1.2]">
            {brief.title}
          </h2>

          {hasStructured ? (
            <>
              {s!.overview && (
                <p className="mt-3 text-[13px] leading-[1.7] text-foreground/80 whitespace-pre-wrap">
                  {s!.overview}
                </p>
              )}
              {s!.decisions.length > 0 && (
                <Section label="Key Decisions">
                  <ul className="space-y-2">
                    {s!.decisions.map((d, i) => (
                      <BulletItem key={i} title={d.title} detail={d.detail} />
                    ))}
                  </ul>
                </Section>
              )}
              {s!.action_items.length > 0 && (
                <Section label="Action Items">
                  <ul className="space-y-1.5">
                    {s!.action_items.map((a, i) => (
                      <ActionItemRow key={i} title={a.title} owner={a.owner} due={a.due} />
                    ))}
                  </ul>
                </Section>
              )}
              {s!.questions.length > 0 && (
                <Section label="Open Questions">
                  <ul className="space-y-1.5">
                    {s!.questions.map((q, i) => (
                      <QuestionItem key={i} title={q.title} detail={q.detail} />
                    ))}
                  </ul>
                </Section>
              )}
              {s!.participants.length > 0 && (
                <Section label="Participants">
                  <ul className="flex flex-wrap gap-1.5">
                    {s!.participants.map((p, i) => (
                      <ParticipantChip key={i} name={p.name} role={p.role} />
                    ))}
                  </ul>
                </Section>
              )}
            </>
          ) : (
            <p className="mt-3 text-[13px] leading-[1.7] text-foreground/80 whitespace-pre-wrap">
              {brief.summary || <span className="text-muted-foreground/60">No summary</span>}
            </p>
          )}

          {brief.sourceSnapshot && (
            <section className="mt-8 pt-5 border-t border-border/60">
              <button
                type="button"
                onClick={() => setSourceOpen(!sourceOpen)}
                className="w-full flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80 hover:text-foreground"
              >
                <span
                  className={[
                    'w-3 h-3 flex items-center justify-center transition-transform duration-100',
                    sourceOpen ? 'rotate-90' : '',
                  ].join(' ')}
                >
                  <ChevronIcon />
                </span>
                Source Note (at commit time)
              </button>
              {sourceOpen && (
                <div className="mt-3 px-3 py-3 border border-border/50 bg-background/40">
                  <BlockEditor initialContent={brief.sourceSnapshot} editable={false} hideToolbar />
                </div>
              )}
            </section>
          )}
        </div>

      </div>
        {commentsOpen && (
          <CommentsPanel
            comments={comments}
            loading={commentsLoading}
            onSubmit={async (content) => { await addComment(content); }}
            onDelete={deleteComment}
          />
        )}
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  primary,
  disabled,
  soon,
  badge,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  soon?: boolean;
  badge?: number;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 border transition-colors',
        primary
          ? 'border-foreground bg-foreground text-background hover:bg-foreground/90'
          : active
          ? 'border-foreground/60 bg-accent text-foreground'
          : 'border-border hover:border-foreground/40 hover:bg-accent text-foreground/80 hover:text-foreground',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {icon}
      <span>{label}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span className="text-[10px] tabular-nums px-1 ml-0.5 bg-accent text-foreground/80 rounded-sm">
          {badge}
        </span>
      )}
      {soon && (
        <span className="text-[9px] uppercase tracking-wider px-1 ml-0.5 bg-accent text-muted-foreground">
          Soon
        </span>
      )}
    </button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 pt-5 border-t border-border/60">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80 mb-2.5">
        {label}
      </div>
      {children}
    </section>
  );
}

function BulletItem({ title, detail }: { title: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-[7px] w-[5px] h-[5px] shrink-0 rounded-full bg-foreground/50" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-foreground/90 leading-[1.55] break-words">{title}</div>
        {detail && (
          <div className="text-[12px] text-muted-foreground mt-0.5 leading-[1.55] break-words">
            {detail}
          </div>
        )}
      </div>
    </li>
  );
}

function ActionItemRow({ title, owner, due }: { title: string; owner?: string; due?: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-[3px] w-[14px] h-[14px] shrink-0 border border-foreground/40" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-foreground/90 leading-[1.55] break-words">{title}</div>
        {(owner || due) && (
          <div className="text-[11px] text-muted-foreground/80 mt-0.5 flex items-center gap-2">
            {owner && <span>@{owner}</span>}
            {due && <span>⏰ {due}</span>}
          </div>
        )}
      </div>
    </li>
  );
}

function QuestionItem({ title, detail }: { title: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="text-[13px] leading-[1.55] text-foreground/50 shrink-0">?</span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] italic text-foreground/85 leading-[1.55] break-words">
          {title}
        </div>
        {detail && (
          <div className="text-[12px] text-muted-foreground mt-0.5 leading-[1.55] break-words">
            {detail}
          </div>
        )}
      </div>
    </li>
  );
}

function ParticipantChip({ name, role }: { name: string; role?: string }) {
  return (
    <li className="inline-flex items-center gap-1.5 text-[12px] bg-accent/60 px-2 py-1">
      <span className="text-foreground/90">{name}</span>
      {role && <span className="text-muted-foreground/80">· {role}</span>}
    </li>
  );
}

function CommentIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function MeetingIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9a2 2 0 0 1 2-2h11l5 4-5 4H5a2 2 0 0 1-2-2V9z" />
      <line x1="9" y1="13" x2="9" y2="21" />
      <line x1="6" y1="21" x2="12" y2="21" />
    </svg>
  );
}

function ObjectIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
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

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
