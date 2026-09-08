'use client';

import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
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
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-border/60 text-[12px] text-muted-foreground hover:text-foreground hover:border-border transition-colors"
      >
        <FileText size={13} />
        <span className="flex-1 text-left">Link a Note</span>
        <Plus size={13} />
      </button>
      <NotePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(noteId) => handlePick(noteId)}
        anchorClassName="absolute top-full left-0 mt-1"
      />
    </div>
  );
}
