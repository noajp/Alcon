'use client';

import { CARD_FLAT, CARD_HOVER } from '@/shared/designTokens';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import {
  OAUTH_PROVIDER_NAMES, connectionMethodOf, oauthProviderOf,
  type CatalogCardState, type IntegrationPreset,
} from './catalog';
import { IntegrationIcon } from './IntegrationDetailDialog';

/** A catalog card whose bottom line is the next action — how this
 *  connection is made — not provider metadata (Source and builder live
 *  in the detail dialog, the drill-down). A sign-in preset whose
 *  provider is not configured on the server reads as setup-needed,
 *  never as a broken connect; it still opens the dialog, which carries
 *  the full administrator copy. */
export function PresetCard({ preset, state, onOpen }: {
  preset: IntegrationPreset; state: CatalogCardState; onOpen: () => void;
}) {
  const { t } = useI18n();
  const method = connectionMethodOf(preset);
  const provider = oauthProviderOf(preset);
  const action = state === 'setup-needed'
    ? t('Needs setup')
    : method === 'sign-in'
      ? t('Sign in with {provider}', { provider: OAUTH_PROVIDER_NAMES[provider!] })
      : method === 'token'
        ? t('Paste a token')
        : t('Set up');
  return (
    <button type="button" onClick={onOpen}
      className={cn(CARD_FLAT, CARD_HOVER, 'flex min-h-[156px] flex-col gap-3 p-4 text-left outline-none focus-visible:bg-[var(--surface-strong)]')}>
      <div className="flex items-start justify-between gap-2">
        <IntegrationIcon name={preset.name} icon={preset.icon} size={32} />
        {state === 'setup-needed' && (
          <span className="inline-flex h-5 items-center rounded-full bg-[var(--status-warning-subtle)] px-2 text-[11px] font-medium text-[var(--status-warning)]">
            {t('Needs setup')}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground">{t(preset.name)}</div>
        <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{t(preset.description)}</p>
      </div>
      <div className="mt-auto">
        <div className="text-[12px] font-medium text-foreground">{action}</div>
        {state === 'setup-needed' && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t('Sign-in is not set up on this server yet.')}</p>
        )}
      </div>
    </button>
  );
}
