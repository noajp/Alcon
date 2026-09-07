'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { statusLabel } from '@/shared/designTokens';
import {
  ElementImportRejectedError, INTAKE_FIELDS, INTAKE_LIMIT, INTAKE_TEXT_LIMIT, normalizeIntake, parseIntake, reconcileIntakeResult,
  type ElementImportResult, type ElementImportRow, type IntakeColumnMap, type IntakeFormat,
  type IntakeTable, type IntakeWorker,
} from './intakeModel';

export interface ElementIntakeProps {
  workers: readonly IntakeWorker[];
  objectName?: string;
  initialText?: string;
  /** The parent persists each row idempotently by rowKey and reports confirmed saves. */
  onImport: (rows: ElementImportRow[]) => Promise<ElementImportResult>;
  onDone?: () => void;
  onCancel?: () => void;
}

/** One small import, with reviewed columns and explicit unresolved values. */
export function ElementIntake({ workers, objectName, initialText = '', onImport, onDone, onCancel }: ElementIntakeProps) {
  const id = useId();
  const [text, setText] = useState(initialText);
  const [format, setFormat] = useState<IntakeFormat>('auto');
  const [hasHeader, setHasHeader] = useState(true);
  const [table, setTable] = useState<IntakeTable | null>(null);
  const [columns, setColumns] = useState<IntakeColumnMap | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [acceptedWarnings, setAcceptedWarnings] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ElementImportRow[] | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [assigneeMap, setAssigneeMap] = useState<Record<string, string | null>>({});
  const [readingFile, setReadingFile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileReadRef = useRef(0);
  const savingRef = useRef(false);
  useEffect(() => () => { fileReadRef.current += 1; }, []);
  const preview = useMemo(() => table && columns ? normalizeIntake(table, columns, workers, assigneeMap) : null, [table, columns, workers, assigneeMap]);
  const sourcePeople = [...new Set(preview?.rows.map((row) => row.source.assignee).filter((value): value is string => !!value) ?? [])];
  const warningCount = preview?.rows.reduce((count, row) => count + row.warnings.length, 0) ?? 0;
  const warningSignature = JSON.stringify(preview?.rows.map((row) => [row.rowKey, row.warnings]) ?? []);
  const warningsAccepted = acceptedWarnings === warningSignature;
  const remaining = snapshot?.filter((row) => !saved[row.rowKey]) ?? [];
  const selectClass = 'h-8 w-full min-w-0 rounded-md border-0 bg-muted/40 px-2 text-sm focus:bg-muted/60';

  function showPreview() {
    const parsed = parseIntake(text, { format, hasHeader });
    setParseErrors(parsed.errors);
    if (parsed.errors.length) return;
    setTable(parsed);
    setColumns(parsed.suggestedMap);
    setAcceptedWarnings(null);
    setAssigneeMap({});
  }

  async function readCsv(file: File) {
    const readId = ++fileReadRef.current;
    setParseErrors([]);
    if (file.size > 1_000_000) {
      setParseErrors(['Choose a CSV file under 1 MB. Start with one project.']);
      return;
    }
    setReadingFile(true);
    try {
      const contents = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (readId !== fileReadRef.current) return;
      if (contents.length > INTAKE_TEXT_LIMIT) {
        setParseErrors(['This CSV is too large. Start with a smaller selection.']);
        return;
      }
      setText(contents);
      setFormat('csv');
      setHasHeader(true);
    } catch {
      if (readId === fileReadRef.current) setParseErrors(['Could not read this file. Export it as UTF-8 CSV, or paste a spreadsheet selection.']);
    } finally {
      if (readId === fileReadRef.current) setReadingFile(false);
    }
  }

  async function saveRows() {
    if (savingRef.current) return;
    if (!snapshot && (!preview || preview.errors.length || (warningCount > 0 && !warningsAccepted))) return;
    const rows = snapshot ? remaining : preview?.rows ?? [];
    if (!rows.length) return;
    savingRef.current = true;
    setSaving(true);
    setRejected(false);
    // Freeze the reviewed payload before the first write; retries cannot change its meaning.
    if (!snapshot) setSnapshot(rows);
    try {
      const outcome = reconcileIntakeResult(rows, await onImport(rows));
      setSaved((current) => ({ ...current, ...outcome.saved }));
      setFailed(outcome.failed);
    } catch (error) {
      setRejected(error instanceof ElementImportRejectedError);
      const message = error instanceof Error ? error.message : 'Could not confirm the import. Retry the same rows.';
      setFailed(Object.fromEntries(rows.map((row) => [row.rowKey, message])));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (snapshot) return (
    <section className="min-w-0 space-y-4" aria-label="Import results" aria-busy={saving}>
      <div aria-live="polite" className="space-y-1">
        <h2 className="text-base font-semibold">{saving ? 'Importing Elements…' : `${Object.keys(saved).length} of ${snapshot.length} Elements imported`}</h2>
        <p className="text-sm text-muted-foreground">{saving ? 'Waiting for confirmed saves.' : rejected ? 'This attempt was rejected before changes were saved. Edit the import and try again.' : remaining.length ? 'Confirmed saves are kept. Retry only the remaining rows using the same import.' : `Your Elements are ready${objectName ? ` in ${objectName}` : ''}.`}</p>
      </div>
      <ol className="max-h-80 overflow-y-auto divide-y divide-border/50">
        {snapshot.map((row) => <li key={row.rowKey} className="space-y-1 py-3">
          <div className="flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0 break-words">{row.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{saved[row.rowKey] ? 'Imported' : saving ? 'Confirming…' : 'Not confirmed'}</span>
          </div>
          {!saved[row.rowKey] && failed[row.rowKey] && <p className="break-words text-xs text-destructive">{failed[row.rowKey]}</p>}
        </li>)}
      </ol>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {rejected && !saving && <Button onClick={() => { setSnapshot(null); setSaved({}); setFailed({}); setRejected(false); setAcceptedWarnings(null); }}>Edit import</Button>}
        {(onDone || onCancel) && <Button onClick={onDone ?? onCancel} disabled={saving}>{remaining.length ? 'Close' : 'Done'}</Button>}
        {remaining.length > 0 && <Button variant="primary" onClick={saveRows} disabled={saving}>{saving ? 'Importing…' : `Retry ${remaining.length} ${remaining.length === 1 ? 'Element' : 'Elements'}`}</Button>}
      </div>
    </section>
  );

  return (
    <section className="min-w-0 space-y-4" aria-label="Import existing work">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Bring in your existing work</h2>
        <p className="text-sm text-muted-foreground">Start with one project{objectName ? ` in ${objectName}` : ''}. Paste or choose a CSV with up to {INTAKE_LIMIT} Elements, then review before importing.</p>
      </div>

      {!table ? <>
        <div className="space-y-2">
          <label htmlFor={`${id}-paste`} className="text-sm font-medium">CSV, a spreadsheet selection, or one title per line</label>
          <textarea id={`${id}-paste`} value={text} disabled={readingFile} onChange={(event) => { setText(event.target.value); setParseErrors([]); }} rows={9}
            className="w-full resize-y rounded-md border-0 bg-muted/30 p-3 font-mono text-sm placeholder:text-muted-foreground focus:bg-muted/50"
            placeholder={'Title,Status,Due Date,Assignee Email\nPrepare launch,In Progress,2026-09-30,alex@example.com'} />
          <input ref={fileRef} id={`${id}-file`} type="file" accept=".csv,text/csv" aria-label="Choose CSV file" className="hidden" tabIndex={-1} disabled={readingFile}
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readCsv(file); }} />
          <Button disabled={readingFile} onClick={() => fileRef.current?.click()}>{readingFile ? 'Reading CSV…' : 'Choose CSV file'}</Button>
          <p className="text-xs text-muted-foreground">Common Asana, Linear, and ClickUp columns are suggested. This copies the reviewed rows once; it does not sync future changes.</p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-44 space-y-1">
            <label htmlFor={`${id}-format`} className="text-xs text-muted-foreground">Paste format</label>
            <select id={`${id}-format`} className={selectClass} value={format} disabled={readingFile} onChange={(event) => setFormat(event.target.value as IntakeFormat)}>
              <option value="auto">Detect automatically</option><option value="csv">CSV</option><option value="tsv">Spreadsheet / TSV</option><option value="lines">One title per line</option>
            </select>
          </div>
          {format !== 'lines' && <label className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" checked={hasHeader} disabled={readingFile} onChange={(event) => setHasHeader(event.target.checked)} className="accent-primary" />First row has column names</label>}
        </div>
        {parseErrors.length > 0 && <ErrorList errors={parseErrors} />}
        {text.length > INTAKE_TEXT_LIMIT && <ErrorList errors={['This paste is too large. Start with a smaller selection.']} />}
        <div className="flex justify-end gap-2">
          {onCancel && <Button onClick={onCancel}>Cancel</Button>}
          <Button variant="primary" disabled={readingFile || !text.trim() || text.length > INTAKE_TEXT_LIMIT} onClick={showPreview}>Review import</Button>
        </div>
      </> : <>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Confirm column mapping</h3>
            <span className="text-xs text-muted-foreground">{table.rows.length} Elements · {table.format === 'lines' ? 'Line list' : table.format.toUpperCase()}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {INTAKE_FIELDS.map((field) => <div key={field.id} className="min-w-0 space-y-1">
              <label htmlFor={`${id}-${field.id}`} className="text-xs text-muted-foreground">{field.label}{field.id === 'title' ? ' (required)' : ''}</label>
              <select id={`${id}-${field.id}`} className={selectClass} value={columns?.[field.id] ?? ''} onChange={(event) => {
                setColumns((current) => current && ({ ...current, [field.id]: event.target.value === '' ? null : Number(event.target.value) }));
                setAcceptedWarnings(null);
              }}>
                <option value="">{field.id === 'title' ? 'Choose a column' : 'Do not import'}</option>
                {table.headers.map((header, index) => <option key={index} value={index}>{index + 1}. {header}</option>)}
              </select>
            </div>)}
          </div>
        </div>
        {preview && preview.errors.length > 0 && <ErrorList errors={preview.errors} />}
        {sourcePeople.length > 0 && <div className="space-y-3">
          <div className="space-y-1"><h3 className="text-sm font-medium">Match people</h3><p className="text-xs text-muted-foreground">Choose an available Worker for each source name or email. Original values stay with the imported record.</p></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{sourcePeople.map((person, index) => <div className="min-w-0 space-y-1" key={person}>
            <label htmlFor={`${id}-person-${index}`} className="block break-words text-xs text-muted-foreground">{person}</label>
            <select id={`${id}-person-${index}`} className={selectClass}
              value={Object.prototype.hasOwnProperty.call(assigneeMap, person) ? assigneeMap[person] ?? '' : '__auto__'}
              onChange={(event) => { const value = event.target.value; setAssigneeMap((current) => { if (value !== '__auto__') return { ...current, [person]: value || null }; const next = { ...current }; delete next[person]; return next; }); setAcceptedWarnings(null); }}>
              <option value="__auto__">Use suggested match</option><option value="">Leave unassigned</option>
              {workers.filter((worker) => worker.status !== 'inactive').map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
            </select>
          </div>)}</div>
        </div>}
        {preview && preview.rows.length > 0 && <>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Review {preview.rows.length} {preview.rows.length === 1 ? 'Element' : 'Elements'}</h3>
            <ol className="max-h-96 overflow-y-auto divide-y divide-border/50">
              {preview.rows.map((row) => <li key={row.rowKey} className="space-y-2 py-3">
                <div className="flex items-start gap-2"><span className="shrink-0 pt-0.5 text-xs text-muted-foreground">Row {row.sourceRow}</span><p className="min-w-0 break-words text-sm font-medium">{row.title || 'Missing title'}</p></div>
                <p className="break-words text-xs text-muted-foreground">{statusLabel(row.status)} · {row.due_date ?? 'No due date'} · {workers.find((worker) => worker.id === row.worker_id)?.name ?? 'Unassigned'}</p>
                {row.description && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Description</summary><p className="mt-2 whitespace-pre-wrap break-words">{row.description}</p></details>}
                {(row.source.id || row.source.original_url) && <p className="break-words text-xs text-muted-foreground">{row.source.id && <span>Original ID: {row.source.id}{row.source.original_url ? ' · ' : ''}</span>}{row.source.url ? <a href={row.source.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Original link</a> : row.source.original_url}</p>}
                {row.warnings.length > 0 && <ul className="space-y-1 text-xs text-muted-foreground">{row.warnings.map((warning) => <li key={`${warning.field}-${warning.code}`} className="break-words">{warning.message}</li>)}</ul>}
              </li>)}
            </ol>
          </div>
          {warningCount > 0 && <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={warningsAccepted} onChange={(event) => setAcceptedWarnings(event.target.checked ? warningSignature : null)} className="mt-1 shrink-0 accent-primary" />
            <span>I reviewed the {warningCount} {warningCount === 1 ? 'warning' : 'warnings'}. Unmatched people stay unassigned, unparsed dates stay empty, and unknown statuses become To do. No Workers will be created.</span>
          </label>}
        </>}
        <p className="text-xs text-muted-foreground">Only mapped fields and their source references will be imported. Review the suggested mapping before continuing.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => { setTable(null); setColumns(null); }}>Edit paste</Button>
          <Button variant="primary" disabled={!preview?.rows.length || !!preview.errors.length || (warningCount > 0 && !warningsAccepted)} onClick={saveRows}>Confirm and import {preview?.rows.length ?? 0}</Button>
        </div>
      </>}
    </section>
  );
}

function ErrorList({ errors }: { errors: readonly string[] }) {
  return <ul role="alert" className="space-y-1 text-sm text-destructive">{errors.map((error, index) => <li key={index}>{error}</li>)}</ul>;
}
