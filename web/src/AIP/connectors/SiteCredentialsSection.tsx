'use client';

import { useState } from 'react';
import { Plus } from '@/ui/icons';
import { Button } from '@/ui/button';
import { FONT } from '@/shared/designTokens';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Integration } from '@/types/database';
import { readLastTest, testOutcomeLabel } from './catalog';
import { useSiteCredentials, type SiteCredentialRow } from './siteCredentialData';
import { SITE_CREDENTIAL_STATUS_LABELS, siteCredentialStatus } from './siteCredentialModel';
import { SiteCredentialDialog } from './SiteCredentialDialog';

// Settings › Customize › Yours: the Space's site logins, beside its
// connections (secure-login PR1). A site login is the credential for a
// website that has no connection — the agent signs in with the saved
// username/password pair on that origin only. Members see which sites
// have one; saving, replacing and deleting are the owner's acts, and
// the password itself is never shown (no read path exists for it).

export function SiteCredentialsSection({ spaceId, integrations, isOwner, ownerKnown }: {
  spaceId: string;
  integrations: Integration[];
  isOwner: boolean;
  ownerKnown: boolean;
}) {
  const { t } = useI18n();
  const { data: credentials, loading, error, refetch } = useSiteCredentials(spaceId);
  const [opened, setOpened] = useState<SiteCredentialRow | 'new' | null>(null);
  const openedCred = opened && opened !== 'new'
    ? credentials.find((c) => c.id === opened.id) ?? opened
    : null;

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className={FONT.label}>{t('Site logins')}</h3>
          <p className="mt-1 max-w-xl text-[12px] text-muted-foreground">
            {t('Sign-ins for websites that have no connection. The saved username and password are used only on that site, and the password is never shown back.')}
          </p>
        </div>
        {isOwner && (
          <Button variant="ghost" size="sm" onClick={() => setOpened('new')}>
            <Plus size={14} aria-hidden="true" />
            <span>{t('Add site login')}</span>
          </Button>
        )}
      </div>

      {ownerKnown && !isOwner && (
        <p className="text-[12px] text-muted-foreground">{t('Only Space owners can save or change site logins. You can see which sites have one.')}</p>
      )}

      {error ? (
        <p className="text-[12px] text-[var(--status-danger)]">{t("Couldn't load site logins: {error}", { error: error.message })}</p>
      ) : loading ? (
        <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>
      ) : credentials.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{t('No site logins saved yet.')}</p>
      ) : (
        <div>
          {credentials.map((c) => (
            <SiteCredentialRowView key={c.id} credential={c} onOpen={() => setOpened(c)} />
          ))}
        </div>
      )}

      {opened && (
        <SiteCredentialDialog
          spaceId={spaceId}
          credential={opened === 'new' ? null : openedCred}
          integrations={integrations}
          canEdit={isOwner}
          onClose={() => setOpened(null)}
          onChanged={() => { void refetch(); }}
        />
      )}
    </section>
  );
}

function SiteCredentialRowView({ credential, onOpen }: { credential: SiteCredentialRow; onOpen: () => void }) {
  const { t, locale } = useI18n();
  const status = siteCredentialStatus(credential);
  const last = readLastTest(credential.last_test);
  const meta = [
    credential.label,
    credential.username,
    last && !last.ok ? t(testOutcomeLabel(last.code)) : null,
    credential.last_used_at
      ? t('Last used {when}', { when: new Date(credential.last_used_at).toLocaleDateString(locale) })
      : null,
  ].filter(Boolean).join(' · ');
  return (
    <button type="button" onClick={onOpen}
      className="-mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-[var(--surface-strong)] focus-visible:bg-[var(--surface-strong)]">
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[13px] font-medium text-foreground">{credential.origin}</div>
        {meta && <div className="truncate text-[12px] text-muted-foreground">{meta}</div>}
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full',
          status === 'saved' ? 'bg-[var(--status-success)]'
            : status === 'action-needed' ? 'bg-[var(--status-danger)]'
            : 'bg-[var(--text-muted)]')} />
        {t(SITE_CREDENTIAL_STATUS_LABELS[status])}
      </span>
    </button>
  );
}
