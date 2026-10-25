'use client';

import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/ui/button';
import { supabase } from '@/lib/supabase';
import { NotePicker } from '@/ActivitySpace/sustainment/notebook/NotePicker';
import { LinkedNoteEmbed } from '@/ActivitySpace/sustainment/notebook/LinkedNoteEmbed';
import { useWidgetMeta } from '../WidgetFrame';
import type { WidgetProps } from '../types';

/**
 * A Note on any board, written in place. The note stays in Notebook; the
 * widget only remembers which one it shows. Notes are their author's own, so
 * on a shared board only the author reads it here; everyone else is told so
 * rather than shown an empty editor.
 */
export function NoteWidget({ params, setParams, host }: WidgetProps) {
  const noteId = typeof params.noteId === 'string' ? params.noteId : null;
  const [picking, setPicking] = useState(false);
  const note = useQuery({
    queryKey: ['widget-note', noteId],
    enabled: !!noteId,
    queryFn: async () => {
      const { data, error } = await supabase.from('notes').select('id, name').eq('id', noteId!).maybeSingle();
      if (error) throw error;
      return (data ?? null) as { id: string; name: string } | null;
    },
  });
  useWidgetMeta(note.data?.name ?? 'Note');
  const editable = !host.readOnly;

  if (noteId && note.isPending) return <p className="p-3 text-xs text-muted-foreground">Loading note…</p>;
  if (noteId && note.data) {
    return <LinkedNoteEmbed noteId={noteId} editable={editable} onUnlink={editable ? () => setParams({ noteId: null }) : undefined} />;
  }
  return (
    <div className="relative space-y-2 p-3">
      {noteId && (
        <p className="text-xs text-muted-foreground">
          {note.isError ? 'This note could not be loaded.' : 'This note is private to its author, or it was deleted.'}
        </p>
      )}
      {/* A note someone else placed is theirs to change: only an empty slot takes a pick. */}
      {!noteId && (
        <Button type="button" disabled={!editable} onClick={() => setPicking(true)} className="w-full" align="start">
          <FileText size={13} />
          <span className="flex-1 text-left">Choose a note</span>
          <Plus size={13} />
        </Button>
      )}
      <NotePicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(id) => { setPicking(false); setParams({ noteId: id }); }}
        anchorClassName="absolute top-full left-0 mt-1"
      />
    </div>
  );
}
