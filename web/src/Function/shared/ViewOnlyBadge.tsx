'use client';

import { Eye } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';

/** Page-header mark for a Domain viewer: they read everything here and change
 *  nothing. The database refuses their writes; this says so up front. */
export function ViewOnlyBadge() {
  const { t } = useI18n();
  return (
    <span
      className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground"
      title={t('Viewers read everything in this Domain and change nothing.')}
    >
      <Eye size={12} />
      {t('View only')}
    </span>
  );
}
