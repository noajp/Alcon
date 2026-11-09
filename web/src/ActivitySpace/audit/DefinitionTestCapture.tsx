'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { formatError } from '@/Function/shared/formatError';
import {
  previewTestCapture, saveTestCapture,
  type CaptureFailureLike, type CapturePreview,
} from '@/hooks/definitionTestData';

// The capture confirmation (B14 §2.5 / §8.1): what a person is
// asked to confirm before a run's record becomes a definition test
// — EVERY exchange that will be stored, the keys of each call's
// arguments with the volatile marking (the keys a run legitimately
// changes: ids, timestamps), and the taint when the source run read
// the web. The server derives the fixture twice (this preview, and
// again at save with the marks), so what is confirmed here is what
// is stored; a capture that cannot be made fails HERE with its
// named reason — an unresolvable call, a credential-shaped string
// (pattern and exchange only, never the string itself), a limit —
// and no save is possible.

type Translate = (key: string, params?: Record<string, string | number>) => string;

function failureText(t: Translate, f: CaptureFailureLike): string {
  switch (f.reason) {
    case 'run_not_found': return t('This run could not be found.');
    case 'run_not_finished': return t('This run has not finished yet.');
    case 'no_definition': return t('This run did not run under a saved definition, so it cannot become a test.');
    case 'transcript_definition': return t('This run tried a draft definition, so it cannot become a test.');
    case 'unresolvable':
      return t('One of this run’s calls can no longer be resolved ({name}). Its connection or manifest may have changed since the run.', { name: f.detail ?? '' });
    case 'scrub':
      return t('The record contains a credential-shaped string ({pattern} at exchange {seq}), so nothing was recorded.', { pattern: f.detail ?? '', seq: f.seq ?? 0 });
    case 'limit':
      return f.detail === 'count'
        ? t('This run has too many exchanges to record as a test.')
        : t('This run’s record is too large to record as a test.');
    default: return t('Could not record the test.');
  }
}

export function DefinitionTestCaptureDialog({ runId, onClose, onSaved }: {
  runId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<Extract<CapturePreview, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [marks, setMarks] = useState<ReadonlyMap<number, ReadonlySet<string>>>(new Map());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    previewTestCapture(runId)
      .then((p) => {
        if (!live) return;
        if (p.ok) { setPreview(p); setName(p.definitionName); }
        else setError(failureText(t, p));
      })
      .catch((e) => { if (live) setError(formatError(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the preview is per run; t is stable per locale
  }, [runId]);

  const toggleMark = (seq: number, key: string) => {
    setMarks((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(seq) ?? []);
      if (set.has(key)) set.delete(key); else set.add(key);
      if (set.size) next.set(seq, set); else next.delete(seq);
      return next;
    });
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const res = await saveTestCapture({
        runId, name: name.trim(),
        marks: [...marks].map(([seq, keys]) => ({ seq, keys: [...keys] })),
      });
      if (res.ok) { onSaved(); return; }
      setError(failureText(t, res));
    } catch (e) {
      setError(formatError(e));
    }
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{t('Record this run as a definition test')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!preview && !error && <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>}
          {preview && (
            <>
              <p className="text-[12px] text-muted-foreground">
                {preview.sourceRunLabel} · {t('{n} exchanges', { n: preview.exchanges.length })}
              </p>
              {preview.tainted && (
                <p className="text-[12px] text-[var(--status-warning)]">
                  {t('This run read external web content, so the fixture is marked tainted.')}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                {t('Keys that change on every run — ids, timestamps — can be marked volatile: they are left out of the argument match.')}
              </p>
              <div className="max-h-[36vh] space-y-1.5 overflow-y-auto">
                {preview.exchanges.map((ex) => (
                  <div key={ex.seq} className="rounded-md border border-[var(--border-default)] p-2">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className={cn('text-[11px]', ex.kind === 'write' ? 'text-[var(--status-warning)]' : 'text-muted-foreground')}>
                        {ex.kind === 'write' ? t('Write') : t('Read')}
                      </span>
                      <span className="text-[12px] text-foreground">{ex.summary}</span>
                      <span className="text-[11px] text-muted-foreground">{ex.action}</span>
                      {ex.isError && <span className="text-[11px] text-[var(--status-danger)]">{t('Failed')}</span>}
                    </div>
                    {ex.responsePreview && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{ex.responsePreview}</p>
                    )}
                    {ex.argKeys.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {ex.argKeys.map((key) => {
                          const marked = marks.get(ex.seq)?.has(key) ?? false;
                          return (
                            <button
                              key={key}
                              type="button"
                              aria-pressed={marked}
                              onClick={() => toggleMark(ex.seq, key)}
                              className={cn(
                                'rounded-full border px-1.5 text-[11px] transition-colors',
                                marked
                                  ? 'border-[var(--accent-default)] text-[var(--accent-default)]'
                                  : 'border-[var(--border-default)] text-muted-foreground hover:text-foreground',
                              )}
                            >
                              {key}{marked ? ` · ${t('Volatile')}` : ''}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">{t('Test name')}</div>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-[13px] md:text-[13px]" />
              </div>
            </>
          )}
          {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>{t('Cancel')}</Button>
          <Button size="sm" onClick={() => void save()} disabled={busy || !preview || !name.trim()}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
