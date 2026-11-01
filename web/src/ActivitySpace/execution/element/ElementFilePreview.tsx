'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, ExternalLink, Loader2, Maximize2, Minimize2, Minus, Plus } from 'lucide-react';
import { Button } from '@/ui/button';
import { translate, useI18n } from '@/Function/i18n/I18nProvider';
import { downloadElementFile, elementFileUrl, openElementFile, type ElementFile } from '@/hooks/elementFileData';
import { officeKindOf, readOffice, type OfficePreview } from './officePreview';
import { readDeck, type Deck } from './deckLayout';
import { readWorkbook, type WorkSheet } from './sheetLayout';
import { readDocLayout, type DocLayout } from './docLayout';
import { DeckView } from './DeckView';
import { DocView } from './DocView';
import { SheetView } from './SheetView';
import { OfficeTextView } from './OfficeTextView';

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

/** What a file reads to, for the kinds that are read rather than shown by
 *  the browser itself. */
interface Loaded { text?: string; office?: OfficePreview; workbook?: WorkSheet[]; doc?: DocLayout; deck?: Deck }

// A file's bytes never change (each upload gets a new path), so what it
// read to is kept for the session: reopening a preview is instant. Only the
// few most recent are kept, so memory stays bounded.
const READ_CACHE = new Map<string, Promise<Loaded>>();
const READ_CACHE_SIZE = 8;

/** Fetches a file through a signed link and reads it — text as text, a
 *  workbook, document or deck into its layout (with the text-only reading
 *  as the fallback where a layout will not read). */
function readFile(file: ElementFile, kind: Kind): Promise<Loaded> {
  const hit = READ_CACHE.get(file.id);
  if (hit) { READ_CACHE.delete(file.id); READ_CACHE.set(file.id, hit); return hit; }
  const officeKind = officeKindOf(file.name);
  const read = (async (): Promise<Loaded> => {
    const signed = await elementFileUrl(file);
    if (kind === 'text' || kind === 'html') return { text: (await (await fetch(signed)).text()).slice(0, 2_000_000) };
    const bytes = await (await fetch(signed)).arrayBuffer();
    // An encrypted Office file is not a zip but a compound file (the old
    // binary container): say so plainly instead of a zip error.
    const head = new Uint8Array(bytes.slice(0, 4));
    if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
      throw new Error(translate('This file is password-protected, so it cannot be previewed. Download it to open it.'));
    }
    if (!(head[0] === 0x50 && head[1] === 0x4b)) throw new Error(translate('This file could not be read. It may be damaged.'));
    if (officeKind === 'xlsx') return { workbook: await readWorkbook(bytes) };
    if (officeKind === 'docx') {
      const doc = await readDocLayout(bytes).catch(() => null);
      return doc ? { doc } : { office: await readOffice('docx', bytes) };
    }
    const deck = await readDeck(bytes).catch(() => null);
    return deck?.slides.length ? { deck } : { office: await readOffice('pptx', bytes) };
  })().catch((e: unknown) => {
    // A zip that will not open is a damaged file, whatever JSZip calls it.
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(/zip|central directory|end of data/i.test(message) ? translate('This file could not be read. It may be damaged.') : message);
  });
  read.catch(() => READ_CACHE.delete(file.id));
  READ_CACHE.set(file.id, read);
  while (READ_CACHE.size > READ_CACHE_SIZE) READ_CACHE.delete(READ_CACHE.keys().next().value!);
  return read;
}

export function ElementFilePreview({ file }: { file: ElementFile }) {
  const { t } = useI18n();
  const kind = kindOf(file);
  const officeKind = officeKindOf(file.name);
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { text = null, office = null, workbook = null, doc: docLayout = null, deck = null } = loaded ?? {};
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let live = true;
    const fail = (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); };
    if (kind === 'text' || kind === 'html' || kind === 'office') {
      readFile(file, kind).then((l) => { if (live) setLoaded(l); }).catch(fail);
    } else {
      // Shown by the browser itself (image, PDF, media) — only a link is needed.
      elementFileUrl(file).then((signed) => { if (live) setUrl(signed); }).catch(fail);
    }
    return () => { live = false; };
  }, [file, kind]);

  // Full screen is the app's own layer over the whole window, not the
  // browser's Fullscreen API — that is refused inside embedded browsers
  // (the desktop app's pane among them).
  useEffect(() => {
    if (!fullscreen) return;
    // Captured first and stopped, so Esc leaves full screen only — the page
    // under it (which closes on Esc) never sees it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setFullscreen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fullscreen]);
  const toggleFullscreen = () => setFullscreen((f) => !f);
  const spinner = <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 size={16} className="animate-spin" /></div>;
  const zoomable = kind === 'html';

  const frame = (
    <div
      className={fullscreen
        ? 'group/preview fixed inset-0 z-[100] overflow-hidden bg-background'
        : 'group/preview relative mt-1 h-[480px] overflow-hidden rounded-lg border border-border/60 bg-background'}>
      {/* Tools float over the preview's corner and show on hover: zoom for
          a page, full screen for everything. */}
      <div className={`absolute right-2 top-2.5 z-30 flex items-center gap-0.5 rounded-md border border-border/60 bg-[var(--surface-overlay)] p-0.5 shadow-sm transition-opacity ${fullscreen ? '' : 'opacity-0 group-hover/preview:opacity-100 focus-within:opacity-100'}`}>
        {zoomable && <>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Zoom out')} title={t('Zoom out')} disabled={zoom <= 0.25}
            onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.1) * 100) / 100))}><Minus size={13} /></Button>
          <button type="button" onClick={() => setZoom(1)} title={t('Reset zoom')} aria-label={t('Reset zoom')}
            className="h-6 min-w-11 rounded px-1 text-[11.5px] tabular-nums text-muted-foreground transition-colors hover:bg-[var(--surface-strong)] hover:text-foreground">
            {Math.round(zoom * 100)}%
          </button>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Zoom in')} title={t('Zoom in')} disabled={zoom >= 3}
            onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.1) * 100) / 100))}><Plus size={13} /></Button>
          <span className="mx-0.5 h-4 w-px bg-border/60" />
        </>}
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Download')} title={t('Download')}
          onClick={() => { void downloadElementFile(file).catch((e) => setError(e instanceof Error ? e.message : String(e))); }}>
          <Download size={13} />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" onClick={toggleFullscreen}
          aria-label={t(fullscreen ? 'Exit full screen' : 'Full screen')} title={t(fullscreen ? 'Exit full screen' : 'Full screen')}>
          {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </Button>
      </div>
      <div className="h-full overflow-auto">
        {error ? (
          <p className="p-6 text-[13px] text-[var(--status-danger)]">{error}</p>
        ) : !url && !loaded ? spinner : kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url ?? undefined} alt={file.name} className="mx-auto max-h-full max-w-full object-contain p-4" />
        ) : kind === 'pdf' ? (
          <iframe src={url ?? undefined} title={file.name} className="h-full w-full border-0" />
        ) : kind === 'html' ? (
          // The page as it is, scripts and all, in a sandbox with no origin of
          // its own: it can run, but cannot reach this app, its storage or
          // the person's session. (Storage serves HTML as text, so the page
          // is handed over as srcdoc rather than by its link.) Zoom scales
          // the frame and gives it the room the scale takes away, so the page
          // lays itself out for a wider or narrower window.
          text === null ? spinner : (
            <iframe srcDoc={text} sandbox="allow-scripts" title={file.name}
              style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})`, transformOrigin: '0 0' }}
              className="border-0 bg-[var(--sheet-paper)]" />
          )
        ) : kind === 'video' ? (
          <video src={url ?? undefined} controls className="mx-auto max-h-full max-w-full p-4" />
        ) : kind === 'audio' ? (
          <div className="flex h-full items-center justify-center"><audio src={url ?? undefined} controls /></div>
        ) : kind === 'office' ? (
          officeKind === 'xlsx' ? (workbook ? <SheetView sheets={workbook} /> : spinner)
          : docLayout ? <DocView doc={docLayout} />
          : deck ? <DeckView deck={deck} present={fullscreen} />
            : office === null ? spinner : <OfficeTextView preview={office} />
        ) : kind === 'text' ? (
          text === null ? spinner
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
  // In full screen the frame is portalled to <body>, so no ancestor's
  // transform or overflow can clip the fixed layer; a quiet placeholder
  // keeps the row's place meanwhile.
  return fullscreen
    ? <><div className="mt-1 h-[480px] rounded-lg border border-dashed border-border/60" />{createPortal(frame, document.body)}</>
    : frame;
}
