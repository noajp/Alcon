'use client';

import { useState } from 'react';
import { Smile } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useEscapeLayer } from '@/Function/shared/keyboard';

const QUICK_EMOJI = ['👍', '🎉', '❤️', '👀', '🚀', '✅'];

/** The smile that opens a quick-emoji palette; a pick toggles the viewer's
 *  reaction. Shared by an Element's page and a Strategy's, with
 *  ReactionChips at the end of the same row. */
export function ReactionPicker({ onToggle }: { onToggle: (emoji: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  useEscapeLayer(open, () => setOpen(false));
  const pick = (emoji: string) => { setOpen(false); onToggle(emoji); };
  return (
      <div className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t('Add reaction')} aria-label={t('Add reaction')}>
          <Smile size={15} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full z-50 mt-1 flex gap-0.5 rounded-md border border-border bg-popover p-1 shadow-lg">
              {QUICK_EMOJI.map((e) => (
                <button key={e} type="button" onClick={() => pick(e)} className="h-7 w-7 rounded text-base hover:bg-accent">{e}</button>
              ))}
            </div>
          </>
        )}
      </div>
  );
}

/** The reactions already given, as chips — two 👍 read as 👍 2, with the
 *  viewer's own lit. A chip toggles the viewer's reaction. */
export function ReactionChips({ reactions, userId, onToggle }: {
  reactions: readonly { emoji: string; user_id: string }[];
  userId: string | null;
  onToggle: (emoji: string) => void;
}) {
  const counts = new Map<string, number>();
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
  const mine = new Set(reactions.filter((r) => r.user_id === userId).map((r) => r.emoji));
  return (
    <>
      {[...counts.entries()].map(([emoji, n]) => (
        <button key={emoji} type="button" onClick={() => onToggle(emoji)}
          className={`inline-flex h-7 items-center gap-1 rounded-full px-1.5 text-[11px] transition-colors ${
            mine.has(emoji) ? 'bg-primary/15 text-foreground' : 'text-foreground/80 hover:bg-muted'}`}>
          <span>{emoji}</span>
          <span className="tabular-nums">{n}</span>
        </button>
      ))}
    </>
  );
}
