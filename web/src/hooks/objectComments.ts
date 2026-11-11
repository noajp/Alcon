'use client';

import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';
import type { ObjectComment, ObjectCommentInsert } from '@/types/database';
import type { CommentThread } from '@/hooks/commentData';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

// ============================================
// Object comments — the Object's own thread, on its Overview.
//
// The same shape as an Element's and a Strategy's (object_comments). The
// Inbox is told by a database trigger (notify_object_comment), not from
// here, and the delta stream lands every row on ['object-comments', id].
// ============================================

async function fetchObjectComments(objectId: string): Promise<ObjectComment[]> {
  const { data, error } = await supabase
    .from('object_comments')
    .select('*')
    .eq('object_id', objectId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as ObjectComment[];
}

async function createObjectComment(input: ObjectCommentInsert): Promise<ObjectComment> {
  const { data, error } = await supabase.from('object_comments').insert(input).select('*').single();
  if (error) throw error;
  return data as ObjectComment;
}

async function deleteObjectComment(id: string): Promise<void> {
  // RLS lets only the author delete; anyone else's delete matches no row and
  // returns no error — report it so the caller can put the comment back.
  const { data, error } = await supabase.from('object_comments').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error(translate('This comment can only be deleted by its author.'));
}

async function setObjectCommentPinned(id: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.from('object_comments').update({ is_pinned: pinned }).eq('id', id).select('id').single();
  if (error) throw error;
}

const NO_COMMENTS: ObjectComment[] = [];

/** One Object's thread, through the query cache. */
export function useObjectCommentThread(objectId: string): CommentThread<ObjectComment> {
  const qc = useQueryClient();
  const key = useMemo(() => ['object-comments', objectId] as const, [objectId]);
  const query = useQuery({ queryKey: key, queryFn: () => fetchObjectComments(objectId) });
  const reload = useCallback(async () => { await qc.invalidateQueries({ queryKey: key }); }, [qc, key]);
  const setComments = useCallback(
    (update: ObjectComment[] | ((prev: ObjectComment[]) => ObjectComment[])) => {
      // A refetch resolving after this write would overwrite it — cancel it first.
      void qc.cancelQueries({ queryKey: key });
      qc.setQueryData<ObjectComment[]>(key, (prev) => (typeof update === 'function' ? update(prev ?? NO_COMMENTS) : update));
    },
    [qc, key],
  );
  const comments = query.data ?? NO_COMMENTS;
  // A thread that could not be read is shown empty, not as loading for ever.
  const loading = query.isPending;
  return useMemo(() => ({
    comments, loading, reload, setComments,
    create: (comment) => createObjectComment({ object_id: objectId, author_kind: 'human', ...comment }),
    remove: deleteObjectComment,
    setPinned: setObjectCommentPinned,
    reactions: false,
  }), [comments, loading, reload, setComments, objectId]);
}
