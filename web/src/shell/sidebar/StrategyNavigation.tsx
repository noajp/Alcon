'use client';

import { Button } from '@/ui/button';
import { VIEW_REGISTRY } from '@/shell/viewRegistry';

export function StrategyNavigation({ activeView, onSelect }: { activeView: string; onSelect: (view: string) => void }) {
  return <nav aria-label="Initiatives" className="mb-1 mt-1">
    {(['strategy', 'phase', 'timeline'] as const).map((id) => {
      const { icon: Icon, label } = VIEW_REGISTRY[id];
      return <div key={id} className={id === 'strategy' ? '' : 'ml-4 border-l border-[var(--border-subtle)] pl-2'}>
        <Button variant="ghost" size="md" align="start" aria-current={activeView === id ? 'page' : undefined}
          className={`w-full gap-2.5 text-xs font-semibold ${activeView === id ? 'bg-sidebar-accent text-foreground' : ''}`}
          onClick={() => onSelect(id)}>{Icon && <Icon size={16} />}{label}</Button>
      </div>;
    })}
  </nav>;
}
