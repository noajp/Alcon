'use client';

import { useI18n } from '@/Function/i18n/I18nProvider';
import { FONT, SETTINGS_ISLAND } from '@/shared/designTokens';
import { CopyField } from './CopyField';
import { ConnectedApps } from './ConnectedApps';
import { PersonalAccessTokens } from './PersonalAccessTokens';
import { CLAYWARE_MCP_URL } from './patData';

// Settings › API: point an MCP client or a script at Clayware. The client acts
// as the signed-in person — through a personal access token (ADR 0032) or an
// OAuth sign-in from claude.ai / ChatGPT (ADR 0034) — and sees and changes
// only what that person can. The page reads top to bottom as the way to
// connect: the address, then the two ways to prove who is calling.

export function ClaywareConnectPanel() {
  const { t } = useI18n();
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <div>
          <h2 className={`${FONT.lg} text-foreground`}>{t('Server address')}</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {t('Clayware is an MCP server. Give an MCP client this address, then connect it with a token or by signing in.')}
          </p>
        </div>
        <div className={`${SETTINGS_ISLAND} p-2`}>
          <CopyField value={CLAYWARE_MCP_URL} label={t('Server address')} />
        </div>
      </section>

      <PersonalAccessTokens />

      <ConnectedApps />
    </div>
  );
}
