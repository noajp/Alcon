'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { elementFileUrl, openElementFile, type ElementFile } from '@/hooks/elementFileData';
import { officeKindOf, readOffice, type OfficePreview } from './officePreview';

// An attached file, previewed in place under its row (the row's ▶ opens it): images and PDFs as themselves,
// text as text, audio and video in their players, and Word / Excel /
// PowerPoint as what they say (officePreview — read here, never handed to a
// viewer service). Anything else offers to open it in a new tab. The file
// is read through a short-lived signed link.

type Kind = 'image' | 'pdf' | 'html' | 'text' | 'video' | 'audio' | 'office' | 'other';

function kindOf(file: ElementFile): Kind {
  const mime = file.mime_type ?? '';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (officeKindOf(file.name)) return 'office';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime === 'text/html' || ext === 'html' || ext === 'htm') return 'html';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/') || ['md', 'markdown', 'txt', 'csv', 'json', 'log', 'yaml', 'yml'].includes(ext)) return 'text';
  return 'other';
}

export function ElementFilePreview({ file }: { file: ElementFile }) {
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
        if (kind === 'text' || kind === 'html') {
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
    <div className="mt-1 h-[480px] overflow-hidden rounded-lg border border-border/60 bg-background">
      <div className="h-full overflow-auto">
        {error ? (
          <p className="p-6 text-[13px] text-[var(--status-danger)]">{error}</p>
        ) : !url ? (
          <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 size={16} className="animate-spin" /></div>
        ) : kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={file.name} className="mx-auto max-h-full max-w-full object-contain p-4" />
        ) : kind === 'pdf' ? (
          <iframe src={url} title={file.name} className="h-full w-full border-0" />
        ) : kind === 'html' ? (
          // The page as it is, scripts and all, in a sandbox with no origin of
          // its own: it can run, but cannot reach this app, its storage or
          // the person's session. (Storage serves HTML as text, so the page
          // is handed over as srcdoc rather than by its link.)
          text === null
            ? <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 size={16} className="animate-spin" /></div>
            : <iframe srcDoc={text} sandbox="allow-scripts" title={file.name} className="h-full w-full border-0 bg-[var(--sheet-paper)]" />
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
    </div>
  );
}

/** What an Office file says: a document's paragraphs, a workbook's sheets
 *  (one tab each), a deck's slides as numbered cards. */
function OfficeView({ preview }: { preview: OfficePreview }) {
  if (preview.kind === 'docx') {
    return (
      <article className="mx-auto max-w-3xl space-y-2 px-8 py-8 text-[14px] leading-relaxed text-foreground">
        {preview.paragraphs.map((p, i) => p.heading
          ? <h3 key={i} className={`${p.heading === 1 ? 'text-[18px]' : 'text-[15px]'} pt-2 font-semibold`}>{p.text}</h3>
          : p.text ? <p key={i} className="whitespace-pre-wrap">{p.text}</p> : <div key={i} className="h-2" />)}
      </article>
    );
  }
  if (preview.kind === 'xlsx') return <SheetView sheets={preview.sheets} />;
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

/** Pure. A column's letters, as Excel heads it (0 → A, 26 → AA). */
function columnName(i: number): string {
  let name = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

const NUMERIC = /^-?[\d.,]+(e[+-]?\d+)?%?$/i;

/** A workbook as Excel draws it: Excel's green bar along the top, white
 *  cells on a light grid with lettered columns and numbered rows, numbers
 *  flush right, and the sheets as tabs along the bottom. The grid runs a
 *  little past the data, as a sheet does. */
function SheetView({ sheets }: { sheets: { name: string; rows: string[][] }[] }) {
  const { t } = useI18n();
  const [active, setActive] = useState(0);
  const rows = sheets[active]?.rows ?? [];
  const colCount = Math.max(8, ...rows.map((r) => r.length + 1));
  const rowCount = Math.max(30, rows.length + 5);
  const head = 'sticky z-10 border-b border-r border-[var(--sheet-grid)] bg-[var(--sheet-head)] text-[11px] font-normal text-[var(--sheet-head-text)]';
  return (
    <div className="flex h-full flex-col bg-[var(--sheet-paper)] text-[var(--sheet-text)]">
      <div className="h-1 shrink-0 bg-[var(--sheet-accent)]" />
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 && sheets.length > 0 && <p className="sr-only">{t('This sheet is empty.')}</p>}
        <table className="border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr>
              <th className={`${head} top-0 left-0 z-20 w-10 min-w-10`} />
              {Array.from({ length: colCount }, (_, c) => (
                <th key={c} className={`${head} top-0 h-6 min-w-[88px] px-2 text-center`}>{columnName(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, r) => (
              <tr key={r}>
                <th className={`${head} left-0 w-10 min-w-10 px-1 text-center tabular-nums`}>{r + 1}</th>
                {Array.from({ length: colCount }, (_, c) => {
                  const cell = rows[r]?.[c] ?? '';
                  return (
                    <td key={c} title={cell || undefined}
                      className={`h-6 max-w-[280px] truncate border-b border-r border-[var(--sheet-grid)] px-1.5 ${NUMERIC.test(cell) ? 'text-right tabular-nums' : ''}`}>
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex h-8 shrink-0 items-stretch gap-px overflow-x-auto border-t border-[var(--sheet-grid)] bg-[var(--sheet-head)] pl-10">
        {sheets.map((s, i) => (
          <button key={i} type="button" onClick={() => setActive(i)} aria-pressed={i === active}
            className={`whitespace-nowrap border-b-2 px-4 text-[12px] transition-colors ${i === active
              ? 'border-[var(--sheet-accent)] bg-[var(--sheet-paper)] font-semibold text-[var(--sheet-accent)]'
              : 'border-transparent text-[var(--sheet-head-text)] hover:bg-[var(--sheet-paper)]'}`}>
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
