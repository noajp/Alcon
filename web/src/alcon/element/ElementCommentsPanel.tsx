'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Smile, Pin } from 'lucide-react';
import { SendIcon } from '@/alcon/shared/SendIcon';
import {
  useElementComments,
  createElementComment,
  deleteElementComment,
  updateElementComment,
  fetchCommentReactions,
  toggleReaction,
  notifyMany,
  type ElementComment,
  type ElementReaction,
  type Worker,
} from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { WorkerAvatar } from '@/alcon/shared/WorkerAvatar';

interface ElementCommentsPanelProps {
  elementId: string;
  elementTitle: string;
  workers: Worker[];           // for @mentions autocomplete
  onCountChange?: (n: number) => void;
}

const QUICK_EMOJI = ['👍', '🎉', '❤️', '👀', '🚀', '✅'];

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function ElementCommentsPanel({ elementId, elementTitle, workers, onCountChange }: ElementCommentsPanelProps) {
  const { user, profile } = useAuthContext();
  const { comments, loading, reload, setComments } = useElementComments(elementId);
  const [reactions, setReactions] = useState<Record<string, ElementReaction[]>>({});
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // @ mention autocomplete state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(0);

  useEffect(() => { onCountChange?.(comments.length); }, [comments.length, onCountChange]);

  // Resolve a comment's author to a Worker so its avatar photo matches the
  // one shown everywhere else (assignee chips, Lead, mention list). Comments
  // only store author_id + author_name, not avatar_url — human authors link
  // by auth user_id, AI agents by worker id.
  const workerByUserId = useMemo(() => {
    const m = new Map<string, Worker>();
    for (const w of workers) if (w.user_id) m.set(w.user_id, w);
    return m;
  }, [workers]);
  const workerById = useMemo(() => {
    const m = new Map<string, Worker>();
    for (const w of workers) m.set(w.id, w);
    return m;
  }, [workers]);

  // Auto-grow the composer to fit its content (capped), and shrink it back
  // once the draft is cleared on submit. Runs after render so it sees the
  // committed value — covers typing, mention inserts and the post-send reset.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`;
  }, [draft]);

  // Load reactions for visible comments
  useEffect(() => {
    if (comments.length === 0) { setReactions({}); return; }
    let cancelled = false;
    fetchCommentReactions(comments.map(c => c.id))
      .then(rows => {
        if (cancelled) return;
        const grouped: Record<string, ElementReaction[]> = {};
        for (const r of rows) {
          if (!r.comment_id) continue;
          (grouped[r.comment_id] ||= []).push(r);
        }
        setReactions(grouped);
      })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [comments]);

  const mentionCandidates = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    return workers
      .filter(w => w.type === 'human' && w.user_id)
      .filter(w => !q || w.name.toLowerCase().includes(q) || (w.email || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionQuery, workers]);

  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);
    const cursor = e.target.selectionStart;
    const upto = value.slice(0, cursor);
    const m = upto.match(/(^|\s)@([\w.\-]*)$/);
    if (m) {
      setMentionOpen(true);
      setMentionQuery(m[2]);
      setMentionStart(cursor - m[2].length - 1); // position of '@'
    } else {
      setMentionOpen(false);
    }
  };

  const insertMention = (worker: Worker) => {
    if (!mentionOpen) return;
    const before = draft.slice(0, mentionStart);
    const afterStart = mentionStart + 1 + mentionQuery.length;
    const after = draft.slice(afterStart);
    setDraft(`${before}@${worker.name} ${after}`);
    setMentionOpen(false);
    setMentionQuery('');
  };

  const extractMentions = (text: string): string[] => {
    const ids = new Set<string>();
    for (const w of workers) {
      if (!w.user_id) continue;
      const re = new RegExp(`@${w.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (re.test(text)) ids.add(w.user_id);
    }
    return Array.from(ids);
  };

  const submit = async () => {
    if (!draft.trim() || submitting) return;
    setSubmitting(true);
    try {
      const mentions = extractMentions(draft);
      const authorName = profile?.display_name || user?.email?.split('@')[0] || 'You';
      const created = await createElementComment({
        element_id: elementId,
        author_id: user?.id ?? null,
        author_kind: 'human',
        author_name: authorName,
        content: draft.trim(),
        mentions,
      });
      setComments(prev => [...prev, created]);
      setDraft('');

      if (mentions.length > 0) {
        await notifyMany(mentions, {
          actor_id: user?.id ?? null,
          actor_name: authorName,
          kind: 'mention',
          element_id: elementId,
          comment_id: created.id,
          title: `${authorName} mentioned you`,
          body: `In "${elementTitle}": ${draft.trim().slice(0, 140)}`,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (id: string) => {
    setComments(prev => prev.filter(c => c.id !== id));
    try { await deleteElementComment(id); }
    catch (e) { console.error(e); reload(); }
  };

  const onTogglePin = async (c: ElementComment) => {
    setComments(prev => prev.map(x => x.id === c.id ? { ...x, is_pinned: !x.is_pinned } : x));
    try { await updateElementComment(c.id, { is_pinned: !c.is_pinned }); }
    catch (e) { console.error(e); reload(); }
  };

  const onReact = async (commentId: string, emoji: string) => {
    if (!user) return;
    const existing = (reactions[commentId] || []).find(r => r.user_id === user.id && r.emoji === emoji);
    setReactions(prev => {
      const list = [...(prev[commentId] || [])];
      if (existing) {
        return { ...prev, [commentId]: list.filter(r => r.id !== existing.id) };
      }
      return {
        ...prev,
        [commentId]: [...list, {
          id: `tmp-${Date.now()}`,
          comment_id: commentId,
          element_id: null,
          user_id: user.id,
          emoji,
          created_at: new Date().toISOString(),
        }],
      };
    });
    try {
      await toggleReaction({ userId: user.id, emoji, commentId });
      const fresh = await fetchCommentReactions(comments.map(c => c.id));
      const grouped: Record<string, ElementReaction[]> = {};
      for (const r of fresh) if (r.comment_id) (grouped[r.comment_id] ||= []).push(r);
      setReactions(grouped);
    } catch (e) { console.error(e); }
  };

  const sorted = useMemo(() => {
    return [...comments].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return a.created_at.localeCompare(b.created_at);
    });
  }, [comments]);

  return (
    <div className="space-y-3">
      {/* Comment list — chat bubble style (own → right, others → left). */}
      {loading ? (
        <div className="text-center py-4 text-muted-foreground text-[12px]">Loading…</div>
      ) : sorted.length === 0 ? (
        null
      ) : (
        <ul className="space-y-2.5">
          {sorted.map(c => {
            const myReactions = (reactions[c.id] || []).filter(r => r.user_id === user?.id).map(r => r.emoji);
            const counts: Record<string, number> = {};
            for (const r of (reactions[c.id] || [])) counts[r.emoji] = (counts[r.emoji] || 0) + 1;
            const isAi = c.author_kind === 'ai_agent';
            const isMine = !!user?.id && c.author_id === user.id && c.author_kind === 'human';

            // Resolve the author's real avatar (humans by user_id, AI by
            // worker id). Show the shared WorkerAvatar photo when we have one;
            // otherwise keep the colour-coded initial fallback.
            const authorWorker = c.author_id
              ? (isAi ? workerById.get(c.author_id) : workerByUserId.get(c.author_id))
              : undefined;
            const avatar = authorWorker?.avatar_url ? (
              <WorkerAvatar
                worker={{ name: c.author_name ?? authorWorker.name, avatar_url: authorWorker.avatar_url }}
                size={28}
                className="flex-shrink-0"
              />
            ) : (
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium flex-shrink-0 ${
                isAi
                  ? 'bg-purple-500/15 text-purple-300'
                  : isMine
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {(c.author_name || '?').charAt(0).toUpperCase()}
              </div>
            );

            return (
              <li
                key={c.id}
                className={`group flex gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}
              >
                {avatar}
                <div className={`flex flex-col max-w-[78%] min-w-0 ${isMine ? 'items-end' : 'items-start'}`}>
                  <div className={`flex items-center gap-1.5 mb-0.5 text-[10px] text-muted-foreground ${isMine ? 'flex-row-reverse' : ''}`}>
                    <span className="font-medium text-foreground/85">{c.author_name || 'Unknown'}</span>
                    {isAi && <span className="text-[9px] uppercase tracking-wider px-1 bg-purple-500/15 text-purple-300 rounded">AI</span>}
                    {c.is_pinned && <Pin size={9} className="text-amber-400" />}
                    <span>{formatRelative(c.created_at)}</span>
                  </div>
                  <div
                    className={`relative px-3 py-1.5 rounded-2xl text-[12px] leading-[1.5] whitespace-pre-wrap break-words ${
                      isMine
                        ? 'bg-primary/15 text-foreground rounded-tr-sm'
                        : 'bg-muted/60 text-foreground/90 rounded-tl-sm'
                    }`}
                  >
                    {renderWithMentions(c.content)}
                  </div>
                  {Object.keys(counts).length > 0 && (
                    <div className={`flex flex-wrap gap-1 mt-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                      {Object.entries(counts).map(([emoji, n]) => {
                        const mine = myReactions.includes(emoji);
                        return (
                          <button
                            key={emoji}
                            onClick={() => onReact(c.id, emoji)}
                            className={`text-[11px] px-1.5 py-0.5 rounded-full border transition-colors ${
                              mine
                                ? 'bg-primary/15 border-primary/30 text-foreground'
                                : 'bg-muted/40 border-border hover:bg-muted'
                            }`}
                          >
                            <span className="mr-1">{emoji}</span>
                            <span className="tabular-nums">{n}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className={`opacity-0 group-hover:opacity-100 flex items-center gap-0.5 mt-0.5 transition-opacity ${isMine ? 'flex-row-reverse' : ''}`}>
                    <ReactionPicker onPick={(emoji) => onReact(c.id, emoji)} align={isMine ? 'right' : 'left'} />
                    <button
                      onClick={() => onTogglePin(c)}
                      className="p-1 text-muted-foreground hover:text-amber-400"
                      title={c.is_pinned ? 'Unpin' : 'Pin'}
                    >
                      <Pin size={11} />
                    </button>
                    <button
                      onClick={() => onDelete(c.id)}
                      className="p-1 text-muted-foreground hover:text-destructive"
                      title="Delete"
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Composer — unified with the Chat composer's card style (rounded-2xl
          card + border + shadow, transparent textarea, round send button).
          Comments don't support attachments, so there's no paperclip; the
          rest of the chrome matches Chat so both inputs read as one family. */}
      <div className="pt-1 relative">
        <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-rail)] border border-border/30 shadow-[var(--shadow-island)] px-3 py-2">
          <textarea
            ref={taRef}
            value={draft}
            onChange={handleDraftChange}
            placeholder="Leave a comment…"
            rows={1}
            className="flex-1 resize-none bg-transparent outline-none text-[13px] text-foreground placeholder:text-muted-foreground/70 max-h-40 no-focus-ring"
            onKeyDown={(e) => {
              // Enter sends — but never while an IME is mid-composition
              // (Japanese/Chinese conversion) or while the @mention list is
              // open, where Enter is confirming a choice, not the comment.
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                !mentionOpen
              ) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button
            onClick={submit}
            disabled={!draft.trim() || submitting}
            aria-label="Send"
            className="h-7 px-2.5 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            <SendIcon size={14} />
          </button>
        </div>
        {mentionOpen && mentionCandidates.length > 0 && (
          <div className="absolute left-0 bottom-full mb-1 z-20 w-64 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
            {mentionCandidates.map(w => (
              <button
                key={w.id}
                onClick={() => insertMention(w)}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12px] hover:bg-accent text-left"
              >
                <div className="w-6 h-6 rounded-full bg-primary/10 text-[11px] font-medium text-primary flex items-center justify-center">
                  {w.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground truncate">{w.name}</div>
                  {w.email && <div className="text-[11px] text-muted-foreground truncate">{w.email}</div>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReactionPicker({ onPick, align = 'right' }: { onPick: (emoji: string) => void; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="p-1 text-muted-foreground hover:text-foreground"
        title="React"
      >
        <Smile size={11} />
      </button>
      {open && (
        <div
          onMouseLeave={() => setOpen(false)}
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 z-20 bg-popover border border-border rounded-md shadow-lg flex p-1 gap-0.5`}
        >
          {QUICK_EMOJI.map(e => (
            <button
              key={e}
              onClick={() => { onPick(e); setOpen(false); }}
              className="w-7 h-7 hover:bg-accent rounded text-base"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function renderWithMentions(text: string): React.ReactNode {
  const parts = text.split(/(@[\w.\-]+(?:\s\w+)?)/g);
  return parts.map((p, i) =>
    p.startsWith('@')
      ? <span key={i} className="text-primary font-medium">{p}</span>
      : <span key={i}>{p}</span>
  );
}
