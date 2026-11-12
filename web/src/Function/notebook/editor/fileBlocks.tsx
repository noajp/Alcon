'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Upload } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { FileTypeIcon } from '@/Function/office/fileTypeIcon';
import { attachmentSource, useAttachment, useSpaceAttachments, type SpaceFile } from '@/hooks/attachmentData';

// A file placed in the text: an ```alcon block whose view is `file` and whose
// id names a file in Artifacts. The editor draws it itself, on any page — an
// image as the image, anything else as a row that opens it. Both have a fixed
// height, so the block's place in the text does not move as the file loads.

export const FILE_VIEW = 'file';
const IMAGE_HEIGHT = 320;

const sizeText = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function FileBlock({ id }: { id: string }) {
  const { t } = useI18n();
  const { data: file, isPending } = useAttachment(id);
  const isImage = !!file?.mime_type?.startsWith('image/');
  const url = useQuery({
    queryKey: ['attachment-url', file?.id],
    enabled: !!file && isImage,
    staleTime: 240_000,
    queryFn: () => attachmentSource.signedUrl(file!),
  });
  if (isPending) return <div className="h-11 rounded-md bg-muted/40" />;
  if (!file) return <p className="flex h-11 items-center rounded-md bg-muted/40 px-3 text-[12px] text-muted-foreground">{t('This file is no longer available.')}</p>;
  const open = () => { void attachmentSource.open(file); };
  if (isImage) {
    return (
      <button type="button" onClick={open} title={file.name}
        className="flex w-full items-center justify-center overflow-hidden rounded-md bg-muted/30" style={{ height: IMAGE_HEIGHT }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url.data && <img src={url.data} alt={file.name} className="max-h-full max-w-full object-contain" />}
      </button>
    );
  }
  return (
    <button type="button" onClick={open}
      className="flex h-11 w-full items-center gap-2.5 rounded-md border border-border/60 bg-muted/30 px-3 text-left transition-colors hover:bg-muted/60">
      <FileTypeIcon name={file.name} mime={file.mime_type} size={16} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{file.name}</span>
      <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{sizeText(file.size)}</span>
    </button>
  );
}

/** The Space's files to pick one from, by name. */
export function ArtifactPicker({ spaceId, x, y, onPick, onUpload, onClose }: {
  spaceId: string | null; x: number; y: number;
  onPick: (file: SpaceFile) => void;
  /** Choose one from this computer instead (it is kept in Artifacts). */
  onUpload: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data, loading } = useSpaceAttachments(spaceId);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? data.filter((f) => f.name.toLowerCase().includes(q)) : data).slice(0, 50);
  }, [data, query]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-artifact-picker]')) onClose(); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [onClose]);
  return (
    <div data-artifact-picker className="fixed z-50 w-80 overflow-hidden rounded-lg border border-border bg-popover shadow-xl" style={{ left: x, top: y }}>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-muted-foreground">
        <Search size={13} />
        <input autoFocus value={query} placeholder={t('Search files')}
          onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, found.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); const f = found[index]; if (f) onPick(f); }
          }}
          className="no-focus-ring min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-foreground placeholder:text-muted-foreground/60" />
      </div>
      <div role="listbox" className="max-h-64 overflow-y-auto py-1">
        <button type="button" onClick={onUpload}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-foreground hover:bg-muted">
          <Upload size={15} className="shrink-0 text-muted-foreground" />{t('Upload from this computer')}
        </button>
        {found.length > 0 && <div className="my-1 border-t border-border/50" />}
        {found.map((f, i) => (
          <button key={f.id} type="button" role="option" aria-selected={i === index}
            onMouseEnter={() => setIndex(i)} onClick={() => onPick(f)}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${i === index ? 'bg-muted' : ''}`}>
            <FileTypeIcon name={f.name} mime={f.mime_type} size={15} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{f.name}</span>
            {f.owner_label && <span className="max-w-[90px] shrink-0 truncate text-[11px] text-muted-foreground">{f.owner_label}</span>}
          </button>
        ))}
        {!found.length && query && <p className="px-3 py-3 text-[12px] text-muted-foreground">{loading ? t('Loading…') : t('No files found.')}</p>}
      </div>
    </div>
  );
}
