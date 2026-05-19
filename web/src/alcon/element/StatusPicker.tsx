'use client';

import { useState } from 'react';
import { Check, XCircle, Ban } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { ElementProgressMark } from '@/alcon/shared/ElementProgressMark';
import { updateElement } from '@/hooks/useSupabase';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import type { ElementStatus } from '@/types/database';
import { cn } from '@/lib/utils';

// Linear-style status picker — opens from the progress ○ mark. Each row
// previews itself with an ElementProgressMark (or a glyph for blocked /
// cancelled). The In Progress row also exposes a 0–100 number field that
// writes directly to elements.progress.

interface PreviewMark {
  kind: 'mark';
  progress: number;
  state?: 'backlog';
}
interface PreviewIcon {
  kind: 'icon';
  Icon: typeof XCircle;
  tone: string;
}
type Preview = PreviewMark | PreviewIcon;

interface Row {
  status: Exclude<ElementStatus, never>;
  label: string;
  preview: Preview;
}

const ROWS: Row[] = [
  { status: 'backlog',     label: 'Backlog',     preview: { kind: 'mark', progress: 0,  state: 'backlog' } },
  { status: 'todo',        label: 'Todo',        preview: { kind: 'mark', progress: 0 } },
  { status: 'in_progress', label: 'In Progress', preview: { kind: 'mark', progress: 50 } },
  { status: 'review',      label: 'In Review',   preview: { kind: 'mark', progress: 75 } },
  { status: 'done',        label: 'Done',        preview: { kind: 'mark', progress: 100 } },
  { status: 'blocked',     label: 'Blocked',     preview: { kind: 'icon', Icon: XCircle, tone: 'text-rose-400' } },
  { status: 'cancelled',   label: 'Cancelled',   preview: { kind: 'icon', Icon: Ban,     tone: 'text-muted-foreground' } },
];

interface StatusPickerProps {
  element: ElementWithDetails;
  /** Trigger mark size; defaults to 16. */
  size?: number;
  /** Override progress used to render the trigger mark (e.g. when the
   *  parent has already merged in custom-column values). */
  progress?: number;
}

export function StatusPicker({ element, size = 16, progress: progressOverride }: StatusPickerProps) {
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
    // Auto-normalise progress for the no-progress / fully-done ends so the
    // mark visual stays in sync with the chosen status.
    if (newStatus === 'done') updates.progress = 100;
    else if (newStatus === 'backlog' || newStatus === 'todo') updates.progress = null;
    try {
      await updateElement(element.id, updates);
      setOpen(false);
    } catch (e) {
      console.error('Failed to change status', e);
    }
  };

  const commitProgress = async (raw: string) => {
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(0, Math.min(100, parsed));
    try {
      // Setting % implies the element is in progress (unless already done /
      // backlog explicitly).
      const updates: { progress: number; status?: ElementStatus } = { progress: clamped };
      if (element.status !== 'in_progress' && element.status !== 'review' && element.status !== 'done') {
        updates.status = 'in_progress';
      }
      await updateElement(element.id, updates);
    } catch (e) {
      console.error('Failed to update progress', e);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex size-5 items-center justify-center rounded-full transition-colors hover:bg-muted/40"
          aria-label="Change status"
        >
          <ElementProgressMark
            progress={triggerProgress}
            size={size}
            state={element.status === 'backlog' ? 'backlog' : undefined}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-60 p-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-2 py-1.5 text-[11.5px] text-muted-foreground">Change status…</div>
        <div className="h-px bg-border mx-1 mb-1" />
        {ROWS.map((row, idx) => {
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
                {row.preview.kind === 'mark' ? (
                  <ElementProgressMark
                    progress={row.preview.progress}
                    size={14}
                    state={row.preview.state}
                  />
                ) : (
                  <row.preview.Icon size={14} className={row.preview.tone} />
                )}
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
              <span className="text-[11px] text-muted-foreground/70 tabular-nums w-3 text-right">
                {idx + 1}
              </span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
