'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Check, FolderInput, Trash2 } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { ActionsButton, ActionsContextMenu, type ActionItem } from '@/Function/shared/ActionMenus';
import { MenuShell } from '@/Function/shared/menu';
import { Popover, PopoverAnchor } from '@/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/ui/command';
import { NavStrategyIcon } from '@/Frame/sidebar/NavIcons';
import { useAuthContext } from '@/providers/AuthProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useSpaceRole } from '@/Function/space/data';
import { canEditInitiative } from '@/Function/strategy/initiativeAccess';
import { deleteStrategy, moveInitiative, useStrategies } from '@/hooks/strategyData';
import { buildInitiativeTree, flattenInitiativeTree, inSpace } from './initiativeTree';

/** The Strategy a menu acts on — where it sits and who made it. */
interface InitiativeRef {
  id: string;
  name: string;
  /** The Strategies it is nested in. */
  parentIds: string[];
  created_by: string | null;
  activity_space_id?: string | null;
}

/**
 * A Strategy's actions, wherever it is shown: move it to the top or into
 * another Strategy, and delete it. Only its creator may change it (the
 * strategies policy), so for anyone else there are no actions. Deleting
 * leaves the linked Objects and their Elements alone; a refusal is said, not
 * swallowed.
 */
function useInitiativeActions(initiative: InitiativeRef, opts: { onDelete?: () => void } = {}) {
  const { t } = useI18n();
  const { user } = useAuthContext();
  const [moving, setMoving] = useState(false);
  const ownsItsSpace = useSpaceRole(initiative.activity_space_id ?? null) === 'owner';
  const canEdit = canEditInitiative(user?.id, initiative.created_by, ownsItsSpace);

  const remove = async () => {
    const ok = await appDialog.confirm(
      `${t('Delete "{name}"?', { name: initiative.name })} ${t("Its Intents, comments, and nesting links are deleted. Linked Objects stay. This can't be undone.")}`,
    );
    if (!ok) return;
    try { await deleteStrategy(initiative.id); }
    catch (e) { await appDialog.alert(e instanceof Error ? e.message : t('Could not delete the Strategy')); }
  };

  const items: ActionItem[] = canEdit ? [
    { key: 'move', label: t('Move to…'), icon: <FolderInput size={14} />, onSelect: () => setMoving(true) },
    { key: 'delete', label: t('Delete'), icon: <Trash2 size={14} />, destructive: true, separatorBefore: true, onSelect: opts.onDelete ?? (() => void remove()) },
  ] : [];

  const picker = moving
    ? <InitiativeMovePicker initiative={initiative} onClose={() => setMoving(false)} />
    : null;
  return { items, picker };
}

/** Right-click on a Strategy row opens its actions. */
export function InitiativeMenu({ initiative, children }: { initiative: InitiativeRef; children: ReactNode }) {
  const { items, picker } = useInitiativeActions(initiative);
  return (
    <>
      <ActionsContextMenu items={items}>{children}</ActionsContextMenu>
      {picker}
    </>
  );
}

/** The "…" for a Strategy — on its row, or beside its name on its page.
 *  `onDelete` replaces the plain confirm (the page asks in its own dialog). */
export function InitiativeActionsButton({ initiative, onDelete }: { initiative: InitiativeRef; onDelete?: () => void }) {
  const { t } = useI18n();
  const { items, picker } = useInitiativeActions(initiative, { onDelete });
  return (
    <>
      <ActionsButton items={items} label={t('Strategy actions')} />
      {picker}
    </>
  );
}

// Where a Strategy can go: to the top, or into any other Strategy of the
// Space that is not inside it, listed as the tree. The current place is
// checked.
function InitiativeMovePicker({ initiative, onClose }: { initiative: InitiativeRef; onClose: () => void }) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: strategies } = useStrategies();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const targets = useMemo(() => {
    const inside = new Set<string>([initiative.id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const s of strategies) if (!inside.has(s.id) && s.parentIds.some((p) => inside.has(p))) { inside.add(s.id); grew = true; }
    }
    const rows = flattenInitiativeTree(buildInitiativeTree(strategies.filter((s) => inSpace(s, spaceId, () => true))), () => true);
    const seen = new Set<string>();
    return rows.filter(({ initiative: s }) => {
      if (inside.has(s.id) || seen.has(s.id)) return false;
      seen.add(s.id);
      return !q || s.name.toLowerCase().includes(q);
    });
  }, [strategies, spaceId, initiative.id, q]);

  const go = async (to: { parentId: string | null }) => {
    onClose();
    try { await moveInitiative(initiative.id, to, initiative.parentIds); }
    catch (e) {
      // 23514: the target sits inside this Strategy.
      const code = (e as { code?: string } | null)?.code;
      await appDialog.alert(code === '23514' ? t("A Strategy can't go inside one of its own.") : e instanceof Error ? e.message : t("Couldn't save"));
    }
  };
  const atTop = initiative.parentIds.length === 0;

  return (
    <Popover open onOpenChange={(v) => { if (!v) onClose(); }}>
      <PopoverAnchor className="h-0" />
      {/* Opened from a right-click menu, it appears as that menu closes and
          hands focus back — a focus move that is not the person leaving it.
          A click elsewhere or Escape still closes it. */}
      <MenuShell width="wide" align="start" onFocusOutside={(e) => e.preventDefault()}>
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t('Move to…')} autoFocus />
          <CommandList>
            <CommandEmpty>{t('No matches.')}</CommandEmpty>
            {!q && (
              <CommandItem value="__top" onSelect={() => void go({ parentId: null })}>
                <span className="flex-1 text-muted-foreground">{t('Top level')}</span>
                {atTop && <Check size={12} />}
              </CommandItem>
            )}
            {targets.map(({ initiative: p, depth, key }) => (
              <CommandItem key={key} value={`strategy ${p.id}`} onSelect={() => void go({ parentId: p.id })}>
                <span style={{ width: q ? 0 : depth * 12 }} className="shrink-0" /><NavStrategyIcon size={12} /><span className="flex-1 truncate">{p.name}</span>
                {initiative.parentIds.includes(p.id) && <Check size={12} />}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </MenuShell>
    </Popover>
  );
}
