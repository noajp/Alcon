'use client';

import { useState } from 'react';
import { MoreHorizontal, Plus } from '@/ui/icons';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { ItemIconButton } from '@/Function/shared/itemIcon/IconPicker';
import { typeFallbackIcon, type TypeKind } from '@/Function/shared/elementTypeIcon';
import {
  addDomainElementType, addDomainObjectType, removeDomainElementType, removeDomainObjectType,
  setDomainTypeIcon, useDomains,
} from '@/hooks/domainData';
import type { Domain } from '@/types/database';
import { SettingsIsland } from './SettingsControls';

// Settings › Elements › Types and Settings › Objects › Types: the types a
// Domain adds, each with its icon. One section per Domain of the current
// Space — the unit the names (element_types / object_types) and their icons
// live in. The plain Element and Object are always there and are not types,
// so they are not listed. Deleting a type removes it from the list; rows
// that already carry it keep their value.

export function TypeSettings({ kind }: { kind: TypeKind }) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: domains, loading } = useDomains();
  const mine = (domains ?? []).filter((d) => !spaceId || d.activity_space_id === spaceId);

  return (
    <div className="space-y-6">
      <p className="-mt-2 text-[12px] text-muted-foreground">
        {kind === 'object'
          ? t('A type is a name and an icon an Object can wear. An Object works the same without one. Each Domain keeps its own list.')
          : t('A type is a name and an icon an Element can wear. An Element works the same without one. Each Domain keeps its own list.')}
      </p>
      {loading && mine.length === 0
        ? <div className="text-[13px] text-muted-foreground">{t('Loading…')}</div>
        : mine.map((domain) => <DomainTypes key={domain.id} domain={domain} kind={kind} />)}
    </div>
  );
}

function DomainTypes({ domain, kind }: { domain: Domain; kind: TypeKind }) {
  const { t } = useI18n();
  const types = (kind === 'object' ? domain.object_types : domain.element_types) ?? [];
  const icons = (kind === 'object' ? domain.object_type_icons : domain.element_type_icons) ?? {};
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const create = () => {
    const name = draft.trim();
    setCreating(false); setDraft('');
    if (name) void run(() => (kind === 'object' ? addDomainObjectType(domain.id, name) : addDomainElementType(domain.id, name)));
  };
  const ROW = 'flex h-12 items-center gap-3 border-b border-border/50 last:border-b-0';

  return (
    <SettingsIsland title={domain.name}>
      <div className="px-5 py-1">
        {types.map((name) => (
          <div key={name} className={ROW}>
            <span className="flex size-8 items-center justify-center rounded-md bg-muted/50">
              <ItemIconButton size={15} label={t('Change icon')}
                value={{ icon: icons[name] ?? null, color: null }}
                onChange={(next) => void run(() => setDomainTypeIcon(domain.id, kind, name, next.icon))}
                defaultIcon={typeFallbackIcon(kind, 15)} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">{name}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={name}><MoreHorizontal size={14} /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[160px]">
                <DropdownMenuItem className="text-[13px] text-[var(--status-danger)]"
                  onSelect={() => void run(async () => {
                    await (kind === 'object' ? removeDomainObjectType(domain.id, name) : removeDomainElementType(domain.id, name));
                    if (icons[name]) await setDomainTypeIcon(domain.id, kind, name, null);
                  })}>
                  {t('Delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        {creating ? (
          <div className="flex h-12 items-center">
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              placeholder={t('New type…')} aria-label={t('New type…')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); create(); }
                else if (e.key === 'Escape') { setCreating(false); setDraft(''); }
              }}
              onBlur={create}
              className="h-8 w-full rounded-md bg-muted/50 px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/60" />
          </div>
        ) : (
          <div className="flex h-11 items-center">
            <ButtonAppearanceProvider appearance="inline">
              <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} />
                {t('Create type')}
              </Button>
            </ButtonAppearanceProvider>
          </div>
        )}
        {error && <p role="alert" className="pb-2 text-[12px] text-[var(--status-danger)]">{error}</p>}
      </div>
    </SettingsIsland>
  );
}
