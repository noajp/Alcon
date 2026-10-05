'use client';

import type { ComponentType, ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';

// The one "nothing here yet" surface for a list — Objects, Elements,
// Initiatives, Phases. One fixed-width column sits in the middle of the
// pane and everything inside it is left-aligned, with every part a fixed
// size: the icon grid, two text rows with a two-line
// floor, and a CTA with a minimum width, so the copy's length never moves
// the grid or the button between two views that sit side by side.
export function EmptyState({ icon: Icon, title, description, hint, cta, onCta }: {
  icon: ComponentType<{ size?: number }>;
  title: string;
  description: ReactNode;
  hint: ReactNode;
  cta: string;
  onCta: () => void;
}) {
  // Callers pass English; plain strings are translated here so every empty
  // state follows the viewer's language without wiring `t` at each call site.
  const { t } = useI18n();
  const tr = (value: ReactNode) => (typeof value === 'string' ? t(value) : value);
  return (
    // flex-1 for a flex-column host, h-full for a plain block host (the
    // Initiative and Phase panes) — either way the column fills the pane.
    <div className="flex-1 h-full flex flex-col items-center justify-center py-20 px-8 select-none">
      <div className="w-full max-w-sm">
        <div className="grid w-fit grid-cols-2 gap-3 mb-6">
          {[0.18, 0.35, 0.55, 1].map((opacity, i) => (
            <div
              key={i}
              className="w-14 h-14 rounded-xl border-2 border-muted-foreground flex items-center justify-center"
              style={{ opacity, borderStyle: i === 0 ? 'dashed' : 'solid' }}
            >
              <Icon size={22} />
            </div>
          ))}
        </div>
        <h2 className="text-[15px] font-semibold text-foreground mb-1.5">{t(title)}</h2>
        <p className="text-[13px] leading-5 min-h-10 text-muted-foreground mb-2">
          {tr(description)}
        </p>
        <p className="text-[12px] leading-[18px] min-h-9 text-muted-foreground/60 mb-6">
          {tr(hint)}
        </p>
        {/* gap-1.5: the md control gap (gap-2) reads as a hole next to a 14px "+". */}
        <Button variant="primary" size="md" onClick={onCta} className="min-w-40 gap-1.5">
          <Plus size={14} />
          {t(cta)}
        </Button>
      </div>
    </div>
  );
}
