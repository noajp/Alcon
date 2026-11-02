'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Check, FolderInput, Trash2 } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { ActionsButton, ActionsContextMenu, type ActionItem } from '@/Function/shared/ActionMenus';
import { MenuShell } from '@/Function/shared/menu';
import { Popover, PopoverAnchor } from '@/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/ui/command';
import { NavPortfolioIcon, NavVisionIcon } from '@/shell/sidebar/NavIcons';
import { useAuthContext } from '@/providers/AuthProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useSpaceRole } from '@/Function/space/data';
import { canEditInitiative } from '@/Function/strategy/initiativeAccess';
import { deleteStrategy } from '@/hooks/strategyData';
import { PortfolioMoveRefused, setStrategyPortfolio, usePortfolios } from '@/hooks/portfolioData';
import { setStrategyVision, useVisions } from '@/hooks/visionData';

/** The Initiative a menu acts on — where it sits and who made it. */
interface InitiativeRef {
  id: string;
  name: string;
  vision_id: string | null;
  portfolio_id: string | null;
  created_by: string | null;
  activity_space_id?: string | null;
}

/**
 * An Initiative's actions, wherever it is shown: move it under a Vision or
 * into a Portfolio, and delete it. Only its creator may change it (the
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

// Where an Initiative can go: directly under any of the Space's Visions, into
// any of their Portfolios, or out of every Vision. The current place is
// checked.
function InitiativeMovePicker({ initiative, onClose }: { initiative: InitiativeRef; onClose: () => void }) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: visions } = useVisions(spaceId);
  const { data: portfolios } = usePortfolios(spaceId);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => visions.map((v) => ({
    vision: v,
    portfolios: portfolios.filter((p) => p.vision_id === v.id && (!q || p.name.toLowerCase().includes(q))),
  })).filter((g) => !q || g.vision.name.toLowerCase().includes(q) || g.portfolios.length > 0), [visions, portfolios, q]);

  const go = async (write: () => Promise<void>) => {
    onClose();
    try { await write(); }
    catch (e) {
      await appDialog.alert(e instanceof PortfolioMoveRefused ? t("Only the Initiative's owner can move it.") : e instanceof Error ? e.message : t("Couldn't save"));
    }
  };
  const here = (visionId: string | null, portfolioId: string | null) =>
    initiative.vision_id === visionId && initiative.portfolio_id === portfolioId;

  return (
    <Popover open onOpenChange={(v) => { if (!v) onClose(); }}>
      <PopoverAnchor className="h-0" />
      <MenuShell width="wide" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t('Move to…')} autoFocus />
          <CommandList>
            <CommandEmpty>{t('No matches.')}</CommandEmpty>
            {groups.map(({ vision, portfolios: inside }) => (
              <div key={vision.id}>
                <CommandItem value={`vision ${vision.id}`} onSelect={() => void go(() => setStrategyVision(initiative.id, vision.id))}>
                  <NavVisionIcon size={12} /><span className="flex-1 truncate">{vision.name}</span>
                  {here(vision.id, null) && <Check size={12} />}
                </CommandItem>
                {inside.map((p) => (
                  <CommandItem key={p.id} value={`portfolio ${p.id}`} onSelect={() => void go(() => setStrategyPortfolio(initiative.id, p))}>
                    <span className="w-2.5" /><NavPortfolioIcon size={12} /><span className="flex-1 truncate">{p.name}</span>
                    {here(p.vision_id, p.id) && <Check size={12} />}
                  </CommandItem>
                ))}
              </div>
            ))}
            {initiative.vision_id && !q && (
              <CommandItem value="__none" onSelect={() => void go(() => setStrategyVision(initiative.id, null))}>
                <span className="flex-1 text-muted-foreground">{t('Not in a Vision')}</span>
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </MenuShell>
    </Popover>
  );
}
