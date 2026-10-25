'use client';

import { Plus } from 'lucide-react';
import { Button, ButtonAppearanceProvider } from '@/ui/button';

// The Strategy pages' "nothing here yet": one quiet sentence where the list
// would start, and at most one "+ verb" under it. No illustration and no
// centred card — the page is already one island, and an empty list is a fact,
// not an event. Callers pass translated text.
export function QuietEmpty({ text, cta, onCta }: { text: string; cta?: string; onCta?: () => void }) {
  return (
    <div className="px-6 py-6">
      <p className="text-[13px] text-muted-foreground">{text}</p>
      {cta && onCta && (
        <ButtonAppearanceProvider appearance="inline">
          <Button variant="ghost" size="sm" align="start" className="-ml-2 mt-1" onClick={onCta}>
            <Plus size={13} strokeWidth={2.5} />{cta}
          </Button>
        </ButtonAppearanceProvider>
      )}
    </div>
  );
}
