'use client';

import { formatError } from '@/Function/shared/formatError';
import { useMemo, useState } from 'react';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { openInApp } from '@/Function/shared/appNavigation';
import { startElementRun } from '@/AIP/ai/agentData';
import { createElement, useDomains, useObjects } from '@/hooks/useSupabase';
import { setElementDefinition, type Definition } from '@/hooks/definitionData';

// Try a definition once: what to work on and where it lives. It becomes an
// ordinary Element under the chosen Object, following the definition, and
// its AI starts at once; the Element opens so the run can be watched. The
// result stays on the board like any other work, nothing hidden.

export function TryDefinition({ definition, onClose }: { definition: Definition; onClose: () => void }) {
  const { t } = useI18n();
  const { data: explorer } = useObjects(null);
  const { data: domains } = useDomains();
  const [task, setTask] = useState('');
  const [objectId, setObjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const byDomain = new Map<string, { name: string; objects: { id: string; name: string }[] }>();
    for (const o of explorer?.objects ?? []) {
      const id = o.domain_id ?? '';
      const name = domains.find((d) => d.id === id)?.name ?? t('No Domain');
      if (!byDomain.has(id)) byDomain.set(id, { name, objects: [] });
      byDomain.get(id)!.objects.push({ id: o.id, name: o.name });
    }
    return [...byDomain.entries()];
  }, [explorer?.objects, domains, t]);
  const domainOf = (id: string) => (explorer?.objects ?? []).find((o) => o.id === id)?.domain_id ?? null;

  const run = async () => {
    const lines = task.trim().split('\n');
    const title = lines[0].trim().slice(0, 200);
    if (!title || !objectId) return;
    setBusy(true); setError(null);
    try {
      const element = await createElement({ title, description: lines.slice(1).join('\n').trim() || null, object_id: objectId, status: 'todo' });
      await setElementDefinition(element.id, definition.id);
      const domainId = domainOf(objectId);
      const outcome = await startElementRun(element.id, domainId);
      if (outcome === 'failed') throw new Error(t('The Element was made, but its AI could not start. Open it and start the run there.'));
      onClose();
      openInApp('domain-elements', { elementId: element.id, objectId, ...(domainId ? { objectDomainId: domainId } : {}) });
    } catch (e) {
      setError(formatError(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t('Try “{name}”', { name: definition.name })}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-[12px] text-muted-foreground">{t('Runs once as an Element under the Object you choose. The AI follows this harness, and the result stays on that Element.')}</p>
          <Textarea autoFocus value={task} onChange={(e) => setTask(e.target.value)} rows={4} disabled={busy}
            placeholder={t('What should it work on? The first line becomes the Element’s title.')} className="text-[13px]" />
          <select value={objectId} onChange={(e) => setObjectId(e.target.value)} disabled={busy} aria-label={t('Object')}
            className="h-8 w-full rounded-md border border-border/60 bg-transparent px-2 text-[13px] text-foreground">
            <option value="">{t('Choose an Object…')}</option>
            {groups.map(([id, g]) => (
              <optgroup key={id || 'none'} label={g.name}>
                {g.objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </optgroup>
            ))}
          </select>
          {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>{t('Cancel')}</Button>
          <Button size="sm" onClick={() => void run()} disabled={busy || !task.trim() || !objectId}>{busy ? t('Starting…') : t('Run once')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
