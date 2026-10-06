'use client';

import { useMemo } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SPACE_SCOPE, useToolScope, type ToolScope } from '@/Function/shared/tool/toolScope';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import type { ScmData } from '@/hooks/useScm';
import { supplyDomainIds } from './scmScope';

/** Whose supply SCM shows (see toolScope), with the choices worth offering:
 *  everything, the Space's shared records, and each Domain holding supply. */
export function useScmScope(everything: ScmData | null) {
  const { t } = useI18n();
  const { data: spaceDomains } = useSustainmentDomains();
  const domainIds = useMemo(() => everything ? supplyDomainIds(everything, null) : [], [everything]);
  const [scope, setScope] = useToolScope('scm', domainIds);
  const name = (id: ToolScope) => id === null ? t('Everything') : id === SPACE_SCOPE ? t('Shared by the Space') : spaceDomains.find(domain => domain.id === id)?.name ?? t('Unknown Domain');
  const options = domainIds.length ? [null, SPACE_SCOPE, ...[...domainIds].sort((a, b) => name(a).localeCompare(name(b)))].map(id => ({ id, name: name(id) })) : [];
  return { scope, setScope, scopeName: name(scope), options };
}
