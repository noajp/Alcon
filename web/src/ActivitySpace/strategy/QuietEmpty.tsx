'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/ui/button';

// The Strategy pages' "nothing here yet": one quiet sentence where the list
// would start, and the one decisive action that starts it as the accent-blue
// primary button. No illustration and no centred card — the page is already
// one island. Callers pass translated text.
export function QuietEmpty({ text, cta, onCta }: { text: string; cta?: string; onCta?: () => void }) {
  return (
    <div className="px-6 py-6">
      <p className="text-[13px] text-muted-foreground">{text}</p>
      {cta && onCta && (
        <Button variant="primary" size="sm" className="mt-3 gap-1.5" onClick={onCta}>
          <Plus size={14} />{cta}
        </Button>
      )}
    </div>
  );
}
