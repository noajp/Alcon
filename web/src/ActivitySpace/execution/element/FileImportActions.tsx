'use client';

import { useState } from 'react';
import { Loader2, NotebookText, Presentation, Table2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MenuSectionLabel } from '@/Function/shared/menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { openInApp } from '@/Function/shared/appNavigation';
import { readStoredFile } from '@/Function/office/FilePreview';
import { officeKindOf } from '@/Function/office/officePreview';
import { tableFromSheet } from '@/Function/office/sheetToTable';
import { docToNoteHtml } from '@/Function/office/docToNote';
import { createNoteFile } from '@/hooks/useNotesDb';
import { deckFromPptx } from '@/ActivitySpace/sustainment/slides/kata/model/fromPptx';
import type { Deck } from '@/ActivitySpace/sustainment/slides/kata/model/types';
import { requestNewDeck } from '@/ActivitySpace/sustainment/slides/newDeckRequest';
import { importDataTable } from '@/hooks/tableData';
import { elementFileSource, type ElementFile } from '@/hooks/elementFileData';

/**
 * What an attached file can become in Alcon, from its preview's toolbar: a
 * workbook's sheet becomes a Table (header row as columns, numbers kept as
 * numbers), a Word document becomes a Note (headings, lists, tables, text
 * styles), a PowerPoint deck becomes a Slides deck (each slide's shapes,
 * text and pictures where they were), and what was made opens. The file
 * itself is left as it is.
 */
/** Whether a file has anything to become (so the toolbar shows the tool). */
export const canImport = (name: string) => ['xlsx', 'docx', 'pptx'].includes(officeKindOf(name) ?? '');

export function FileImportActions({ file }: { file: ElementFile }) {
  const kind = officeKindOf(file.name);
  return kind === 'docx' ? <ImportDocToNote file={file} /> : kind === 'pptx' ? <ImportDeckToSlides file={file} /> : <ImportSheetToTable file={file} />;
}

const baseName = (file: ElementFile) => file.name.replace(/\.[^.]+$/, '');

function ImportDocToNote({ file }: { file: ElementFile }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const importDoc = async () => {
    setBusy(true);
    try {
      const doc = (await readStoredFile(file, elementFileSource)).doc;
      const html = doc ? docToNoteHtml(doc) : '';
      if (!html) { await appDialog.alert(t('This document has no text to import.')); return; }
      const note = await createNoteFile(baseName(file), html);
      openInApp('note', { noteId: note.id });
    } catch (e) {
      await appDialog.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Import into Notebook')} title={t('Import into Notebook')} disabled={busy} onClick={() => void importDoc()}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <NotebookText size={13} />}
    </Button>
  );
}

/** Pictures re-encoded no larger than `max` px on a side, so a deck saved as
 *  one row stays light; the same picture on many slides is done once. */
async function shrinkPictures(deck: Deck, max = 1600): Promise<Deck> {
  const done = new Map<string, Promise<string>>();
  const shrink = (src: string) => new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      if (k >= 1 && src.length < 400_000) return resolve(src);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      // PNG keeps transparency (logos, cut-outs); a photo is smaller as JPEG.
      const png = canvas.toDataURL('image/png');
      resolve(src.startsWith('data:image/png') || src.startsWith('data:image/gif') ? (png.length < src.length ? png : src) : canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
  const slides = await Promise.all(deck.slides.map(async (slide) => ({
    ...slide,
    objects: await Promise.all((slide.objects ?? []).map(async (o) => {
      if (!o.src) return o;
      if (!done.has(o.src)) done.set(o.src, shrink(o.src));
      return { ...o, src: await done.get(o.src)! };
    })),
  })));
  return { ...deck, slides };
}

function ImportDeckToSlides({ file }: { file: ElementFile }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const importDeck = async () => {
    setBusy(true);
    try {
      const pptx = (await readStoredFile(file, elementFileSource)).deck;
      if (!pptx?.slides.length) { await appDialog.alert(t('This deck has no slides to import.')); return; }
      const deck = await shrinkPictures(deckFromPptx(pptx, baseName(file)));
      requestNewDeck(baseName(file), deck);
      openInApp('slides');
    } catch (e) {
      await appDialog.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Import into Slides')} title={t('Import into Slides')} disabled={busy} onClick={() => void importDeck()}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Presentation size={13} />}
    </Button>
  );
}

function ImportSheetToTable({ file }: { file: ElementFile }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [sheets, setSheets] = useState<string[] | null>(null);

  const read = () => readStoredFile(file, elementFileSource);
  const importSheet = async (name: string) => {
    setBusy(true);
    try {
      const sheet = (await read()).workbook?.find((s) => s.name === name);
      const table = sheet ? tableFromSheet(sheet) : null;
      if (!table?.columns.length) { await appDialog.alert(t('This sheet has no table to import.')); return; }
      const base = baseName(file);
      const id = await importDataTable(sheets && sheets.length > 1 ? `${base} - ${name}` : base, table.columns, table.rows);
      openInApp('tables', { tableId: id });
    } catch (e) {
      await appDialog.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu onOpenChange={(open) => { if (open && !sheets) void read().then((r) => setSheets(r.workbook?.map((s) => s.name) ?? [])); }}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Import into Table')} title={t('Import into Table')} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Table2 size={13} />}
        </Button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" align="end">
        <MenuSectionLabel>{t('Import a sheet into Table')}</MenuSectionLabel>
        {!sheets ? <div className="px-2 py-1.5 text-[13px] text-muted-foreground"><Loader2 size={13} className="inline animate-spin" /></div>
          : sheets.map((name) => <DropdownMenuItem key={name} onSelect={() => void importSheet(name)}>{name}</DropdownMenuItem>)}
      </MenuShell>
    </DropdownMenu>
  );
}
