'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  CommentAvatar,
  CommentBubble,
  CommentComposer,
} from '@/alcon/shared/CommentThread';
import {
  createStrategyComment,
  deleteStrategyComment,
  useStrategyComments,
  type Worker,
} from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';

// =============================================================
// A Campaign's thread.
//
// This is where a Campaign stops being a document someone wrote once and
// starts being a place where the intent is kept true — "this assumption no
// longer holds" belongs here, next to the assumption, not overwritten on top
// of it. It is also the Campaign's inbound channel: agents report into the
// same thread over the API, and @naming someone is what turns a report into
// a notification (an agent's comment reaches nobody it did not name).
// =============================================================

export function StrategyCommentsPanel({
  strategyId,
  strategyName,
  strategyOwnerId,
  workers,
}: {
  strategyId: string;
  strategyName: string;
  /** strategies.created_by — the Campaign's owner may clear any comment,
   *  including an agent's (nobody else can: an agent has no auth user to
   *  match against). Mirrors the delete policy so the button is only shown
   *  where the database would actually allow it. */
  strategyOwnerId: string | null;
  /** For @mention autocomplete — every Worker in the Space, since a
   *  Campaign's Objects can span Domains. */
  workers: Worker[];
}) {
  const { user, profile } = useAuthContext();
  const { comments, reload, setComments } = useStrategyComments(strategyId);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(0);

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

  const mentionCandidates = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    return workers
      .filter((w) => w.type === 'human' && w.user_id)
      .filter((w) => !q || w.name.toLowerCase().includes(q) || (w.email || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionQuery, workers]);

  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);
    const upto = value.slice(0, e.target.selectionStart);
    const m = upto.match(/(^|\s)@([\w.\-]*)$/);
    if (m) {
      setMentionOpen(true);
      setMentionQuery(m[2]);
      setMentionStart(e.target.selectionStart - m[2].length - 1); // the '@'
    } else {
      setMentionOpen(false);
    }
  };

  const insertMention = (worker: Worker) => {
    if (!mentionOpen) return;
    const before = draft.slice(0, mentionStart);
    const after = draft.slice(mentionStart + 1 + mentionQuery.length);
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
    const content = draft.trim();
    if (!content || submitting) return;
    setSubmitting(true);
    const restore = draft;
    try {
      const created = await createStrategyComment({
        strategy_id: strategyId,
        author_id: user?.id ?? null,
        author_kind: 'human',
        author_name: profile?.display_name || user?.email?.split('@')[0] || 'You',
        content,
        mentions: extractMentions(content),
      });
      // Only clear the draft once the row exists — a failed post that wiped
      // what you typed would be worse than the failure.
      setComments((prev) => [...prev, created]);
      setDraft('');
    } catch (e) {
      console.error('Failed to post Campaign comment:', e);
      setDraft(restore);
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (id: string) => {
    const snapshot = comments;
    setComments((prev) => prev.filter((c) => c.id !== id));
    try {
      await deleteStrategyComment(id);
    } catch (e) {
      console.error('Failed to delete Campaign comment:', e);
      setComments(snapshot); // put it back rather than lie about the delete
      reload();
    }
  };

  const canModerate = !!user?.id && user.id === strategyOwnerId;

  return (
    <div className="space-y-3">
      {comments.length > 0 && (
        <ul className="space-y-2.5">
          {comments.map((c) => {
            const isAi = c.author_kind === 'ai_agent';
            const isMine = !!user?.id && c.author_id === user.id && c.author_kind === 'human';
            const authorWorker = c.author_id
              ? (isAi ? workerById.get(c.author_id) : workerByUserId.get(c.author_id))
              : undefined;
            return (
              <li key={c.id}>
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
                  actions={isMine || canModerate ? (
                    <button
                      type="button"
                      onClick={() => onDelete(c.id)}
                      className="p-1 text-muted-foreground hover:text-destructive"
                      title="Delete"
                    >
                      <X size={11} />
                    </button>
                  ) : null}
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
        placeholder={`Comment on ${strategyName}…`}
        onKeyDown={(e) => {
          // Escape drops the mention list first; a second one is the
          // surrounding page's to handle.
          if (e.key === 'Escape' && mentionOpen) {
            e.preventDefault();
            setMentionOpen(false);
          }
        }}
      >
        {mentionOpen && mentionCandidates.length > 0 && (
          <div className="absolute left-0 bottom-full mb-1 z-20 w-64 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
            {mentionCandidates.map((w) => (
              <button
                type="button"
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
