'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useNoteHeader } from '@/hooks/useNotesDb';
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
  const { t } = useI18n();
  const noteId = typeof params.noteId === 'string' ? params.noteId : null;
  const [picking, setPicking] = useState(false);
  const note = useNoteHeader(noteId);
  useWidgetMeta(note.data?.name ?? t('Note'));
  const editable = !host.readOnly;

  if (noteId && note.isPending) return <p className="py-1 text-sm text-muted-foreground">{t('Loading note…')}</p>;
  if (noteId && note.data) {
    return <LinkedNoteEmbed noteId={noteId} editable={editable} onUnlink={editable ? () => setParams({ noteId: null }) : undefined} />;
  }
  return (
    <div className="relative space-y-1">
      {noteId && (
        <p className="py-1 text-sm text-muted-foreground">
          {note.isError ? t('This note could not be loaded.') : t('This note is private to its author, or it was deleted.')}
        </p>
      )}
      {/* A note someone else placed is theirs to change: only an empty slot takes a pick. */}
      {!noteId && (
        <ButtonAppearanceProvider appearance="inline">
          <Button type="button" variant="ghost" disabled={!editable} onClick={() => setPicking(true)} align="start">
            <Plus size={13} />{t('Choose a note')}
          </Button>
        </ButtonAppearanceProvider>
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
