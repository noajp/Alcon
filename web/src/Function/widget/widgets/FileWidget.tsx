'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, FileUp, Loader2, Settings2 } from 'lucide-react';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MenuSectionLabel, MENU_SEPARATOR } from '@/Function/shared/menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { FilePreview, readStoredFile } from '@/Function/office/FilePreview';
import { FileTypeIcon } from '@/Function/office/fileTypeIcon';
import SheetChartView from '@/Function/office/SheetChart';
import type { ChartData } from '@/Function/office/chartLayout';
import { attachmentSource, useAttachment, useAttachmentsOf, type Attachment } from '@/hooks/attachmentData';
import { WidgetHeaderAction, useWidgetMeta } from '../WidgetFrame';
import type { WidgetProps } from '../types';

/** What the widget shows of its file. */
export type FileWidgetShow = 'file' | 'chart' | 'value';

/**
 * A file attached to one of the board's Elements, shown on the board: the
 * whole file (slides, pages, sheets — a deck plays full screen), one of its
 * charts, or one cell of a workbook as a key number. Which file and what of
 * it are the placement's params; the bytes stay where the Element keeps
 * them, so whoever cannot see that Element sees nothing here either.
 */
export function FileWidget({ params, setParams, host }: WidgetProps) {
  const { t } = useI18n();
  const fileId = typeof params.fileId === 'string' ? params.fileId : null;
  const show: FileWidgetShow = params.show === 'chart' || params.show === 'value' ? params.show : 'file';
  const file = useAttachment(fileId);
  const candidates = useAttachmentsOf('element', host.elements.map((e) => e.id));
  const editable = !host.readOnly;
  useWidgetMeta(file.data?.name ?? t('File'));

  if (!fileId) {
    return <FilePicker files={candidates.data} loading={candidates.loading} disabled={!editable} onPick={(f) => setParams({ fileId: f.id, show: 'file' })} />;
  }
  if (file.isPending) return <Spinner />;
  if (!file.data) return <p className="py-1 text-sm text-muted-foreground">{t('This file was removed, or you cannot see the Element it is attached to.')}</p>;

  return (
    <>
      {editable && (
        <WidgetHeaderAction>
          <FileWidgetMenu file={file.data} show={show} params={params} candidates={candidates.data}
            onChange={(next) => setParams({ ...params, ...next })} />
        </WidgetHeaderAction>
      )}
      {show === 'file' ? <FilePreview file={file.data} source={attachmentSource} height={420} />
        : show === 'chart' ? <FileChart file={file.data} index={Number(params.chart ?? 0)} />
        : <FileValue file={file.data} sheet={typeof params.sheet === 'string' ? params.sheet : null} cell={typeof params.cell === 'string' ? params.cell : 'A1'}
            label={typeof params.label === 'string' ? params.label : null} />}
    </>
  );
}

function Spinner() {
  return <div className="flex h-24 items-center justify-center text-muted-foreground"><Loader2 size={16} className="animate-spin" /></div>;
}

/** Reads the file once per session (shared with the Element's preview). */
function useRead(file: Attachment) {
  return useQuery({ queryKey: ['stored-file', file.id], queryFn: () => readStoredFile(file, attachmentSource), staleTime: Infinity });
}

/** Every chart a workbook or deck holds, with where it is. */
function chartsOf(read: Awaited<ReturnType<typeof readStoredFile>> | undefined): { label: string; chart: ChartData }[] {
  if (!read) return [];
  if (read.workbook) return read.workbook.flatMap((s) => s.charts.map((c, i) => ({ label: `${s.name} · ${c.title ?? `#${i + 1}`}`, chart: c })));
  if (read.deck) return read.deck.slides.flatMap((s, n) => s.items.flatMap((it) => (it.kind === 'chart' ? [{ label: `${n + 1} · ${it.chart.title ?? ''}`.trim(), chart: it.chart }] : [])));
  return [];
}

function FileChart({ file, index }: { file: Attachment; index: number }) {
  const { t } = useI18n();
  const read = useRead(file);
  const charts = useMemo(() => chartsOf(read.data), [read.data]);
  if (read.isPending) return <Spinner />;
  const chart = charts[index] ?? charts[0];
  if (!chart) return <p className="py-1 text-sm text-muted-foreground">{t('This file has no chart.')}</p>;
  return <div className="h-72"><SheetChartView chart={chart.chart} framed={false} /></div>;
}

/** Pure. "B3" → [row 2, col 1]; null when not a cell reference. */
function cellAt(ref: string): [number, number] | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/i.exec(ref.trim());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, col - 1];
}

function FileValue({ file, sheet, cell, label }: { file: Attachment; sheet: string | null; cell: string; label: string | null }) {
  const { t } = useI18n();
  const read = useRead(file);
  if (read.isPending) return <Spinner />;
  const ws = read.data?.workbook?.find((s) => s.name === sheet) ?? read.data?.workbook?.[0];
  const at = cellAt(cell);
  const value = ws && at ? ws.rows[at[0]]?.cells[at[1]] : null;
  if (!ws) return <p className="py-1 text-sm text-muted-foreground">{t('Only a workbook has cells to show.')}</p>;
  return (
    <div className="py-1">
      <div className="text-[12px] text-muted-foreground">{label || `${ws.name}!${cell.toUpperCase()}`}</div>
      <div className="text-[28px] font-semibold tabular-nums leading-tight text-foreground">{value?.text || '—'}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><FileTypeIcon name={file.name} mime={file.mime_type} size={12} />{file.name}</div>
    </div>
  );
}

function FilePicker({ files, loading, disabled, onPick }: { files: Attachment[]; loading: boolean; disabled: boolean; onPick: (f: Attachment) => void }) {
  const { t } = useI18n();
  if (loading) return <Spinner />;
  if (!files.length) return <p className="py-1 text-sm text-muted-foreground">{t('No files are attached to these Elements yet.')}</p>;
  return (
    <div className="space-y-0.5">
      <p className="pb-1 text-[12px] text-muted-foreground">{t('Choose a file to show')}</p>
      <ButtonAppearanceProvider appearance="inline">
        {files.slice(0, 30).map((f) => (
          <Button key={f.id} type="button" variant="ghost" align="start" disabled={disabled} onClick={() => onPick(f)} className="w-full">
            <FileTypeIcon name={f.name} mime={f.mime_type} size={13} /><span className="truncate">{f.name}</span>
          </Button>
        ))}
      </ButtonAppearanceProvider>
    </div>
  );
}

/** The header menu: what to show, which chart, which cell, another file. */
function FileWidgetMenu({ file, show, params, candidates, onChange }: {
  file: Attachment; show: FileWidgetShow; params: Record<string, unknown>; candidates: Attachment[];
  onChange: (next: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const read = useRead(file);
  const charts = useMemo(() => chartsOf(read.data), [read.data]);
  const sheets = read.data?.workbook?.map((s) => s.name) ?? [];
  const [cell, setCell] = useState(typeof params.cell === 'string' ? params.cell : 'A1');
  const [label, setLabel] = useState(typeof params.label === 'string' ? params.label : '');
  const item = (active: boolean, text: string, onSelect: () => void, key?: string) => (
    <DropdownMenuItem key={key ?? text} onSelect={onSelect}><span className="flex-1 truncate">{text}</span>{active && <Check size={13} />}</DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t('File widget settings')} title={t('File widget settings')}><Settings2 size={13} /></Button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" align="end" width="wide">
        <MenuSectionLabel>{t('Show')}</MenuSectionLabel>
        {item(show === 'file', t('The whole file'), () => onChange({ show: 'file' }))}
        {charts.length > 0 && item(show === 'chart', t('A chart'), () => onChange({ show: 'chart', chart: 0 }))}
        {sheets.length > 0 && item(show === 'value', t('A value'), () => onChange({ show: 'value', sheet: sheets[0], cell }))}
        {show === 'chart' && charts.length > 1 && <>
          <div className={MENU_SEPARATOR} />
          <MenuSectionLabel>{t('Chart')}</MenuSectionLabel>
          {charts.map((c, i) => item(Number(params.chart ?? 0) === i, c.label, () => onChange({ chart: i }), String(i)))}
        </>}
        {show === 'value' && <>
          <div className={MENU_SEPARATOR} />
          <MenuSectionLabel>{t('Sheet')}</MenuSectionLabel>
          {sheets.map((s) => item((params.sheet ?? sheets[0]) === s, s, () => onChange({ sheet: s }), s))}
          <div className="flex gap-1.5 px-2 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
            <input aria-label={t('Cell')} value={cell} onChange={(e) => setCell(e.target.value)} onBlur={() => cellAt(cell) && onChange({ cell: cell.toUpperCase() })}
              className="h-7 w-16 rounded-md bg-muted/50 px-2 text-[13px] outline-none focus:bg-muted" placeholder="B3" />
            <input aria-label={t('Label')} value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => onChange({ label: label.trim() || null })}
              className="h-7 min-w-0 flex-1 rounded-md bg-muted/50 px-2 text-[13px] outline-none focus:bg-muted" placeholder={t('Label')} />
          </div>
        </>}
        {candidates.length > 1 && <>
          <div className={MENU_SEPARATOR} />
          <MenuSectionLabel>{t('File')}</MenuSectionLabel>
          {candidates.slice(0, 20).map((f) => item(f.id === file.id, f.name, () => onChange({ fileId: f.id, show: 'file' }), f.id))}
        </>}
        <div className={MENU_SEPARATOR} />
        <DropdownMenuItem onSelect={() => onChange({ fileId: null })}><FileUp size={13} />{t('Choose another file')}</DropdownMenuItem>
      </MenuShell>
    </DropdownMenu>
  );
}
