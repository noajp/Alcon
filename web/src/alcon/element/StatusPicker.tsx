'use client';

import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { ElementProgressMark } from '@/alcon/shared/ElementProgressMark';
import { updateElement } from '@/hooks/useSupabase';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import type { ElementStatus } from '@/types/database';
import { cn } from '@/lib/utils';

// Linear-style status picker — opens from the progress ○ mark. Each row's
// icon is the same ElementProgressMark used in the list itself, so the
// preview visually matches the eventual state. The In Progress row also
// exposes a 0–100 number field that writes directly to elements.progress;
// reaching 100% flips the element to Done.

const ROWS: Array<{ status: ElementStatus; label: string; previewProgress?: number }> = [
  { status: 'backlog',     label: 'Backlog' },
  { status: 'todo',        label: 'Todo' },
  { status: 'in_progress', label: 'In Progress', previewProgress: 50 },
  { status: 'review',      label: 'In Review' },
  { status: 'done',        label: 'Done' },
  { status: 'blocked',     label: 'Blocked' },
  { status: 'cancelled',   label: 'Cancelled' },
];

interface StatusPickerProps {
  element: ElementWithDetails;
  /** Trigger mark size; defaults to 16. */
  size?: number;
  /** Override progress used to render the trigger mark (e.g. when the
   *  parent has already merged in custom-column values). */
  progress?: number;
  /** Custom trigger. When omitted, the default ○-mark button is used —
   *  lets other surfaces (e.g. the Element-detail Properties row) open
   *  this exact menu from their own control. */
  trigger?: ReactNode;
  /** Fired after a status change is persisted, so callers can run extra
   *  side effects (activity log, notifications, refresh). */
  onChanged?: (status: ElementStatus) => void;
}

export function StatusPicker({ element, size = 16, progress: progressOverride, trigger, onChanged }: StatusPickerProps) {
  const [open, setOpen] = useState(false);

  // Local draft for the number input so typing feels instant. Initialised
  // from the element; we don't re-sync on external prop changes (rare) to
  // avoid clobbering an in-flight edit — the trigger mark + menu icons
  // still update via realtime.
  const [progressDraft, setProgressDraft] = useState<string>(
    element.progress != null ? String(element.progress) : '',
  );

  const triggerProgress =
    progressOverride ??
    (typeof element.progress === 'number'
      ? element.progress
      : element.status === 'done'
        ? 100
        : element.subelements && element.subelements.length > 0
          ? Math.round(
              (element.subelements.filter((s) => s.is_completed).length / element.subelements.length) * 100,
            )
          : 0);

  const applyStatus = async (newStatus: ElementStatus) => {
    const updates: { status: ElementStatus; progress?: number | null } = { status: newStatus };
    // Auto-normalise progress at the endpoints so the mark stays in sync.
    if (newStatus === 'done') updates.progress = 100;
    else if (newStatus === 'backlog' || newStatus === 'todo') updates.progress = null;
    try {
      await updateElement(element.id, updates);
      setOpen(false);
      onChanged?.(newStatus);
    } catch (e) {
      console.error('Failed to change status', e);
    }
  };

  const commitProgress = async (raw: string) => {
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(0, Math.min(100, parsed));
    try {
      const updates: { progress: number; status?: ElementStatus } = { progress: clamped };
      // 100% snaps to Done; anything else lands in (or stays in) In Progress.
      if (clamped >= 100) updates.status = 'done';
      else if (element.status !== 'in_progress' && element.status !== 'review' && element.status !== 'done') {
        updates.status = 'in_progress';
      }
      await updateElement(element.id, updates);
      if (updates.status) onChanged?.(updates.status);
    } catch (e) {
      console.error('Failed to update progress', e);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex size-5 items-center justify-center rounded-full transition-colors hover:bg-muted/40"
            aria-label="Change status"
          >
            <ElementProgressMark
              status={element.status}
              progress={triggerProgress}
              size={size}
            />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-60 rounded-xl p-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-2 py-1.5 text-[11.5px] text-muted-foreground">Change status…</div>
        <div className="h-px bg-border mx-1 mb-1" />
        {ROWS.map((row) => {
          const isCurrent = element.status === row.status;
          return (
            <button
              key={row.status}
              type="button"
              onClick={() => applyStatus(row.status)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] transition-colors',
                isCurrent ? 'bg-accent/60 text-foreground' : 'text-foreground hover:bg-accent/40',
              )}
            >
              <span className="flex items-center justify-center w-4 h-4 shrink-0">
                <ElementProgressMark
                  status={row.status}
                  progress={row.previewProgress ?? 0}
                  size={14}
                />
              </span>
              <span className="flex-1 text-left">{row.label}</span>
              {row.status === 'in_progress' && (
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={progressDraft}
                  placeholder="%"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setProgressDraft(e.target.value)}
                  onBlur={(e) => commitProgress(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitProgress((e.target as HTMLInputElement).value);
                    }
                  }}
                  className="w-12 text-[11.5px] tabular-nums bg-muted/40 rounded px-1 py-0.5 text-center focus:outline-none"
                />
              )}
              {isCurrent && row.status !== 'in_progress' && (
                <Check size={13} className="text-foreground/80" />
              )}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
