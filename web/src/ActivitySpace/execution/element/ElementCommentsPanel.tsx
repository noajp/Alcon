'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pin, Trash2 } from 'lucide-react';
import { CommentAvatar, CommentBubble, CommentComposer, CommentMenu, CommentMenuItem, CommentMenuSeparator } from '@/Function/shared/CommentThread';
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
import { getCachedSendCommentShortcut, getCachedDisplayNames, getCachedConvertEmoticons, formatDisplayName, convertEmoticons, usePreference } from '@/Function/settings/preferencesStore';

interface ElementCommentsPanelProps {
  elementId: string;
  elementTitle: string;
  workers: Worker[];           // for @mentions autocomplete
  onCountChange?: (n: number) => void;
  /** Arrived here from a notification about one particular comment: bring it
   *  into view and mark it, so the thread opens at the line that was
   *  announced rather than at the bottom of a hundred agent reports. */
  focusCommentId?: string | null;
}

const QUICK_EMOJI = ['👍', '🎉', '❤️', '👀', '🚀', '✅'];

export function ElementCommentsPanel({ elementId, elementTitle, workers, onCountChange, focusCommentId }: ElementCommentsPanelProps) {
  const { user, profile } = useAuthContext();
  const { comments, loading, reload, setComments } = useElementComments(elementId);
  const [reactions, setReactions] = useState<Record<string, ElementReaction[]>>({});
  const [draft, setDraft] = useState('');
  // Read once — this is a localStorage hit, and `draft` changes on every
  // keystroke, so an inline call in JSX would re-read on every character typed.
  const sendShortcut = usePreference(getCachedSendCommentShortcut);
  const [submitting, setSubmitting] = useState(false);

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
      const authorName = formatDisplayName(profile?.display_name, user?.email, getCachedDisplayNames());
      const content = getCachedConvertEmoticons() ? convertEmoticons(draft.trim()) : draft.trim();
      const created = await createElementComment({
        element_id: elementId,
        author_id: user?.id ?? null,
        author_kind: 'human',
        author_name: authorName,
        content,
        mentions,
      });
      // The delta stream may have landed the row already.
      setComments(prev => (prev.some(c => c.id === created.id) ? prev : [...prev, created]));
      setDraft('');

      if (mentions.length > 0) {
        await notifyMany(mentions, {
          actor_id: user?.id ?? null,
          actor_name: authorName,
          kind: 'mention',
          element_id: elementId,
          comment_id: created.id,
          title: `${authorName} mentioned you`,
          body: `In "${elementTitle}": ${content.slice(0, 140)}`,
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

  // Scroll the announced comment into view once it exists in the DOM — once,
  // however many times the thread reloads underneath. The mark then fades on
  // its own: it says "this is the one you were sent", and gets out of the way
  // of reading the thread.
  const focusRef = useRef<HTMLLIElement | null>(null);
  const scrolledFor = useRef<string | null>(null);
  const [faded, setFaded] = useState<string | null>(null);
  const marked = focusCommentId && faded !== focusCommentId ? focusCommentId : null;

  useEffect(() => {
    if (!focusCommentId || scrolledFor.current === focusCommentId) return;
    if (!comments.some(c => c.id === focusCommentId)) return;
    scrolledFor.current = focusCommentId;
    focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusCommentId, comments]);

  useEffect(() => {
    if (!focusCommentId) return;
    const t = setTimeout(() => setFaded(focusCommentId), 2400);
    return () => clearTimeout(t);
  }, [focusCommentId]);

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

            // Humans resolve by user_id, agents by worker id — both to the
            // same Worker record, so a comment wears the same face as the
            // assignee chips and the mention list.
            const authorWorker = c.author_id
              ? (isAi ? workerById.get(c.author_id) : workerByUserId.get(c.author_id))
              : undefined;

            return (
              <li
                key={c.id}
                ref={c.id === focusCommentId ? focusRef : undefined}
                data-comment-id={c.id}
                className={
                  marked === c.id
                    ? 'rounded-lg bg-primary/10 -mx-1.5 px-1.5 py-1 transition-colors duration-500'
                    : 'transition-colors duration-500'
                }
              >
                <CommentBubble
                  comment={c}
                  isMine={isMine}
                  avatar={
                    <CommentAvatar
                      name={c.author_name ?? authorWorker?.name ?? null}
                      kind={c.author_kind}
                      isMine={isMine}
                      avatarUrl={authorWorker?.avatar_url}
                    />
                  }
                  meta={c.is_pinned ? <Pin size={9} className="text-amber-400" /> : null}
                  footer={Object.keys(counts).length > 0 ? (
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
                  ) : null}
                  menu={
                    <CommentMenu align={isMine ? 'end' : 'start'}>
                      {(close) => (
                        <>
                          <div className="flex items-center gap-0.5 px-1 py-0.5">
                            {QUICK_EMOJI.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => { onReact(c.id, emoji); close(); }}
                                className="w-6 h-6 flex items-center justify-center hover:bg-[var(--surface-strong)] rounded text-[13px]"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                          <div className={CommentMenuSeparator} />
                          <CommentMenuItem
                            icon={<Pin size={12} />}
                            label={c.is_pinned ? 'Unpin' : 'Pin'}
                            onClick={() => { onTogglePin(c); close(); }}
                          />
                          <CommentMenuItem
                            icon={<Trash2 size={12} />}
                            label="Delete"
                            onClick={() => { onDelete(c.id); close(); }}
                            destructive
                          />
                        </>
                      )}
                    </CommentMenu>
                  }
                />
              </li>
            );
          })}
        </ul>
      )}

      <CommentComposer
        value={draft}
        onChange={handleDraftChange}
        onSubmit={submit}
        submitting={submitting}
        enterHeldBy={mentionOpen}
        sendShortcut={sendShortcut}
      >
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
      </CommentComposer>
    </div>
  );
}
