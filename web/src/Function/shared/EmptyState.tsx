'use client';

import type { ComponentType, ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/ui/button';

// The one "nothing here yet" surface for a list of Objects or Elements.
// Every part has a fixed size — the icon grid, two text rows with a
// two-line floor, and a CTA with a minimum width — so the copy's length
// never moves the grid or the button between two views that sit side by
// side (Objects and Elements were 20px apart because one description
// wrapped to three lines).
export function EmptyState({ icon: Icon, title, description, hint, cta, onCta }: {
  icon: ComponentType<{ size?: number }>;
  title: string;
  description: ReactNode;
  hint: ReactNode;
  cta: string;
  onCta: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-20 px-6 select-none">
      <div className="grid grid-cols-2 gap-3 mb-6">
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
      <h2 className="text-[15px] font-semibold text-foreground mb-1.5">{title}</h2>
      <p className="text-[13px] leading-5 min-h-10 text-muted-foreground text-center max-w-sm mb-2">
        {description}
      </p>
      <p className="text-[12px] leading-[18px] min-h-9 text-muted-foreground/60 text-center max-w-sm mb-6">
        {hint}
      </p>
      <Button variant="primary" size="md" onClick={onCta} className="min-w-40">
        <Plus size={14} />
        {cta}
      </Button>
    </div>
  );
}
