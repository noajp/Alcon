'use client';

import { ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuItem } from '@/ui/dropdown-menu';
import { MenuShell, MenuSectionLabel, MENU_ROW, MENU_SEPARATOR } from '@/Function/shared/menu';
import { Button } from '@/ui/button';
import { DIMENSIONS, DIMENSION_LABEL, type Dimension } from '@/Function/shared/dimensions';
import { WidgetHeaderAction } from './WidgetFrame';
import type { WidgetParams } from './types';

// =============================================================
// The axis control, in the frame's own header.
//
// It rides the header slot the Initiative's composers already use, so a figure's
// configuration sits where its name is rather than inside the figure — the
// reader is not asked to look past a chart to find out what the chart is
// counting.
//
// The vocabulary is the same one the Display menu offers for grouping a list,
// because it is the same operation: a dimension learned in one place is
// already known in the other.
// =============================================================

const SHAPES: { id: 'bar' | 'donut'; label: string }[] = [
  { id: 'bar', label: 'Bars' },
  { id: 'donut', label: 'Donut' },
];

export function DimensionPicker({
  value,
  shape,
  onChange,
}: {
  value: Dimension;
  /** Omitted by figures that have only one way to draw themselves. */
  shape?: 'bar' | 'donut';
  onChange: (params: WidgetParams) => void;
}) {
  return (
    <WidgetHeaderAction>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="xs" align="start">
            {DIMENSION_LABEL[value]}
            <ChevronDown size={12} />
          </Button>
        </DropdownMenuTrigger>
        <MenuShell as="dropdown" align="end" width="standard">
          <MenuSectionLabel>Count by</MenuSectionLabel>
          {DIMENSIONS.map((d) => (
            <DropdownMenuItem
              key={d}
              className={MENU_ROW}
              onSelect={() => onChange({ dimension: d })}
            >
              <span className="flex-1">{DIMENSION_LABEL[d]}</span>
              {d === value && <span className="text-[11px] text-muted-foreground">✓</span>}
            </DropdownMenuItem>
          ))}

          {shape && (
            <>
              <div className={MENU_SEPARATOR} />
              <MenuSectionLabel>Draw as</MenuSectionLabel>
              {SHAPES.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  className={MENU_ROW}
                  onSelect={() => onChange({ shape: s.id })}
                >
                  <span className="flex-1">{s.label}</span>
                  {s.id === shape && <span className="text-[11px] text-muted-foreground">✓</span>}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </MenuShell>
      </DropdownMenu>
    </WidgetHeaderAction>
  );
}
