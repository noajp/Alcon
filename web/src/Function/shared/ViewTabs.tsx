'use client';

import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';

// A page's views as a quiet strip of tabs under its header — the same strip
// as a Domain's or an Object's (TabBar), for pages whose tabs are fixed: no
// reordering, adding or closing.

export function ViewTabs<T extends string>({ tabs, active, onSelect, label, actions }: {
  tabs: readonly { id: T; label: string }[];
  active: T;
  onSelect: (id: T) => void;
  /** What the tabs choose between, for assistive tech. */
  label: string;
  /** Page chrome that belongs on the tabs' own line, at its right end. */
  actions?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div role="tablist" aria-label={label} className="flex shrink-0 items-center gap-1.5 bg-transparent py-2 pl-[19px] pr-4">
      {tabs.map((v) => (
        <Button key={v.id} type="button" shape="tab" role="tab" aria-selected={active === v.id}
          variant={active === v.id ? 'secondary' : 'ghost'} onClick={() => onSelect(v.id)}>
          {t(v.label)}
        </Button>
      ))}
      {actions && <div className="ml-auto flex items-center">{actions}</div>}
    </div>
  );
}
