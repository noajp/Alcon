'use client';

import { useI18n } from '@/Function/i18n/I18nProvider';

/** One related concept and the Objects that connect it — a name you can open,
 *  then "Through" and the Objects as quiet links. Plain text that lights up
 *  on hover; no chips, no outlines. */
export function RelationRow({ name, onOpen, through }: {
  name: string;
  onOpen: () => void;
  through: { id: string; name: string; onOpen: () => void }[];
}) {
  const { t } = useI18n();
  return <div className="space-y-0.5">
    <button type="button" onClick={onOpen}
      className="-mx-2 max-w-full rounded-md px-2 py-1 text-left text-[13px] font-medium text-foreground outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40">{name}</button>
    {through.length > 0 && <div className="flex flex-wrap items-center gap-x-0.5 text-xs text-muted-foreground">
      <span>{t('Through')}</span>{through.map(object => <button key={object.id} type="button" onClick={object.onOpen}
        className="max-w-full rounded px-1.5 py-0.5 text-left outline-none transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:bg-muted/40 focus-visible:text-foreground">{object.name}</button>)}
    </div>}
  </div>;
}
