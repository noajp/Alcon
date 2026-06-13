'use client';

import { Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@/ui/dropdown-menu';
import type { WidgetDefinition } from './types';

interface WidgetAddMenuProps {
  available: WidgetDefinition[];
  onAdd: (type: string) => void;
}

export function WidgetAddMenu({ available, onAdd }: WidgetAddMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={available.length === 0}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <Plus size={12} />
          Add widget
        </button>
      </DropdownMenuTrigger>
      {available.length > 0 && (
        <DropdownMenuContent align="end" className="w-72 max-h-80 overflow-y-auto">
          <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Available Widgets
          </DropdownMenuLabel>
          {available.map((def) => (
            <DropdownMenuItem
              key={def.type}
              onSelect={() => onAdd(def.type)}
              className="flex-col items-start gap-0.5"
            >
              <div className="text-[13px] font-medium text-foreground">{def.label}</div>
              {def.description && (
                <div className="text-[11px] text-muted-foreground">{def.description}</div>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}
