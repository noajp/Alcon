'use client';

import { toggleSubelementComplete } from '@/hooks/useSupabase';
import { Check } from 'lucide-react';

interface SubelementRowProps {
  subelement: {
    id: string;
    title: string;
    is_completed: boolean | null;
  };
  onRefresh?: () => void;
}

export function SubelementRow({ subelement, onRefresh }: SubelementRowProps) {
  const handleToggle = async () => {
    try {
      await toggleSubelementComplete(subelement.id, !subelement.is_completed);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to toggle subelement:', e);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleToggle}
        className={`size-3.5 shrink-0 rounded-[3px] border shadow-sm transition-all flex items-center justify-center ${
          subelement.is_completed
            ? 'bg-green-500 border-transparent text-white'
            : 'border-muted-foreground/60 bg-transparent hover:border-green-500'
        }`}
      >
        {subelement.is_completed && (
          <Check className="size-2.5" strokeWidth={2.5} />
        )}
      </button>
      <span className={`text-[12px] ${subelement.is_completed ? 'text-muted-foreground' : 'text-foreground/80'}`}>
        {subelement.title}
      </span>
    </div>
  );
}
