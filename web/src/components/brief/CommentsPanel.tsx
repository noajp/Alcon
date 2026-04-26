'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BriefComment } from './types';

interface CommentsPanelProps {
  comments: BriefComment[];
  loading: boolean;
  onSubmit: (content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function CommentsPanel({ comments, loading, onSubmit, onDelete }: CommentsPanelProps) {
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new comments arrive.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [comments.length]);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(text);
      setDraft('');
    } catch (err) {
      setError((err as Error).message || 'Failed to post');
    } finally {
      setSubmitting(false);
    }
  }, [draft, submitting, onSubmit]);

  return (
    <aside className="w-[280px] shrink-0 border-l border-border flex flex-col bg-background/40">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between border-b border-border/60">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Comments
        </span>
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">
          {comments.length}
        </span>
      </div>

      <div ref={listRef} className="flex-1 overflow-auto px-3 py-3">
        {loading ? (
          <div className="text-[12px] text-muted-foreground/60 text-center py-6">Loading…</div>
        ) : comments.length === 0 ? (
          <div className="text-[12px] text-muted-foreground/60 text-center py-6">
            最初のコメントを書きましょう
          </div>
        ) : (
          <ul className="space-y-3">
            {comments.map((c) => (
              <CommentItem key={c.id} comment={c} onDelete={() => onDelete(c.id)} />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border/60 p-2 flex flex-col gap-1">
        {error && <div className="text-[11px] text-destructive px-1">{error}</div>}
        <div className="flex items-end gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="コメントを書く… (⌘+Enterで送信)"
            rows={2}
            className="flex-1 bg-transparent outline-none text-[12px] leading-[1.5] text-foreground/90 placeholder:text-muted-foreground/50 border border-border px-2 py-1.5 focus:border-foreground/40 resize-none"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || submitting}
            className="text-[11px] font-medium px-2 py-1.5 bg-foreground text-background disabled:opacity-30 disabled:cursor-not-allowed h-fit"
          >
            {submitting ? '...' : 'Post'}
          </button>
        </div>
      </div>
    </aside>
  );
}

function CommentItem({ comment, onDelete }: { comment: BriefComment; onDelete: () => void }) {
  const isAi = comment.authorKind === 'ai_agent';
  return (
    <li className="group flex gap-2.5 text-[12px]">
      <span
        aria-hidden
        className="mt-1 w-[8px] h-[8px] shrink-0 rounded-full"
        style={{ backgroundColor: isAi ? '#8B5CF6' : '#3B82F6' }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-foreground/90 font-medium truncate">
            {comment.authorName ?? (isAi ? 'Claude' : 'You')}
          </span>
          {isAi && (
            <span className="text-[9px] uppercase tracking-wider px-1 bg-accent text-muted-foreground">
              AI
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
            {formatRelative(comment.createdAt)}
          </span>
          <button
            type="button"
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-destructive ml-1"
            aria-label="Delete comment"
            title="Delete"
          >
            <XIcon />
          </button>
        </div>
        <div className="text-foreground/85 whitespace-pre-wrap break-words leading-[1.5]">
          {comment.content}
        </div>
      </div>
    </li>
  );
}

function XIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
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
