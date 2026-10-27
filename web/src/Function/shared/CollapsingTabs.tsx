'use client';

import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/ui/button';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { MenuShell, MENU_ROW } from '@/Function/shared/menu';

// =============================================================
// CollapsingTabs — a strip of view tabs that folds into one menu when the
// width runs out, the way Linear's view switcher does: the selected view
// stays on screen as a tab with a ▾, and the rest are one click away in a
// list. A strip that scrolls sideways hides views without saying so; a cut
// tab ("Boa…") reads as broken.
//
// The caller still draws the full strip (with its own drag and context
// menus); this decides, from a hidden copy of the plain tabs, whether that
// strip fits.
// =============================================================

export interface TabItem {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  badge?: ReactNode;
}

export function CollapsingTabs({ items, activeId, onSelect, strip, trailing, menuLabel }: {
  items: TabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  /** The full strip, shown while it fits. */
  strip: ReactNode;
  /** Right after the tabs in both forms — the "+" that adds a view. */
  trailing?: ReactNode;
  /** Accessible name of the folded menu ("Views"). */
  menuLabel: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const after = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const box = outer.current;
    const row = measure.current;
    if (!box || !row) return;
    const check = () => {
      const needed = row.offsetWidth + (after.current?.offsetWidth ?? 0) + 6;
      setFolded(needed > box.clientWidth);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(box);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  const active = items.find((item) => item.id === activeId) ?? items[0];

  return (
    <div ref={outer} className="relative flex min-w-0 flex-1 items-center gap-1.5">
      {/* The plain strip at its natural width, off screen, to measure. */}
      <div ref={measure} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex w-max items-center gap-1.5">
        {items.map((item) => (
          <Button key={item.id} type="button" tabIndex={-1} shape="tab" variant="ghost">
            <item.icon size={14} />{item.label}{item.badge}
          </Button>
        ))}
      </div>

      {folded && active ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" shape="tab" variant="secondary" aria-label={menuLabel} className="min-w-0 max-w-full">
              <span className="text-foreground"><active.icon size={14} /></span>
              <span className="min-w-0 truncate">{active.label}</span>
              <ChevronDown size={12} className="text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <MenuShell align="start" aria-label={menuLabel}>
            {items.map((item) => (
              <button key={item.id} type="button" className={MENU_ROW}
                onClick={() => { onSelect(item.id); setOpen(false); }}>
                <span className="text-muted-foreground"><item.icon size={14} /></span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.badge}
                {item.id === active.id && <Check size={13} className="text-muted-foreground" />}
              </button>
            ))}
          </MenuShell>
        </Popover>
      ) : (
        <div className="min-w-0">{strip}</div>
      )}
      {trailing && <div ref={after} className="flex shrink-0 items-center">{trailing}</div>}
    </div>
  );
}
