'use client';

import { ACTION_LABEL, ActionIcon } from '@/Function/shared/elementAction';
import { isHumanAction } from '@/Function/shared/elementActionKinds';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { advanceFromElement, sendBackToAgent } from '@/Function/copilot/agentData';
import { formatDisplayName, getCachedDisplayNames } from '@/Function/settings/preferencesStore';
import { useAuthContext } from '@/providers/AuthProvider';
import { updateElement } from '@/hooks/useSupabase';
import type { YourTurn } from './missionModel';

// Everything in a Strategy's mission that waits on a person, at the top of
// the Execution tab, answerable where it is shown: approve a result, send it
// back with what to change, answer an AI that stopped for you, or close your
// own Element. An approval of an external write opens its Element, where the
// approval card shows exactly what will be sent.


export function YourTurnTray({ items, canEdit, onOpen, onChanged }: {
  items: YourTurn[];
  canEdit: boolean;
  onOpen: (elementId: string) => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <div className="space-y-0.5 border-l-2 border-[var(--status-warning)] pl-3">
      <p className="text-[13px] font-medium text-foreground">{t('Your turn ({n})', { n: items.length })}</p>
      <ul className="divide-y divide-border/40">
        {items.map((item) => <TurnRow key={`${item.kind}:${item.elementId}`} item={item} canEdit={canEdit} onOpen={onOpen} onChanged={onChanged} />)}
      </ul>
    </div>
  );
}

function TurnRow({ item, canEdit, onOpen, onChanged }: { item: YourTurn; canEdit: boolean; onOpen: (id: string) => void; onChanged: () => void }) {
  const { t } = useI18n();
  const { user, profile } = useAuthContext();
  // 'reply' opens the field: what to change (review) or the answer (answer).
  const [replying, setReplying] = useState(item.kind === 'answer');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markDone = async () => {
    setBusy(true); setError(null);
    try {
      await updateElement(item.elementId, { status: 'done' });
      await advanceFromElement(item.elementId);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true); setError(null);
    const authorName = formatDisplayName(profile?.display_name, user?.email, getCachedDisplayNames());
    const outcome = await sendBackToAgent(item.elementId, text, authorName);
    setBusy(false);
    if (outcome === 'failed') { setError(t('Could not send. Open the Element and try there.')); return; }
    if (outcome === 'busy') { setError(t('The AI is already working on this Element.')); return; }
    setText(''); setReplying(false);
    onChanged();
  };

  return (
    <li className="space-y-1.5 py-2">
      <div className="flex items-start gap-2">
        {/* What is asked, as the verb's icon and name, then what it is about. */}
        <span className="mt-[3px] flex shrink-0"><ActionIcon action={item.action} size={16} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-5">
            <span className="mr-1.5 font-medium" style={isHumanAction(item.action) ? { color: 'var(--status-warning)' } : undefined}>{t(ACTION_LABEL[item.action])}</span>
            <button type="button" onClick={() => onOpen(item.elementId)} className="text-left font-medium text-foreground hover:underline">
              {item.title}
            </button>
          </p>
          {item.detail && <p className="mt-0.5 line-clamp-4 text-[13px] leading-5 text-foreground/80">{item.detail}</p>}
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-1">
            {item.kind === 'approve' && (
              <Button variant="primary" size="xs" onClick={() => onOpen(item.elementId)}>{t('Open to approve')}</Button>
            )}
            {(item.kind === 'review' || item.kind === 'do') && (
              <Button variant="primary" size="xs" onClick={() => void markDone()} disabled={busy}>{t('Mark done')}</Button>
            )}
            {item.kind === 'review' && !replying && (
              <Button variant="ghost" size="xs" onClick={() => setReplying(true)} disabled={busy}>{t('Send back')}</Button>
            )}
          </div>
        )}
      </div>
      {canEdit && replying && (
        <div className="flex items-start gap-2 pl-6">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
            placeholder={item.kind === 'answer' ? t('Answer the AI — it picks up from here') : t('What should the AI change?')}
            className="min-h-[44px] flex-1 resize-y rounded-md border border-border/60 bg-transparent px-2 py-1 text-[12px] outline-none focus:bg-muted/30" />
          <Button variant="primary" size="xs" onClick={() => void send()} disabled={busy || !text.trim()}>{t('Send')}</Button>
        </div>
      )}
      {error && <p className="pl-6 text-[12px] text-[var(--status-danger)]">{error}</p>}
    </li>
  );
}
