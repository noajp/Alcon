'use client';

import { useMemo, type ReactNode } from 'react';
import { useDomains } from '@/hooks/domainData';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { ElementIcon, ObjectIcon } from '@/Function/shared/conceptIcons';

// The icon an Element or Object type wears. Each Domain remembers one per
// type name (domains.element_type_icons / object_type_icons); a name with
// none — and "no type" — shows the concept's own mark. Names are matched
// without case, as the type lists are.

export type TypeKind = 'element' | 'object';

/** Type name (lowercased) → icon, over the Domains the viewer can see. A
 *  name two Domains both use shows the first Domain's icon. */
export function useTypeIcons(kind: TypeKind): ReadonlyMap<string, string> {
  const { data: domains } = useDomains();
  return useMemo(() => {
    const out = new Map<string, string>();
    for (const d of domains ?? []) {
      const icons = (kind === 'object' ? d.object_type_icons : d.element_type_icons) ?? {};
      for (const [name, icon] of Object.entries(icons)) {
        const key = name.toLowerCase();
        if (typeof icon === 'string' && icon && !out.has(key)) out.set(key, icon);
      }
    }
    return out;
  }, [domains, kind]);
}

/** The concept's own mark, for a type with no icon. */
export function typeFallbackIcon(kind: TypeKind, size: number): ReactNode {
  return kind === 'object' ? <ObjectIcon size={size} /> : <ElementIcon size={size} />;
}

/** The mark for one type name; null or unknown shows the concept's mark. */
export function TypeMark({ type, icons, kind = 'element', size = 14 }: {
  type: string | null | undefined;
  icons: ReadonlyMap<string, string>;
  kind?: TypeKind;
  size?: number;
}) {
  const icon = type ? icons.get(type.toLowerCase()) ?? null : null;
  return (
    <span className="flex shrink-0 text-muted-foreground">
      <ItemIcon icon={icon} color={null} size={size} fallback={typeFallbackIcon(kind, size)} />
    </span>
  );
}
