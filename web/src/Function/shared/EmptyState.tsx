'use client';

import type { ComponentType, ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';

// The one "nothing here yet" surface for a list — Objects, Elements,
// Initiatives, Phases. Quiet, the way an empty list reads in Linear: the
// concept's icon, one heading, a sentence or two — and then the one decisive
// action that starts the list, as the accent-blue primary button, since on an
// empty page it is the only thing to do. No boxed illustration. One fixed-
// width, left-aligned column in the middle of the pane, so two empty views
// side by side line up.
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
        <div className="mb-4 text-muted-foreground"><Icon size={20} /></div>
        <h2 className="text-[15px] font-medium text-foreground mb-1">{t(title)}</h2>
        <p className="text-[13px] leading-5 text-muted-foreground">{tr(description)}</p>
        {hint && <p className="mt-1 text-[12px] leading-[18px] text-muted-foreground/70">{tr(hint)}</p>}
        <Button variant="primary" size="sm" onClick={onCta} className="mt-4 gap-1.5">
          <Plus size={14} />
          {t(cta)}
        </Button>
      </div>
    </div>
  );
}
