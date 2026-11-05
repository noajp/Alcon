'use client';

import {
  Activity, Check, FileText, Forward, ListTree, MessageCircleQuestion, PenLine, Play, Scale, Search, Send, ShieldCheck,
  Stamp, UserCheck,
} from '@/ui/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { cn } from '@/lib/utils';
import { ELEMENT_ACTIONS, isHumanAction, type ElementAction } from './elementActionKinds';

// What an Element asks someone to do, as a verb with an icon — the single
// table of verb → glyph. Status says how far it got; the action says what
// kind of work it is. The verbs only a person can do (judge, decide, approve,
// answer) draw in the warning tone, so the work that waits on a person stands
// out wherever an Element shows its action.

const ICON: Record<ElementAction, typeof Scale> = {
  judge: Scale,            // weighing options
  decide: Stamp,           // the seal on a settled call
  approve: UserCheck,      // a person said yes
  answer: MessageCircleQuestion, // only someone who knows can answer
  plan: ListTree,          // breaking it down
  research: Search,
  create: PenLine,
  execute: Play,
  verify: ShieldCheck,
  report: FileText,
  send: Send,
  delegate: Forward,
  monitor: Activity,
};

export const ACTION_LABEL: Record<ElementAction, string> = {
  judge: 'Judge', decide: 'Decide', approve: 'Approve', answer: 'Answer',
  plan: 'Plan', research: 'Research', create: 'Create', execute: 'Execute', verify: 'Verify',
  report: 'Report', send: 'Send', delegate: 'Delegate', monitor: 'Monitor',
};

const HUMAN_TONE = 'var(--status-warning)';

/** The action's icon, toned for a person's verb. */
export function ActionIcon({ action, size = 14, className }: { action: ElementAction; size?: number; className?: string }) {
  const Icon = ICON[action];
  return <Icon size={size} strokeWidth={2} className={cn('shrink-0', className)} style={isHumanAction(action) ? { color: HUMAN_TONE } : undefined} />;
}

/** Icon and verb together — where an Element says what it asks for. */
export function ActionTag({ action, className }: { action: ElementAction; className?: string }) {
  const { t } = useI18n();
  const human = isHumanAction(action);
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-[11px] font-medium', human ? '' : 'text-muted-foreground', className)}
      style={human ? { color: HUMAN_TONE } : undefined}>
      <ActionIcon action={action} size={12} />
      {t(ACTION_LABEL[action])}
    </span>
  );
}

/** Choose an Element's action: the person's verbs first, then the work an AI
 *  can carry. Without `trigger`, the tag (or a quiet "Set action") opens it. */
export function ActionPicker({ value, onChange, disabled, trigger }: {
  value: ElementAction | null;
  onChange: (action: ElementAction | null) => void;
  disabled?: boolean;
  /** A control of the caller's that opens the menu (a properties row, say). */
  trigger?: React.ReactNode;
}) {
  const { t } = useI18n();
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const row = (a: ElementAction) => (
    <DropdownMenuItem key={a} onSelect={() => { if (a !== value) onChange(a); }} className="gap-2.5 py-1.5 text-[13px]">
      <ActionIcon action={a} size={15} />
      <span className="flex-1">{t(ACTION_LABEL[a])}</span>
      {a === value && <Check size={13} />}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {trigger ?? <button type="button" onPointerDown={stop} onClick={stop} aria-label={t('Action')}
          className="inline-flex h-6 items-center rounded-md px-1 text-[13px] transition-colors hover:bg-muted/60 disabled:pointer-events-none data-[state=open]:bg-muted/60">
          {value ? <ActionTag action={value} className="text-[13px]" /> : <span className="text-muted-foreground">{t('Set action')}</span>}
        </button>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]" onClick={stop}>
        {ELEMENT_ACTIONS.filter(isHumanAction).map(row)}
        <DropdownMenuSeparator />
        {ELEMENT_ACTIONS.filter((a) => !isHumanAction(a)).map(row)}
        {value && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(null)} className="py-1.5 text-[13px] text-muted-foreground">{t('Clear')}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
