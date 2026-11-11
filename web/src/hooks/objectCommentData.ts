'use client';

// An Object's thread (object_comments): StrategyComment's shape on an
// Object, read and written the same way, so the two threads stay one
// concept with two homes.

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ObjectComment, ObjectCommentInsert } from '@/types/database';

async function fetchObjectComments(objectId: string): Promise<ObjectComment[]> {
  const { data, error } = await supabase.from('object_comments').select('*')
    .eq('object_id', objectId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as ObjectComment[];
}

export async function createObjectComment(input: ObjectCommentInsert): Promise<ObjectComment> {
  const { data, error } = await supabase.from('object_comments').insert(input).select('*').single();
  if (error) throw error;
  return data as ObjectComment;
}

export async function deleteObjectComment(id: string): Promise<void> {
  const { error } = await supabase.from('object_comments').delete().eq('id', id);
  if (error) throw error;
}

const NO_COMMENTS: ObjectComment[] = [];

export function useObjectComments(objectId: string | null) {
  const qc = useQueryClient();
  const key = useMemo(() => ['object-comments', objectId ?? ''] as const, [objectId]);
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchObjectComments(objectId!),
    enabled: !!objectId,
  });
  const reload = useCallback(() => { void qc.invalidateQueries({ queryKey: key }); }, [qc, key]);
  const setComments = useCallback(
    (update: ObjectComment[] | ((prev: ObjectComment[]) => ObjectComment[])) => {
      void qc.cancelQueries({ queryKey: key });
      qc.setQueryData<ObjectComment[]>(key, (prev) => (typeof update === 'function' ? update(prev ?? NO_COMMENTS) : update));
    },
    [qc, key],
  );
  return { comments: query.data ?? NO_COMMENTS, reload, setComments };
}
