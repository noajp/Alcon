'use client';
import dynamic from 'next/dynamic';
import { FileText, ExternalLink, Unlink } from 'lucide-react';
import { useNoteContent, useNoteHeader } from '@/hooks/useNotesDb';
import { NoteContentStatus } from './NoteContentStatus';
import { PresenceStack } from '@/Function/shared/PresenceStack';
import { useNotePresence } from '@/hooks/usePresence';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
// Editor is heavy and only mounts when a linked note is expanded — load it
// on demand.
const NoteEditor = dynamic(() => import('./editor/NoteEditor').then((m) => m.NoteEditor), {
  ssr: false,
  loading: () => <EditorLoading />,
});

// LinkedNoteEmbed — drops an Note editor inline into any host
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
  const { t } = useI18n();
  const { html, loading, saving, error, errorKind, retry, save } = useNoteContent(noteId);
  const name = useNoteHeader(noteId).data?.name;
  const viewers = useNotePresence(noteId);

  return (
    <div>
      <div className="flex items-center gap-2 h-8">
        <FileText size={13} className="text-muted-foreground shrink-0" />
        <span className="text-[12px] font-semibold text-foreground truncate flex-1 min-w-0">
          {name || t('Untitled note')}
        </span>
        <PresenceStack viewers={viewers} size={18} />
        <ButtonAppearanceProvider appearance="navigation">
          {onOpenInNotes && (
            <Button variant="ghost" size="icon-xs" onClick={onOpenInNotes} title={t('Open in Notebook')} aria-label={t('Open in Notebook')}>
              <ExternalLink size={12} />
            </Button>
          )}
          {onUnlink && (
            <Button variant="ghost" size="icon-xs" onClick={onUnlink} title={t('Unlink this Note')} aria-label={t('Unlink this Note')}>
              <Unlink size={12} />
            </Button>
          )}
        </ButtonAppearanceProvider>
      </div>
      <NoteContentStatus loading={loading} saving={saving} error={error} errorKind={errorKind} onRetry={retry} />
      <div className="py-2 min-h-[120px]">
        {loading ? (
          !error && <EditorLoading />
        ) : (
          <NoteEditor
            key={noteId}
            value={html}
            onChange={save}
            editable={editable}
          />
        )}
      </div>
    </div>
  );
}

function EditorLoading() {
  const { t } = useI18n();
  return <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>;
}
