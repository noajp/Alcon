'use client';

import type { ReactNode } from 'react';
import { MoreHorizontal, Copy, Trash2, ArrowRightLeft, GitBranch, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/ui/dropdown-menu';
import { useI18n } from '@/Function/i18n/I18nProvider';

export interface ActionTarget {
  id: string;
  name: string;
}

/**
 * The "⋯" actions menu attached to the lowest breadcrumb item (the current
 * Element or Object). Presentational + behavioural-by-prop so the Element and
 * Object detail views share one menu: Duplicate / Move / Multi-home / Delete.
 *
 * - Move    → re-parents the entity (new primary Object / Domain). Lists every
 *             target except the current primary.
 * - Multi-home → toggles secondary memberships (element_objects / object_domains).
 *             The current primary is shown but locked (you can't un-home the
 *             primary here — use Move). Stays open across toggles.
 */
export function EntityActionsMenu({
  targets,
  primaryId,
  memberIds,
  moveLabel,
  multiHomeLabel,
  targetEmptyLabel = 'No targets',
  onDuplicate,
  onMove,
  onToggleMultiHome,
  onDelete,
  ariaLabel = 'Actions',
  children,
}: {
  targets: ActionTarget[];
  /** Current primary membership — excluded from Move, locked in Multi-home. */
  primaryId: string | null;
  /** Full current membership set — drives the Multi-home checkmarks. */
  memberIds: string[];
  moveLabel: string;
  multiHomeLabel: string;
  targetEmptyLabel?: string;
  onDuplicate: () => void;
  onMove: (targetId: string) => void;
  onToggleMultiHome: (targetId: string, isMember: boolean) => void;
  onDelete: () => void;
  ariaLabel?: string;
  /** Extra entity-specific `DropdownMenuItem`s (e.g. Object's "Rename ID
   *  prefix") — rendered between Multi-home and the destructive Delete, so
   *  they read as more settings, not actions bundled with it. */
  children?: ReactNode;
}) {
  // Callers pass English labels; translate them here (a no-op when already translated).
  const { t: tr } = useI18n();
  const memberSet = new Set(memberIds);
  const moveTargets = targets.filter((t) => t.id !== primaryId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={tr(ariaLabel)}
          title={tr(ariaLabel)}
          className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[190px]">
        <DropdownMenuItem onClick={onDuplicate} className="gap-2 text-[13px]">
          <Copy size={13} className="text-muted-foreground" /> {tr('Duplicate')}
        </DropdownMenuItem>

        {/* Move — re-parent to a different primary */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2 text-[13px]">
            <ArrowRightLeft size={13} className="text-muted-foreground" /> {tr(moveLabel)}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[190px] max-h-[320px] overflow-auto">
            {moveTargets.length === 0 ? (
              <div className="px-2 py-1.5 text-[12px] text-muted-foreground/70">{tr(targetEmptyLabel)}</div>
            ) : (
              moveTargets.map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => onMove(t.id)} className="gap-2 text-[13px]">
                  <span className="truncate">{t.name}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Multi-home — toggle secondary memberships; menu stays open */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2 text-[13px]">
            <GitBranch size={13} className="text-muted-foreground" /> {tr(multiHomeLabel)}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[190px] max-h-[320px] overflow-auto">
            {targets.length === 0 ? (
              <div className="px-2 py-1.5 text-[12px] text-muted-foreground/70">{tr(targetEmptyLabel)}</div>
            ) : (
              targets.map((t) => {
                const isMember = memberSet.has(t.id);
                const isPrimary = t.id === primaryId;
                return (
                  <DropdownMenuItem
                    key={t.id}
                    disabled={isPrimary}
                    onSelect={(e) => {
                      e.preventDefault(); // keep the submenu open for multiple toggles
                      if (!isPrimary) onToggleMultiHome(t.id, isMember);
                    }}
                    className="gap-2 text-[13px]"
                  >
                    <span className="w-3.5 shrink-0 flex items-center justify-center">
                      {isMember && <Check size={13} />}
                    </span>
                    <span className="truncate flex-1">{t.name}</span>
                    {isPrimary && <span className="text-[10px] text-muted-foreground/70 shrink-0">{tr('primary')}</span>}
                  </DropdownMenuItem>
                );
              })
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {children && (
          <>
            <DropdownMenuSeparator />
            {children}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onDelete}
          className="gap-2 text-[13px] text-destructive focus:text-destructive"
        >
          <Trash2 size={13} /> {tr('Delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
