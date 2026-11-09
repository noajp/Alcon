'use client';

import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Integration } from '@/types/database';
import {
  INTEGRATION_STATUS_LABELS, KIND_LABELS, integrationStatus, presetById, readLastTest, testOutcomeLabel,
} from './catalog';
import { IntegrationIcon } from './IntegrationDetailDialog';

/** One of the Space's connections as a row: icon, name, kind · tool
 *  count, and its one status word. Opens the connection's detail
 *  dialog, where it is managed. */
export function ConnectedRow({ integration, onOpen }: { integration: Integration; onOpen: () => void }) {
  const { t } = useI18n();
  const last = readLastTest(integration.last_test);
  return (
    <button type="button" onClick={onOpen}
      className="-mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-[var(--surface-strong)] focus-visible:bg-[var(--surface-strong)]">
      <IntegrationIcon name={integration.name} icon={integration.icon ?? presetById(integration.preset)?.icon ?? null} size={24} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">{integration.name}</span>
        </div>
        <div className="truncate text-[12px] text-muted-foreground">
          {[
            t(KIND_LABELS[integration.kind]),
            last?.toolCount != null ? t('{count} tools', { count: last.toolCount }) : null,
          ].filter(Boolean).join(' · ')}
        </div>
      </div>
      <StatusChip integration={integration} />
    </button>
  );
}

/** The row's one status word (off / not tested / connected / reachable /
 *  action needed); the dialog carries the test's detail. */
function StatusChip({ integration }: { integration: Integration }) {
  const { t } = useI18n();
  const status = integrationStatus(integration);
  const last = readLastTest(integration.last_test);
  return (
    <span
      title={last ? t(testOutcomeLabel(last.code)) : undefined}
      className={cn('inline-flex shrink-0 items-center text-[11px]',
        status === 'connected' ? 'text-[var(--status-success)]' : status === 'action-needed' ? 'text-[var(--status-danger)]' : 'text-muted-foreground')}
    >
      {t(INTEGRATION_STATUS_LABELS[status])}
    </span>
  );
}
