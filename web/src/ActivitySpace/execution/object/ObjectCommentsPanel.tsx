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
import type { Worker } from '@/hooks/useSupabase';
import { createObjectComment, deleteObjectComment, useObjectComments } from '@/hooks/objectCommentData';
import { useAuthContext } from '@/providers/AuthProvider';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { detectMentionQuery, insertMentionText, mentionedUserIds, rankMentionCandidates } from '@/Function/shared/mentions';
import { getCachedSendCommentShortcut, getCachedDisplayNames, getCachedConvertEmoticons, formatDisplayName, convertEmoticons, usePreference } from '@/Function/settings/preferencesStore';

// =============================================================
// An Object's thread — its Updates. The same thread a Strategy keeps,
// on an Object: people and agents leave what changed and what they ask,
// and @naming someone reaches them. A comment is its author's to delete.
// =============================================================

export function ObjectCommentsPanel({
  objectId,
  objectName,
  workers,
}: {
  objectId: string;
  objectName: string;
  /** For @mention autocomplete. */
  workers: Worker[];
}) {
  const { t } = useI18n();
  const { user, profile } = useAuthContext();
  const { comments, reload, setComments } = useObjectComments(objectId);
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
      const created = await createObjectComment({
        object_id: objectId,
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
      console.error('Failed to post Object comment:', e);
      setDraft(restore);
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (id: string) => {
    const snapshot = comments;
    setComments((prev) => prev.filter((c) => c.id !== id));
    try {
      await deleteObjectComment(id);
    } catch (e) {
      console.error('Failed to delete Object comment:', e);
      setComments(snapshot); // put it back rather than lie about the delete
      reload();
    }
  };


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
                  menu={isMine ? (
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
        placeholder={t('Comment on {name}…', { name: objectName })}
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
