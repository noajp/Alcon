'use client';

import { useState } from 'react';
import { Loader2, NotebookText, Table2 } from 'lucide-react';
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
import { importDataTable } from '@/hooks/tableData';
import { elementFileSource, type ElementFile } from '@/hooks/elementFileData';

/**
 * What an attached file can become in Alcon, from its preview's toolbar: a
 * workbook's sheet becomes a Table (header row as columns, numbers kept as
 * numbers), a Word document becomes a Note (headings, lists, tables, text
 * styles), and what was made opens. The file itself is left as it is.
 */
/** Whether a file has anything to become (so the toolbar shows the tool). */
export const canImport = (name: string) => officeKindOf(name) === 'xlsx' || officeKindOf(name) === 'docx';

export function FileImportActions({ file }: { file: ElementFile }) {
  return officeKindOf(file.name) === 'docx' ? <ImportDocToNote file={file} /> : <ImportSheetToTable file={file} />;
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
