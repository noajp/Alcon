'use client';

import type React from 'react';
import { useId } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { FONT } from '@/shared/designTokens';
import { SlaSettings } from './SlaSettings';
import { TimelineSettings } from './TimelineSettings';

// Settings › Strategy: everything set for Strategies, on one page — how
// their risk is judged in each Domain, then how their Timeline is drawn.
// Each part is headed by its name and its islands rank one below it, so the
// page reads Strategy › part › island. Parts stand further apart than the
// islands inside one.

export function StrategySettings() {
  const { t } = useI18n();
  return (
    <div className="space-y-12">
      <StrategyPart title={t('Risk thresholds')}>
        <SlaSettings level={3} />
      </StrategyPart>
      <StrategyPart title={t('Timeline')} description={t('How the Timeline is drawn')}>
        <TimelineSettings level={3} />
      </StrategyPart>
    </div>
  );
}

/** One named part of the page. A part that opens with its own explanation
 *  (the thresholds) passes no description; the explanation follows the
 *  heading at the same distance either way. */
function StrategyPart({
  title, description, children,
}: { title: string; description?: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={`${FONT.xl} text-foreground`}>{title}</h2>
      {description && <p className="mt-2 text-[12px] text-muted-foreground">{description}</p>}
      <div className={description ? 'mt-6' : 'mt-4'}>{children}</div>
    </section>
  );
}
