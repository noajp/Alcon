'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ChevronRight, Pin, Trash2 } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { agentMention, foldAgentRuns, plainFirstLine } from './agent/commentAgent';
import { CommentAvatar, CommentComposer, CommentEntry, CommentMenu, CommentMenuItem, CommentMenuSeparator } from '@/Function/shared/CommentThread';
import {
  useElementComments,
  createElementComment,
  deleteElementComment,
  updateElementComment,
  fetchCommentReactions,
  toggleReaction,
  type ElementComment,
  type AgentStartOutcome,
  type ElementReaction,
  type Worker,
} from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { getCachedSendCommentShortcut, getCachedDisplayNames, getCachedConvertEmoticons, formatDisplayName, convertEmoticons, usePreference } from '@/Function/settings/preferencesStore';

interface ElementCommentsPanelProps {
  elementId: string;
  workers: Worker[];           // for @mentions autocomplete
  onCountChange?: (n: number) => void;
  /** Arrived here from a notification about one particular comment: bring it
   *  into view and mark it, so the thread opens at the line that was
   *  announced rather than at the bottom of a hundred agent reports. */
  focusCommentId?: string | null;
  /** A comment addressed to an agent ("@AI", "@<AI Worker>") becomes its
   *  next instruction; the agent answers under that comment. */
  onAskAgent?: (ask: { prompt: string; commentId: string; workerId: string | null }) => Promise<AgentStartOutcome>;
  /** Changes when the agent's run moves on; the thread re-reads its comments. */
  refreshKey?: string | null;
}

interface MentionCandidate {
  key: string;
  label: string;
  /** What follows the @ in the draft. */
  insert: string;
  kind: 'agent' | 'person';
  hint: string | null;
}

const QUICK_EMOJI = ['👍', '🎉', '❤️', '👀', '🚀', '✅'];

export function ElementCommentsPanel({ elementId, workers, onCountChange, focusCommentId, onAskAgent, refreshKey }: ElementCommentsPanelProps) {
  const { t } = useI18n();
  const aiWorkers = useMemo(() => workers.filter((w) => w.type === 'ai_agent').map((w) => ({ id: w.id, name: w.name })), [workers]);
  const humanNames = useMemo(() => workers.filter((w) => w.type === 'human').map((w) => w.name), [workers]);
  const [askOutcome, setAskOutcome] = useState<AgentStartOutcome | null>(null);
  const [openFolds, setOpenFolds] = useState<Set<string>>(new Set());
  const { user, profile } = useAuthContext();
  const { comments, loading, reload, setComments } = useElementComments(elementId);
  // The agent posts as it works: re-read when its run moves on, without
  // remounting (a half-written comment and open folds stay as they are).
  useEffect(() => { if (refreshKey) void reload(); }, [refreshKey, reload]);
  const [reactions, setReactions] = useState<Record<string, ElementReaction[]>>({});
  const [draft, setDraft] = useState('');
  // Read once — this is a localStorage hit, and `draft` changes on every
  // keystroke, so an inline call in JSX would re-read on every character typed.
  const sendShortcut = usePreference(getCachedSendCommentShortcut);
  const [submitting, setSubmitting] = useState(false);

  // @ mention autocomplete state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
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

  // The @ list: the agent first (@AI, then this Element's AI Workers by
  // name), then people. Picking an agent turns the comment into its next
  // instruction (agentMention); picking a person notifies them.
  const mentionCandidates = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    const matches = (name: string, extra?: string | null) =>
      !q || name.toLowerCase().includes(q) || (extra || '').toLowerCase().includes(q);
    const agents: MentionCandidate[] = onAskAgent
      ? [
          { key: 'ai', label: 'AI', insert: 'AI', kind: 'agent' as const, hint: t('Ask the agent') },
          ...workers.filter(w => w.type === 'ai_agent')
            .map(w => ({ key: w.id, label: w.name, insert: w.name, kind: 'agent' as const, hint: t('Ask the agent') })),
        ].filter(c => matches(c.label))
      : [];
    const people: MentionCandidate[] = workers
      .filter(w => w.type === 'human' && w.user_id && matches(w.name, w.email))
      .map(w => ({ key: w.id, label: w.name, insert: w.name, kind: 'person' as const, hint: w.email ?? null }));
    return [...agents, ...people].slice(0, 7);
  }, [mentionQuery, workers, onAskAgent, t]);
  const mentionListOpen = mentionOpen && mentionCandidates.length > 0;

  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);
    const cursor = e.target.selectionStart;
    const upto = value.slice(0, cursor);
    const m = upto.match(/(^|\s)@([\w.\-]*)$/);
    if (m) {
      setMentionOpen(true);
      setMentionQuery(m[2]);
      setMentionIndex(0);
      setMentionStart(cursor - m[2].length - 1); // position of '@'
    } else {
      setMentionOpen(false);
    }
  };

  const insertMention = (candidate: MentionCandidate) => {
    if (!mentionOpen) return;
    const before = draft.slice(0, mentionStart);
    const afterStart = mentionStart + 1 + mentionQuery.length;
    const after = draft.slice(afterStart);
    setDraft(`${before}@${candidate.insert} ${after}`);
    setMentionOpen(false);
    setMentionQuery('');
  };

  // While the @ list shows, ↑ / ↓ move, Enter or Tab picks, Esc closes.
  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!mentionListOpen || e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setMentionIndex(i => (i + step + mentionCandidates.length) % mentionCandidates.length);
    } else if ((e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') {
      e.preventDefault();
      insertMention(mentionCandidates[Math.min(mentionIndex, mentionCandidates.length - 1)]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setMentionOpen(false);
    }
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

      const ask = onAskAgent ? agentMention(content, aiWorkers, humanNames) : null;
      setAskOutcome(null);
      if (ask && onAskAgent) void onAskAgent({ prompt: content, commentId: created.id, workerId: ask.workerId }).then(setAskOutcome);

      // Mentioned people are notified by the element_comments trigger
      // (notify_element_comment) from the `mentions` written above.
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

  const renderComment = (c: ElementComment) => {
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
                <CommentEntry
                  comment={c}
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
                    <div className="flex flex-wrap gap-1 mt-1.5">
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
                    <CommentMenu align="end">
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
                          {/* Only a comment's author may delete it (RLS). */}
                          {!!user?.id && c.author_id === user.id && (
                            <CommentMenuItem
                              icon={<Trash2 size={12} />}
                              label="Delete"
                              onClick={() => { onDelete(c.id); close(); }}
                              destructive
                            />
                          )}
                        </>
                      )}
                    </CommentMenu>
                  }
                />
              </li>
            );
};

  return (
    <div className="space-y-3">
      {/* Comment list — chat bubble style (own → right, others → left). */}
      {loading ? (
        <div className="text-center py-4 text-muted-foreground text-[12px]">Loading…</div>
      ) : sorted.length === 0 ? (
        null
      ) : (
        <ul className="space-y-5">
          {foldAgentRuns(sorted, 4, focusCommentId).map(seg => {
            if (seg.kind === 'one') return renderComment(seg.comment);
            const open = openFolds.has(seg.key);
            return (
              <li key={`fold-${seg.key}`}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenFolds(prev => { const next = new Set(prev); if (next.has(seg.key)) next.delete(seg.key); else next.add(seg.key); return next; })}
                  className="mb-3 flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                >
                  <ChevronRight size={13} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                  <span className="shrink-0">{t('AI conversation · {n} messages', { n: seg.hidden.length + 1 })}</span>
                  <span className="truncate">{t('Latest: {s}', { s: plainFirstLine(seg.last.content) })}</span>
                </button>
                <ul className="space-y-5">
                  {open && seg.hidden.map(c => renderComment(c))}
                  {renderComment(seg.last)}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      {askOutcome === 'busy' && (
        <p className="text-[12px] text-muted-foreground">{t('The agent is already working on this Element. Stop it or wait for it to finish, then ask again.')}</p>
      )}
      {askOutcome === 'failed' && <p className="text-[12px] text-[var(--status-danger)]">{t('The agent could not start. See the agent panel above.')}</p>}
      <CommentComposer
        value={draft}
        onChange={handleDraftChange}
        onSubmit={submit}
        submitting={submitting}
        enterHeldBy={mentionListOpen}
        onKeyDown={onComposerKeyDown}
        placeholder={onAskAgent ? t('Leave a comment… @AI asks the agent') : undefined}
        sendShortcut={sendShortcut}
      >
        {mentionListOpen && (
          <div role="listbox" className="absolute left-0 bottom-full mb-1 z-20 w-64 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
            {mentionCandidates.map((c, i) => (
              <button
                key={c.key}
                type="button"
                role="option"
                aria-selected={i === mentionIndex}
                onMouseEnter={() => setMentionIndex(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertMention(c)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left ${i === mentionIndex ? 'bg-accent' : 'hover:bg-accent'}`}
              >
                <div className="w-6 h-6 rounded-full bg-primary/10 text-[11px] font-medium text-primary flex items-center justify-center shrink-0">
                  {c.kind === 'agent' ? <Bot size={13} /> : c.label.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground truncate">{c.label}</div>
                  {c.hint && <div className="text-[11px] text-muted-foreground truncate">{c.hint}</div>}
                </div>
              </button>
            ))}
          </div>
        )}
      </CommentComposer>
    </div>
  );
}
