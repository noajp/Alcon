'use client';

import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useState } from 'react';
import { Plus } from '@/ui/icons';
import { updateObject } from '@/hooks/useSupabase';
import { NotePicker } from '@/ActivitySpace/sustainment/notebook/NotePicker';
import { LinkedNoteEmbed } from '@/ActivitySpace/sustainment/notebook/LinkedNoteEmbed';
import type { WidgetHost } from '../types';

// =============================================================
// Linked Note — a Note pinned to this Object, same mechanism as
// ElementDetailView's inline Note linker (NotePicker → note_id →
// LinkedNoteEmbed). Opt-in (not in the default Overview board) since most
// Objects won't have one; add it via "+ Add widget" once you want it.
// =============================================================

export function LinkedNoteWidget({ host }: { host: WidgetHost }) {
  const { t } = useI18n();
  const object = host.object;
  const [pickerOpen, setPickerOpen] = useState(false);
  if (!object) return null;

  const handlePick = async (noteId: string) => {
    setPickerOpen(false);
    try {
      await updateObject(object.id, { note_id: noteId });
      host.onRefresh?.();
    } catch (e) {
      console.error('Failed to link note to object', e);
    }
  };

  const handleUnlink = async () => {
    try {
      await updateObject(object.id, { note_id: null });
      host.onRefresh?.();
    } catch (e) {
      console.error('Failed to unlink note from object', e);
    }
  };

  if (object.note_id) {
    return <LinkedNoteEmbed noteId={object.note_id} onUnlink={handleUnlink} />;
  }

  return (
    <div className="relative">
      <ButtonAppearanceProvider appearance="inline">
        <Button type="button" variant="ghost" onClick={() => setPickerOpen(true)} align="start">
          <Plus size={13} />{t('Link a Note')}
        </Button>
      </ButtonAppearanceProvider>
      <NotePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(noteId) => handlePick(noteId)}
        anchorClassName="absolute top-full left-0 mt-1"
      />
    </div>
  );
}
