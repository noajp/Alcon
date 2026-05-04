'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Checkbox } from '@/ui/checkbox';
import { cn } from '@/lib/utils';
import { Filter, Loader, BarChart2 } from 'lucide-react';

export type FilterChipData = { key: string; value: string };

type FilterTemp = {
  status: Set<string>;
  priority: Set<string>;
};

interface FilterPopoverProps {
  initialChips?: FilterChipData[];
  onApply: (chips: FilterChipData[]) => void;
  onClear: () => void;
}

const STATUS_OPTIONS = [
  { id: 'todo', label: 'To Do', color: 'bg-zinc-400' },
  { id: 'in_progress', label: 'In Progress', color: 'bg-blue-500' },
  { id: 'review', label: 'Review', color: 'bg-amber-500' },
  { id: 'done', label: 'Done', color: 'bg-emerald-500' },
  { id: 'blocked', label: 'Blocked', color: 'bg-rose-500' },
];

const PRIORITY_OPTIONS = [
  { id: 'urgent', label: 'Urgent' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

const CATEGORIES = [
  { id: 'status' as const, label: 'Status', icon: Loader },
  { id: 'priority' as const, label: 'Priority', icon: BarChart2 },
];

type CategoryId = 'status' | 'priority';

function toggleSet(set: Set<string>, v: string): Set<string> {
  const n = new Set(set);
  if (n.has(v)) n.delete(v); else n.add(v);
  return n;
}

export function FilterPopover({ initialChips, onApply, onClear }: FilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<CategoryId>('status');
  const [temp, setTemp] = useState<FilterTemp>({
    status: new Set(), priority: new Set(),
  });

  useEffect(() => {
    if (!open) return;
    const next: FilterTemp = { status: new Set(), priority: new Set() };
    for (const c of initialChips ?? []) {
      const k = c.key.toLowerCase();
      if (k === 'status') next.status.add(c.value.toLowerCase());
      else if (k === 'priority') next.priority.add(c.value.toLowerCase());
    }
    setTemp(next);
  }, [open, initialChips]);

  const handleApply = () => {
    const chips: FilterChipData[] = [];
    temp.status.forEach((v) => chips.push({ key: 'Status', value: v }));
    temp.priority.forEach((v) => chips.push({ key: 'Priority', value: v }));
    onApply(chips);
    setOpen(false);
  };

  const handleClear = () => {
    setTemp({ status: new Set(), priority: new Set() });
    onClear();
  };

  const totalSelected = temp.status.size + temp.priority.size;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          'flex items-center gap-1.5 px-2 py-1 text-[12px] hover:bg-accent/50 rounded transition-colors',
          totalSelected > 0 ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}>
          <Filter size={13} />
          <span>Filter{totalSelected > 0 ? ` (${totalSelected})` : ''}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[480px] p-0 rounded-xl" sideOffset={4}>
        <div className="grid grid-cols-[180px_minmax(0,1fr)]">
          {/* Left: category list */}
          <div className="p-2 border-r border-border/40">
            <div className="space-y-0.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-accent',
                    active === cat.id && 'bg-accent',
                  )}
                  onClick={() => setActive(cat.id)}
                >
                  <cat.icon size={14} className="text-muted-foreground" />
                  <span className="flex-1 text-left">{cat.label}</span>
                  {active === cat.id && (
                    <span className="text-xs text-muted-foreground">
                      {temp[cat.id].size > 0 ? temp[cat.id].size : ''}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Right: options */}
          <div className="p-2">
            {active === 'status' && (
              <div className="space-y-1">
                {STATUS_OPTIONS.map((opt) => (
                  <label key={opt.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent cursor-pointer">
                    <span className={cn('h-2 w-2 rounded-full flex-shrink-0', opt.color)} />
                    <Checkbox
                      checked={temp.status.has(opt.id)}
                      onCheckedChange={() => setTemp((t) => ({ ...t, status: toggleSet(t.status, opt.id) }))}
                    />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </div>
            )}

            {active === 'priority' && (
              <div className="space-y-1">
                {PRIORITY_OPTIONS.map((opt) => (
                  <label key={opt.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent cursor-pointer">
                    <Checkbox
                      checked={temp.priority.has(opt.id)}
                      onCheckedChange={() => setTemp((t) => ({ ...t, priority: toggleSet(t.priority, opt.id) }))}
                    />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="mt-2 flex items-center justify-between border-t border-border/40 pt-2">
              <button onClick={handleClear} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                Clear all
              </button>
              <Button size="sm" className="h-7 rounded-lg text-xs px-3" onClick={handleApply}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
