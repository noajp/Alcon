'use client';

import { useI18n } from '@/Function/i18n/I18nProvider';
import { readableBody } from './inboxRow';
import { WakeSteps } from '@/Function/settings/HeartbeatSettings';

/** A heartbeat digest in the reader: what the wake said, with the
 *  wake's own record under it. Judgement happens on each item's own
 *  screen — the wake only speaks, so this card decides nothing and
 *  offers no approval of its own. */
export function HeartbeatInboxCard({ runId, title, body }: {
  runId: string | null;
  title: string;
  body: string | null;
}) {
  const { t } = useI18n();
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {body && <p className="mt-6 whitespace-pre-wrap text-[15px] leading-7 text-foreground/90">{readableBody(body, t)}</p>}
      <p className="mt-6 text-[13px] text-muted-foreground">
        {t('This digest came from a heartbeat wake. Each item is decided on its own screen; the wake only speaks.')}
      </p>
      {runId && (
        <div className="mt-8">
          <h2 className="text-[13px] font-medium text-foreground">{t('The wake’s record')}</h2>
          <div className="mt-2">
            <WakeSteps runId={runId} />
          </div>
        </div>
      )}
    </div>
  );
}
