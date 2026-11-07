'use client';

import { useState } from 'react';
import { Columns3, Rows3 } from '@/ui/icons';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';

// A board's orientation, one preference for every board: the groups
// stand as columns and the cards stack down (vertical), or the groups
// lie as rows and the cards flow sideways (horizontal). Whichever board
// a person turns — a Strategy's Execution Chain, a Domain's, the
// Cascade down — every board follows, so the choice is kept once, in
// localStorage, rather than per surface.

export type BoardOrientation = 'vertical' | 'horizontal';

const STORAGE_KEY = 'alcon-board-orientation';

function readOrientation(): BoardOrientation {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'horizontal' ? 'horizontal' : 'vertical';
  } catch {
    return 'vertical';
  }
}

/** The shared orientation, and the way to change it: changing it
 *  anywhere writes the one preference all boards read on mount. */
export function useBoardOrientation(): [BoardOrientation, (next: BoardOrientation) => void] {
  const [orientation, setOrientation] = useState<BoardOrientation>(() =>
    typeof window === 'undefined' ? 'vertical' : readOrientation());
  const change = (next: BoardOrientation) => {
    setOrientation(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* the choice lasts this visit */ }
  };
  return [orientation, change];
}

/** The two board orientations as one quiet segmented control. */
export function BoardOrientationToggle({ orientation, onChange, className }: {
  orientation: BoardOrientation;
  onChange: (next: BoardOrientation) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const option = (value: BoardOrientation, label: string, Icon: typeof Columns3) => {
    const active = orientation === value;
    return (
      <button type="button" aria-pressed={active} title={label} aria-label={label}
        onClick={() => onChange(value)}
        className={cn('inline-flex h-6 w-6 items-center justify-center rounded',
          active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}>
        <Icon size={14} />
      </button>
    );
  };
  return (
    <div className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border/60 p-0.5', className)}>
      {option('vertical', t('Vertical'), Columns3)}
      {option('horizontal', t('Horizontal'), Rows3)}
    </div>
  );
}
