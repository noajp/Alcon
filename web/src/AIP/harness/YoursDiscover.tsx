'use client';

import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';

export type CustomizeMode = 'yours' | 'discover';

/** Installed (what this Space has) / Catalog (what can be added), as on every Settings › AI tab. */
export function YoursDiscover({ mode, onChange }: { mode: CustomizeMode; onChange: (m: CustomizeMode) => void }) {
  const { t } = useI18n();
  return (
    <div className="inline-flex gap-1" role="group" aria-label={t('Show')}>
      {(['yours', 'discover'] as const).map((m) => (
        <Button key={m} shape="tab" size="xs" variant={mode === m ? 'secondary' : 'ghost'} aria-pressed={mode === m} onClick={() => onChange(m)}>
          {m === 'yours' ? t('Installed') : t('Catalog')}
        </Button>
      ))}
    </div>
  );
}
