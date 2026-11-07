'use client';

import { useMemo, useState } from 'react';
import { Trash2 } from '@/ui/icons';
import {
  CommentAvatar,
  CommentEntry,
  CommentComposer,
  CommentMenu,
  CommentMenuItem,
} from '@/Function/shared/CommentThread';
import {
  createStrategyComment,
  deleteStrategyComment,
  useStrategyComments,
  type Worker,
} from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { detectMentionQuery, insertMentionText, mentionedUserIds, rankMentionCandidates } from '@/Function/shared/mentions';
import { getCachedSendCommentShortcut, getCachedDisplayNames, getCachedConvertEmoticons, formatDisplayName, convertEmoticons, usePreference } from '@/Function/settings/preferencesStore';

// =============================================================
// A Strategy's thread.
//
// This is where a Strategy stops being a document someone wrote once and
// starts being a place where the intent is kept true — "this assumption no
// longer holds" belongs here, next to the assumption, not overwritten on top
// of it. It is also the Strategy's inbound channel: agents report into the
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
  /** strategies.created_by — the Strategy's owner may clear any comment,
   *  including an agent's (nobody else can: an agent has no auth user to
   *  match against). Mirrors the delete policy so the button is only shown
   *  where the database would actually allow it. */
  strategyOwnerId: string | null;
  /** For @mention autocomplete — every Worker in the Space, since a
   *  Strategy's Objects can span Domains. */
  workers: Worker[];
}) {
  const { t } = useI18n();
  const { user, profile } = useAuthContext();
  const { comments, reload, setComments } = useStrategyComments(strategyId);
  const [draft, setDraft] = useState('');
  // Read once — this is a localStorage hit, and `draft` changes on every
  // keystroke, so an inline call in JSX would re-read on every character typed.
  const sendShortcut = usePreference(getCachedSendCommentShortcut);
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
  // Every name a mention may carry, so the thread colours it whole.
  const mentionNames = useMemo(() => workers.map((w) => w.name).filter(Boolean) as string[], [workers]);

  const mentionCandidates = useMemo(() => {
    return rankMentionCandidates(
      workers.filter((w) => w.type === 'human' && w.user_id),
      mentionQuery,
      (w) => ({ name: w.name, extra: w.email }),
    ).slice(0, 6);
  }, [mentionQuery, workers]);
  // An @ with nothing to pick (an e-mail address, "@名前さん") must not hold
  // Enter or Escape — the list is not on screen.
  const mentionListOpen = mentionOpen && mentionCandidates.length > 0;

  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);
    const m = detectMentionQuery(value.slice(0, e.target.selectionStart));
    if (m) {
      setMentionOpen(true);
      setMentionQuery(m.query);
      setMentionStart(m.start);
    } else {
      setMentionOpen(false);
    }
  };

  const insertMention = (worker: Worker) => {
    if (!mentionOpen) return;
    setDraft(insertMentionText(draft, { start: mentionStart, query: mentionQuery }, worker.name));
    setMentionOpen(false);
    setMentionQuery('');
  };

  const submit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    const restore = draft;
    const content = getCachedConvertEmoticons() ? convertEmoticons(trimmed) : trimmed;
    try {
      const created = await createStrategyComment({
        strategy_id: strategyId,
        author_id: user?.id ?? null,
        author_kind: 'human',
        author_name: formatDisplayName(profile?.display_name, user?.email, getCachedDisplayNames()),
        content,
        mentions: mentionedUserIds(content, workers),
      });
      // Only clear the draft once the row exists — a failed post that wiped
      // what you typed would be worse than the failure.
      setComments((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created]));
      setDraft('');
    } catch (e) {
      console.error('Failed to post Strategy comment:', e);
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
      console.error('Failed to delete Strategy comment:', e);
      setComments(snapshot); // put it back rather than lie about the delete
      reload();
    }
  };

  const canModerate = !!user?.id && user.id === strategyOwnerId;

  return (
    <div className="space-y-3">
      {comments.length > 0 && (
        <ul className="space-y-5">
          {comments.map((c) => {
            const isAi = c.author_kind === 'ai_agent';
            const isMine = !!user?.id && c.author_id === user.id && c.author_kind === 'human';
            const authorWorker = c.author_id
              ? (isAi ? workerById.get(c.author_id) : workerByUserId.get(c.author_id))
              : undefined;
            return (
              <li key={c.id}>
                <CommentEntry
                  comment={c}
                  mentionNames={mentionNames}
                  avatar={
                    <CommentAvatar
                      name={c.author_name ?? authorWorker?.name ?? null}
                      kind={c.author_kind}
                      isMine={isMine}
                      avatarUrl={authorWorker?.avatar_url}
                    />
                  }
                  menu={isMine || canModerate ? (
                    <CommentMenu align="end">
                      {(close) => (
                        <CommentMenuItem
                          icon={<Trash2 size={12} />}
                          label={t('Delete')}
                          onClick={() => { onDelete(c.id); close(); }}
                          destructive
                        />
                      )}
                    </CommentMenu>
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
        enterHeldBy={mentionListOpen}
        sendShortcut={sendShortcut}
        placeholder={t('Comment on {name}…', { name: strategyName })}
        onKeyDown={(e) => {
          // Escape drops the mention list first; a second one is the
          // surrounding page's to handle.
          if (e.key === 'Escape' && mentionListOpen) {
            e.preventDefault();
            setMentionOpen(false);
          }
        }}
      >
        {mentionListOpen && (
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
