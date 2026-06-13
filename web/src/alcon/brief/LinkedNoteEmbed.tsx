'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { FileText, ExternalLink, Unlink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useNoteContent } from '@/hooks/useNotesDb';
// Editor is heavy and only mounts when a linked note is expanded — load it
// on demand (matches how ActionsView / NotesView already import it).
const AppleNoteEditor = dynamic(() => import('./editor/AppleNoteEditor').then((m) => m.AppleNoteEditor), {
  ssr: false,
  loading: () => <p className="text-[12px] text-muted-foreground">Loading…</p>,
});

// LinkedNoteEmbed — drops an Apple-Note editor inline into any host
// surface (Element detail, Object Note tab, …). It owns its own
// fetch + autosave loop, so the caller only hands it a noteId.

interface LinkedNoteEmbedProps {
  noteId: string;
  /** Optional unlink affordance — when supplied, a × is rendered in
   *  the header so the host can clear its FK. Pass `undefined` to
   *  hide it (e.g. Object Note tab where the linkage is permanent). */
  onUnlink?: () => void;
  /** Optional "Open in Notes" callback. When supplied, the header
   *  shows an external-link icon that fires this. Hosts can wire it
   *  to their navigation store. */
  onOpenInNotes?: () => void;
  /** When false, render read-only HTML view (no editor toolbar). */
  editable?: boolean;
}

export function LinkedNoteEmbed({
  noteId,
  onUnlink,
  onOpenInNotes,
  editable = true,
}: LinkedNoteEmbedProps) {
  const { html, loading, save } = useNoteContent(noteId);
  const [name, setName] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('notes')
        .select('name')
        .eq('id', noteId)
        .maybeSingle();
      if (!cancelled && data) setName((data as { name: string }).name);
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  return (
    <div className="rounded-md border border-border/60 bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border/60 bg-muted/30">
        <FileText size={13} className="text-muted-foreground shrink-0" />
        <span className="text-[12px] font-semibold text-foreground truncate flex-1 min-w-0">
          {name || 'Untitled note'}
        </span>
        {onOpenInNotes && (
          <button
            type="button"
            onClick={onOpenInNotes}
            title="Open in Notes"
            className="text-muted-foreground hover:text-foreground p-1 -m-1"
          >
            <ExternalLink size={12} />
          </button>
        )}
        {onUnlink && (
          <button
            type="button"
            onClick={onUnlink}
            title="Unlink this Note"
            className="text-muted-foreground hover:text-foreground p-1 -m-1"
          >
            <Unlink size={12} />
          </button>
        )}
      </div>
      <div className="px-3 py-2 min-h-[120px]">
        {loading ? (
          <p className="text-[12px] text-muted-foreground">Loading…</p>
        ) : (
          <AppleNoteEditor
            initialHtml={html}
            onChange={save}
            editable={editable}
          />
        )}
      </div>
    </div>
  );
}
