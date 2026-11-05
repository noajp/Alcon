'use client';

import { useI18n } from '@/Function/i18n/I18nProvider';
import { FONT } from '@/shared/designTokens';
import { CopyButton } from './CopyField';
import { ConnectedApps } from './ConnectedApps';
import { PersonalAccessTokens } from './PersonalAccessTokens';
import { ALCON_MCP_URL } from './patData';

// Settings › API & access › Connect to Alcon: point an MCP client or a script
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

      <section className="flex flex-col gap-2">
        <h3 className={`${FONT.lg} text-foreground`}>{t('Endpoint')}</h3>
        <p className="text-[12px] text-muted-foreground">{t("Paste it into the MCP client as the server's address.")}</p>
        <CopyButton value={ALCON_MCP_URL} label={t('Copy endpoint')} />
      </section>

      <ConnectedApps />

      <PersonalAccessTokens />

      <section className="space-y-2">
        <h3 className={`${FONT.lg} text-foreground`}>Claude Code</h3>
        <p className="text-[12px] text-muted-foreground">{t('Generate a token: the command that connects Claude Code comes with it, ready to paste into a terminal.')}</p>
        <p className="text-[12px] text-muted-foreground">
          {t('Any MCP client or script that can send an Authorization header connects the same way.')}
        </p>
      </section>
    </div>
  );
}
