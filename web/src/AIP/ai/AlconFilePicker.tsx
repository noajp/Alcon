'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from '@/ui/icons';
import { Button } from '@/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { FilesIcon } from '@/Function/shared/conceptIcons';
import { FileTypeIcon } from '@/Function/office/fileTypeIcon';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { attachmentText, useSpaceAttachments, type SpaceFile } from '@/hooks/attachmentData';
import type { CopilotAttachment } from './useAlconCopilot';

/**
 * Hands the AI a file that is already in Alcon — any file attached in this
 * Space that the person can see — as its text, the way a file from the
 * computer is handed over. The person picks it; nothing is sent until they
 * send their message.
 */
export function AlconFilePicker({ disabled, onPick }: { disabled?: boolean; onPick: (file: CopilotAttachment) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const spaceId = useActiveSpaceId();
  // Read only once the list is opened.
  const { data: files, loading } = useSpaceAttachments(open ? spaceId : null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? files.filter((f) => f.name.toLowerCase().includes(q) || (f.owner_label ?? '').toLowerCase().includes(q)) : files).slice(0, 50);
  }, [files, query]);

  const pick = async (f: SpaceFile) => {
    setReading(f.id);
    setError(null);
    try {
      const text = await attachmentText(f);
      if (!text.trim()) { setError(t('This file has no text the AI can read.')); return; }
      onPick({ name: f.name, mediaType: 'text/plain', data: text });
      setOpen(false);
      setQuery('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="icon-sm" type="button" variant="ghost" disabled={disabled} className="text-muted-foreground"
          title={t('Add a file from Alcon')} aria-label={t('Add a file from Alcon')}>
          <FilesIcon size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-1.5">
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search files')} aria-label={t('Search files')}
          className="mb-1 h-8 w-full rounded-md bg-muted/50 px-2 text-[13px] outline-none focus:bg-muted" />
        {error && <p role="alert" className="px-1.5 py-1 text-[12px] text-[var(--status-danger)]">{error}</p>}
        <div className="max-h-72 overflow-y-auto">
          {loading ? <p className="px-1.5 py-2 text-[12.5px] text-muted-foreground">{t('Loading…')}</p>
            : !shown.length ? <p className="px-1.5 py-2 text-[12.5px] text-muted-foreground">{t('No files match.')}</p>
            : shown.map((f) => (
              <button key={f.id} type="button" disabled={!!reading} onClick={() => void pick(f)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-foreground/[0.06] disabled:opacity-60">
                {reading === f.id ? <Loader2 size={14} className="animate-spin" /> : <FileTypeIcon name={f.name} mime={f.mime_type} size={14} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{f.name}</span>
                  {f.owner_label && <span className="block truncate text-[11px] text-muted-foreground">{f.owner_label}</span>}
                </span>
              </button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
