'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { elementFileUrl, openElementFile, type ElementFile } from '@/hooks/elementFileData';
import { officeKindOf, readOffice, type OfficePreview } from './officePreview';

// An attached file, previewed in the page: images and PDFs as themselves,
// text as text, audio and video in their players, and Word / Excel /
// PowerPoint as what they say (officePreview — read here, never handed to a
// viewer service). Anything else offers to open it in a new tab. The file
// is read through a short-lived signed link.

type Kind = 'image' | 'pdf' | 'text' | 'video' | 'audio' | 'office' | 'other';

function kindOf(file: ElementFile): Kind {
  const mime = file.mime_type ?? '';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (officeKindOf(file.name)) return 'office';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/') || ['md', 'markdown', 'txt', 'csv', 'json', 'log', 'yaml', 'yml'].includes(ext)) return 'text';
  return 'other';
}

export function ElementFilePreview({ file, onClose }: { file: ElementFile; onClose: () => void }) {
  const { t } = useI18n();
  const kind = kindOf(file);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [office, setOffice] = useState<OfficePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    elementFileUrl(file)
      .then(async (signed) => {
        if (!live) return;
        setUrl(signed);
        if (kind === 'text') {
          const body = await (await fetch(signed)).text();
          if (live) setText(body.slice(0, 200_000));
        } else if (kind === 'office') {
          const read = await readOffice(officeKindOf(file.name)!, await (await fetch(signed)).arrayBuffer());
          if (live) setOffice(read);
        }
      })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [file, kind]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex h-[85vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-4">
          <DialogTitle className="min-w-0 flex-1 truncate text-[13px] font-medium">{file.name}</DialogTitle>
          <Button variant="ghost" size="sm" className="mr-8 text-muted-foreground"
            onClick={() => { void openElementFile(file).catch((e) => setError(e instanceof Error ? e.message : String(e))); }}>
            <ExternalLink size={13} />{t('Open in new tab')}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-background">
          {error ? (
            <p className="p-6 text-[13px] text-[var(--status-danger)]">{error}</p>
          ) : !url ? (
            <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 size={16} className="animate-spin" /></div>
          ) : kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={file.name} className="mx-auto max-h-full max-w-full object-contain p-4" />
          ) : kind === 'pdf' ? (
            <iframe src={url} title={file.name} className="h-full w-full border-0" />
          ) : kind === 'video' ? (
            <video src={url} controls className="mx-auto max-h-full max-w-full p-4" />
          ) : kind === 'audio' ? (
            <div className="flex h-full items-center justify-center"><audio src={url} controls /></div>
          ) : kind === 'office' ? (
            office === null
              ? <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 size={16} className="animate-spin" /></div>
              : <OfficeView preview={office} />
          ) : kind === 'text' ? (
            text === null
              ? <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 size={16} className="animate-spin" /></div>
              : <pre className="whitespace-pre-wrap break-words p-6 font-mono text-[12.5px] leading-relaxed text-foreground">{text}</pre>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-muted-foreground">
              <p>{t('This file cannot be previewed here.')}</p>
              <Button variant="secondary" size="sm" onClick={() => { void openElementFile(file); }}>
                <ExternalLink size={13} />{t('Open in new tab')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** What an Office file says: a document's paragraphs, a workbook's sheets
 *  (one tab each), a deck's slides as numbered cards. */
function OfficeView({ preview }: { preview: OfficePreview }) {
  const { t } = useI18n();
  const [sheet, setSheet] = useState(0);
  if (preview.kind === 'docx') {
    return (
      <article className="mx-auto max-w-3xl space-y-2 px-8 py-8 text-[14px] leading-relaxed text-foreground">
        {preview.paragraphs.map((p, i) => p.heading
          ? <h3 key={i} className={`${p.heading === 1 ? 'text-[18px]' : 'text-[15px]'} pt-2 font-semibold`}>{p.text}</h3>
          : p.text ? <p key={i} className="whitespace-pre-wrap">{p.text}</p> : <div key={i} className="h-2" />)}
      </article>
    );
  }
  if (preview.kind === 'xlsx') {
    const current = preview.sheets[sheet];
    return (
      <div className="flex h-full flex-col">
        {preview.sheets.length > 1 && (
          <div className="flex shrink-0 gap-1 border-b border-border/60 px-3 py-2">
            {preview.sheets.map((s, i) => (
              <Button key={i} shape="tab" size="xs" variant={i === sheet ? 'secondary' : 'ghost'} aria-pressed={i === sheet} onClick={() => setSheet(i)}>{s.name}</Button>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {current && current.rows.length > 0 ? (
            <table className="border-collapse text-[12.5px]">
              <tbody>
                {current.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} className="max-w-[280px] truncate border border-border/60 px-2 py-1 text-foreground" title={cell}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="p-3 text-[13px] text-muted-foreground">{t('This sheet is empty.')}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto grid max-w-4xl gap-3 p-6">
      {preview.slides.map((s, i) => (
        <section key={i} className="rounded-lg border border-border/60 bg-[var(--surface-rail)] p-4">
          <div className="mb-2 text-[11px] tabular-nums text-muted-foreground">{i + 1}</div>
          {s.lines.length === 0
            ? <p className="text-[13px] text-muted-foreground">—</p>
            : s.lines.map((line, j) => <p key={j} className={j === 0 ? 'text-[15px] font-semibold text-foreground' : 'text-[13px] text-foreground/90'}>{line}</p>)}
        </section>
      ))}
    </div>
  );
}
