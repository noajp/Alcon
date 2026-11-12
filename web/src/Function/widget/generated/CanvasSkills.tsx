'use client';
import { useState } from 'react';
import { Trash2 } from '@/ui/icons';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useCanvasSkills } from '@/hooks/canvasSkillData';
import { KNOWN_LIBRARIES, SkillImportError, resolveSkillImport, type SkillDraft } from './skills';

/**
 * The Space's canvas skills: what is imported, and importing more by
 * pasting a GitHub address, a library's name or a skill document. A
 * repository holding several documents lists them to choose from.
 */
export function CanvasSkillsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { skills, add, remove } = useCanvasSkills(spaceId);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<SkillDraft[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const have = new Set(skills.map((s) => (s.kind === 'library' ? s.url : `${s.name}|${s.url ?? ''}`)));
  const isNew = (d: SkillDraft) => !have.has(d.kind === 'library' ? d.url : `${d.name}|${d.url ?? ''}`);

  const save = async (drafts: SkillDraft[]) => {
    const fresh = drafts.filter(isNew);
    if (fresh.length) await add.mutateAsync(fresh);
    setInput(''); setFound(null); setPicked(new Set());
  };
  const run = async (value: string) => {
    setBusy(true); setError(null); setFound(null);
    try {
      const drafts = await resolveSkillImport(value);
      if (drafts.length === 1) await save(drafts);
      else { setFound(drafts); setPicked(new Set()); }
    } catch (e) {
      setError(e instanceof SkillImportError ? t(e.message) : e instanceof Error ? e.message : t('Could not import this.'));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{t('Canvas skills')}</DialogTitle></DialogHeader>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t('What canvases in this Space can draw with: libraries they load, and skill documents AI follows when it draws.')}</p>

        <form className="flex items-start gap-2" onSubmit={(e) => { e.preventDefault(); if (input.trim() && !busy) void run(input); }}>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={input.includes('\n') ? 6 : 1} disabled={busy}
            placeholder={t('Paste a GitHub address, a library name or a skill document')}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !input.includes('\n')) { e.preventDefault(); if (input.trim() && !busy) void run(input); } }}
            className="no-focus-ring min-h-8 flex-1 resize-none rounded-md bg-muted/40 px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:bg-muted/70" />
          <Button type="submit" variant="primary" size="sm" disabled={busy || !input.trim()}>{busy ? t('Working…') : t('Import')}</Button>
        </form>
        {error && <p role="alert" className="text-[12.5px] text-[var(--status-danger)]">{error}</p>}

        {found && (
          <div className="rounded-md border border-border/60 p-2">
            <p className="px-1 pb-1.5 text-[12px] text-muted-foreground">{t('{n} skill documents found. Choose which to import.', { n: found.length })}</p>
            <ul className="max-h-48 overflow-y-auto">
              {found.map((d, i) => (
                <li key={i}>
                  <label className={`flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[13px] hover:bg-muted/50 ${isNew(d) ? '' : 'opacity-50'}`}>
                    <input type="checkbox" disabled={!isNew(d)} checked={picked.has(i)}
                      onChange={() => setPicked((prev) => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; })} />
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setFound(null)}>{t('Cancel')}</Button>
              <Button variant="primary" size="sm" disabled={!picked.size || add.isPending} onClick={() => void save(found.filter((_, i) => picked.has(i)))}>{t('Import')}</Button>
            </div>
          </div>
        )}

        {!found && (
          <div className="flex flex-wrap gap-1.5">
            {KNOWN_LIBRARIES.filter((l) => !have.has(l.url)).map((l) => (
              <button key={l.url} type="button" disabled={busy} onClick={() => void run(l.match[0])}
                className="rounded-full border border-border/60 px-2.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:border-[var(--border-strong)] hover:text-foreground">+ {l.name}</button>
            ))}
          </div>
        )}

        <ul className="max-h-64 overflow-y-auto border-t border-border/60 pt-2">
          {skills.map((s) => (
            <li key={s.id} className="group flex h-9 items-center gap-2.5 text-[13px]">
              <span className="w-16 shrink-0 text-[11.5px] text-muted-foreground">{s.kind === 'library' ? t('Library') : t('Guide')}</span>
              <span className="min-w-0 flex-1 truncate text-foreground" title={s.url ?? undefined}>{s.name}</span>
              <Button variant="ghost" size="icon-xs" aria-label={t('Remove {name}', { name: s.name })} title={t('Remove')}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => remove.mutate(s.id)}><Trash2 size={13} /></Button>
            </li>
          ))}
          {!skills.length && <li className="py-3 text-[12.5px] text-muted-foreground">{t('Nothing imported yet.')}</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
