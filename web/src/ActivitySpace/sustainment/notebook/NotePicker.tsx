'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Plus, Search, X } from 'lucide-react';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import { supabase } from '@/lib/supabase';
import { ensureNoteHome } from '@/hooks/useNotesDb';
import { useI18n } from '@/Function/i18n/I18nProvider';

// NotePicker — popover that lets the caller pick an existing Note
// or create a new one. Used by ElementDetailView (per-Element Note
// link) and the Object TabBar dropdown (Note tab type).
//
//   <NotePicker
//     open={open}
//     onClose={() => setOpen(false)}
//     onPick={(noteId, isNew) => { ... }}
//     anchorClassName="absolute top-full left-0 mt-1"   // optional
//   />
//
// The component owns its own data fetch (small list, fresh on each
// open) so callers don't have to thread useNotes() through.

interface NoteFile {
  id: string;
  name: string;
  parent_id: string | null;
  updated_at: string;
}

interface NotePickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (noteId: string, opts: { isNew: boolean; name: string }) => void;
  /** Tailwind classes for the popover wrapper (e.g. positioning).
   *  Defaults to a centred dropdown anchored to the trigger button. */
  anchorClassName?: string;
}

export function NotePicker({
  open,
  onClose,
  onPick,
  anchorClassName = 'absolute top-full right-0 mt-1',
}: NotePickerProps) {
  const { t } = useI18n();
  const [notes, setNotes] = useState<NoteFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch the user's Notes (files only) each time the picker opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('notes')
        .select('id, name, parent_id, updated_at')
        .eq('type', 'file')
        .order('updated_at', { ascending: false });
      if (cancelled) return;
      if (!error && data) setNotes(data as NoteFile[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Focus the search input on open.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Dismiss on outside click. Escape is a layer — the picker, not the page
  // it sits on, is what one press closes.
  useEscapeLayer(open, onClose);
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // mousedown (rather than click) so the picker doesn't intercept
    // its own button up-events.
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => n.name.toLowerCase().includes(q));
  }, [notes, query]);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    const desiredName = query.trim() || t('Untitled note');
    try {
      // Files require a non-null parent (DB CHECK) — resolve into a Section
      // rather than a bare Folder, so the new note isn't hidden the moment
      // that Folder has (or gains) Sections.
      const { sectionId } = await ensureNoteHome();
      const { data, error } = await supabase
        .from('notes')
        .insert({ type: 'file', name: desiredName, parent_id: sectionId })
        .select('id, name, parent_id, updated_at')
        .single();
      if (error || !data) throw error ?? new Error('Failed to create note');
      // Seed an empty content row so the editor can upsert later.
      await supabase.from('note_contents').insert({ note_id: data.id, html: '' });
      onPick(data.id, { isNew: true, name: data.name });
    } catch (error) {
      console.warn('[NotePicker] create failed', error);
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div
      ref={popoverRef}
      className={`${anchorClassName} z-50 w-[280px] bg-popover border border-border rounded-lg shadow-xl overflow-hidden`}
      role="dialog"
    >
      {/* Search input */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
        <Search size={13} className="text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Search or name a new note…')}
          className="flex-1 text-[12px] bg-transparent border-none outline-none placeholder:text-muted-foreground/60"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t('Clear search')}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Create new */}
      <button
        type="button"
        onClick={handleCreate}
        disabled={creating}
        className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-foreground hover:bg-accent disabled:opacity-50 transition-colors border-b border-border/40"
      >
        <Plus size={13} className="text-muted-foreground" />
        <span className="font-medium">
          {query.trim() ? t('New note: "{name}"', { name: query.trim() }) : t('New note')}
        </span>
      </button>

      {/* Existing notes list */}
      <div className="max-h-[280px] overflow-y-auto py-1">
        {loading && (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">{t('Loading…')}</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="px-3 py-3 text-[11px] text-muted-foreground text-center">
            {notes.length === 0 ? t('No notes yet.') : t('No matches.')}
          </div>
        )}
        {!loading &&
          filtered.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => onPick(note.id, { isNew: false, name: note.name })}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-foreground hover:bg-accent transition-colors text-left"
            >
              <FileText size={13} className="text-muted-foreground shrink-0" />
              <span className="truncate flex-1 min-w-0">{note.name || t('Untitled')}</span>
            </button>
          ))}
      </div>
    </div>
  );
}
