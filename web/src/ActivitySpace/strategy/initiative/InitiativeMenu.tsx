'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Check, FolderInput, Trash2 } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { ActionsButton, ActionsContextMenu, type ActionItem } from '@/Function/shared/ActionMenus';
import { MenuShell } from '@/Function/shared/menu';
import { Popover, PopoverAnchor } from '@/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/ui/command';
import { NavStrategyIcon, NavVisionIcon } from '@/shell/sidebar/NavIcons';
import { useAuthContext } from '@/providers/AuthProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useSpaceRole } from '@/Function/space/data';
import { canEditInitiative } from '@/Function/strategy/initiativeAccess';
import { deleteStrategy, moveInitiative, useStrategies } from '@/hooks/strategyData';
import { useVisions } from '@/hooks/visionData';

/** The Initiative a menu acts on — where it sits and who made it. */
interface InitiativeRef {
  id: string;
  name: string;
  vision_id: string | null;
  /** The Initiatives it is nested in. */
  parentIds: string[];
  created_by: string | null;
  activity_space_id?: string | null;
}

/**
 * An Initiative's actions, wherever it is shown: move it to the top of a
 * Vision or into another Initiative, and delete it. Only its creator may change it (the
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
    catch (e) { await appDialog.alert(e instanceof Error ? e.message : t('Could not delete the Initiative')); }
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

/** Right-click on an Initiative row opens its actions. */
export function InitiativeMenu({ initiative, children }: { initiative: InitiativeRef; children: ReactNode }) {
  const { items, picker } = useInitiativeActions(initiative);
  return (
    <>
      <ActionsContextMenu items={items}>{children}</ActionsContextMenu>
      {picker}
    </>
  );
}

/** The "…" for an Initiative — on its row, or beside its name on its page.
 *  `onDelete` replaces the plain confirm (the page asks in its own dialog). */
export function InitiativeActionsButton({ initiative, onDelete }: { initiative: InitiativeRef; onDelete?: () => void }) {
  const { t } = useI18n();
  const { items, picker } = useInitiativeActions(initiative, { onDelete });
  return (
    <>
      <ActionsButton items={items} label={t('Initiative actions')} />
      {picker}
    </>
  );
}

// Where an Initiative can go: to the top of any of the Space's Visions, into
// any other Initiative under it, or out of every Vision. The current place
// is checked.
function InitiativeMovePicker({ initiative, onClose }: { initiative: InitiativeRef; onClose: () => void }) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: visions } = useVisions(spaceId);
  const { data: strategies } = useStrategies();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => visions.map((v) => ({
    vision: v,
    parents: strategies.filter((s) => s.vision_id === v.id && s.id !== initiative.id && (!q || s.name.toLowerCase().includes(q))),
  })).filter((g) => !q || g.vision.name.toLowerCase().includes(q) || g.parents.length > 0), [visions, strategies, initiative.id, q]);

  const go = async (to: { parentId: string | null; visionId: string | null }) => {
    onClose();
    try { await moveInitiative(initiative.id, to, initiative.parentIds); }
    catch (e) {
      // 23514: the target sits inside this Initiative.
      const code = (e as { code?: string } | null)?.code;
      await appDialog.alert(code === '23514' ? t("An Initiative can't go inside one of its own.") : e instanceof Error ? e.message : t("Couldn't save"));
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
            {groups.map(({ vision, parents }) => (
              <div key={vision.id}>
                <CommandItem value={`vision ${vision.id}`} onSelect={() => void go({ parentId: null, visionId: vision.id })}>
                  <NavVisionIcon size={12} /><span className="flex-1 truncate">{vision.name}</span>
                  {atTop && initiative.vision_id === vision.id && <Check size={12} />}
                </CommandItem>
                {parents.map((p) => (
                  <CommandItem key={p.id} value={`initiative ${p.id}`} onSelect={() => void go({ parentId: p.id, visionId: vision.id })}>
                    <span className="w-2.5" /><NavStrategyIcon size={12} /><span className="flex-1 truncate">{p.name}</span>
                    {initiative.parentIds.includes(p.id) && <Check size={12} />}
                  </CommandItem>
                ))}
              </div>
            ))}
            {(initiative.vision_id || !atTop) && !q && (
              <CommandItem value="__none" onSelect={() => void go({ parentId: null, visionId: null })}>
                <span className="flex-1 text-muted-foreground">{t('Not in a Vision')}</span>
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </MenuShell>
    </Popover>
  );
}
