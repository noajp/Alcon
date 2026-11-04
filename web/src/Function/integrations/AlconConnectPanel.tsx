'use client';

import { useI18n } from '@/Function/i18n/I18nProvider';
import { FONT } from '@/shared/designTokens';
import { CopyField } from './CopyField';
import { ConnectedApps } from './ConnectedApps';
import { PersonalAccessTokens } from './PersonalAccessTokens';
import { ALCON_MCP_URL, claudeMcpAddCommand } from './patData';

// Settings › Customize › Connect to Alcon: point an MCP client or a script
// at Alcon. The client acts as the signed-in person — through a personal
// access token (ADR 0032) or an OAuth sign-in from claude.ai / ChatGPT
// (ADR 0034) — and sees and changes only what that person can.

export function AlconConnectPanel() {
  const { t } = useI18n();
  return (
    <div className="space-y-8">
      <div>
        <p className="text-[12px] text-muted-foreground">
          {t("Alcon is an MCP server. Point an MCP client at it and the client can read and update this board within your permissions.")}
        </p>
      </div>

      <section className="space-y-2">
        <h3 className={`${FONT.lg} text-foreground`}>{t('Endpoint')}</h3>
        <CopyField value={ALCON_MCP_URL} />
      </section>

      <ConnectedApps />

      <PersonalAccessTokens />

      <section className="space-y-2">
        <h3 className={`${FONT.lg} text-foreground`}>Claude Code</h3>
        <p className="text-[12px] text-muted-foreground">{t('Generate a token, then run this command with it in place of <token>:')}</p>
        <CopyField value={claudeMcpAddCommand('<token>')} multiline />
        <p className="text-[12px] text-muted-foreground">
          {t('Any MCP client or script that can send an Authorization header connects the same way.')}
        </p>
      </section>
    </div>
  );
}
