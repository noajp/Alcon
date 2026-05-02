'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Smile, Pin, Send } from 'lucide-react';
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

  // @ mention autocomplete state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(0);

  useEffect(() => { onCountChange?.(comments.length); }, [comments.length, onCountChange]);

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
    <div className="rounded-xl border border-border p-4">
      {/* Composer */}
      <div className="flex gap-3 mb-4 relative">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary flex-shrink-0">
          {(profile?.display_name || user?.email || 'Y').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <textarea
            value={draft}
            onChange={handleDraftChange}
            placeholder="Write a comment… (@ to mention, ⌘+Enter to send)"
            className="w-full text-[13px] bg-muted/30 border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none min-h-[60px]"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
          />
          {mentionOpen && mentionCandidates.length > 0 && (
            <div className="absolute left-11 top-full mt-1 z-20 w-64 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
              {mentionCandidates.map(w => (
                <button
                  key={w.id}
                  onClick={() => insertMention(w)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-accent text-left"
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
          <div className="flex justify-end mt-2">
            <button
              onClick={submit}
              disabled={!draft.trim() || submitting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Send size={12} />
              {submitting ? 'Posting…' : 'Comment'}
            </button>
          </div>
        </div>
      </div>

      {/* Comment list */}
      {loading ? (
        <div className="text-center py-6 text-muted-foreground text-[13px]">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-[13px]">No comments yet. Start the conversation!</div>
      ) : (
        <ul className="space-y-4 border-t border-border pt-4">
          {sorted.map(c => {
            const myReactions = (reactions[c.id] || []).filter(r => r.user_id === user?.id).map(r => r.emoji);
            const counts: Record<string, number> = {};
            for (const r of (reactions[c.id] || [])) counts[r.emoji] = (counts[r.emoji] || 0) + 1;
            const isAi = c.author_kind === 'ai_agent';

            return (
              <li key={c.id} className="group flex gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 ${isAi ? 'bg-purple-500/15 text-purple-300' : 'bg-muted text-muted-foreground'}`}>
                  {(c.author_name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[13px] font-medium text-foreground">{c.author_name || 'Unknown'}</span>
                    {isAi && <span className="text-[9px] uppercase tracking-wider px-1 bg-purple-500/15 text-purple-300 rounded">AI</span>}
                    {c.is_pinned && <Pin size={10} className="text-amber-400" />}
                    <span className="text-[11px] text-muted-foreground">{formatRelative(c.created_at)}</span>
                    <div className="ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                      <ReactionPicker onPick={(emoji) => onReact(c.id, emoji)} />
                      <button
                        onClick={() => onTogglePin(c)}
                        className="p-1 text-muted-foreground hover:text-amber-400"
                        title={c.is_pinned ? 'Unpin' : 'Pin'}
                      >
                        <Pin size={12} />
                      </button>
                      <button
                        onClick={() => onDelete(c.id)}
                        className="p-1 text-muted-foreground hover:text-destructive"
                        title="Delete"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                  <p className="text-[13px] text-foreground/80 whitespace-pre-wrap break-words leading-[1.5]">
                    {renderWithMentions(c.content)}
                  </p>
                  {Object.keys(counts).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {Object.entries(counts).map(([emoji, n]) => {
                        const mine = myReactions.includes(emoji);
                        return (
                          <button
                            key={emoji}
                            onClick={() => onReact(c.id, emoji)}
                            className={`text-[12px] px-1.5 py-0.5 rounded-full border transition-colors ${
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
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="p-1 text-muted-foreground hover:text-foreground"
        title="React"
      >
        <Smile size={12} />
      </button>
      {open && (
        <div
          onMouseLeave={() => setOpen(false)}
          className="absolute right-0 top-full mt-1 z-20 bg-popover border border-border rounded-md shadow-lg flex p-1 gap-0.5"
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
