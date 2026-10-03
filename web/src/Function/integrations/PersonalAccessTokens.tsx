'use client';

import { useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { ChoiceCard } from '@/ui/choice-card';
import { appDialog } from '@/Function/shared/appDialogStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { PersonalAccessToken, PersonalAccessTokenAccess } from '@/types/database';
import { CopyField } from './CopyField';
import { claudeMcpAddCommand, usePersonalAccessTokenActions, usePersonalAccessTokens, type TokenExpiryDays } from './patData';

// The signed-in person's personal access tokens (ADR 0031): list them with
// what they can do, when they expire and when they were last used; revoke
// one (it stops working at once); generate one. A new token is shown once —
// the database keeps only its hash.

const ACCESS_LABELS: Record<PersonalAccessTokenAccess, string> = {
  read_write: 'Read & write',
  read: 'Read only',
};

const EXPIRY_OPTIONS: { days: TokenExpiryDays; label: string }[] = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: null, label: 'No expiry' },
];

function errorCode(e: unknown): string | null {
  return e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string' ? (e as { code: string }).code : null;
}

export function PersonalAccessTokens() {
  const { t, locale } = useI18n();
  const { data: tokens, loading, error } = usePersonalAccessTokens();
  const { revoke } = usePersonalAccessTokenActions();
  const [generating, setGenerating] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  // The moment the list was opened; expiry is a day-level hint, not a live clock.
  const [openedAt] = useState(() => Date.now());

  const date = (iso: string) => new Date(iso).toLocaleDateString(locale);

  const confirmRevoke = async (token: PersonalAccessToken) => {
    if (!await appDialog.confirm(t('Revoke {name}? Clients using it stop working at once. This can’t be undone.', { name: token.name }))) return;
    setRevokeError(null);
    revoke.mutate(token.id, { onError: () => setRevokeError(t('The token could not be revoked. Try again.')) });
  };

  const describe = (token: PersonalAccessToken): string => {
    const expired = !!token.expires_at && new Date(token.expires_at).getTime() <= openedAt;
    const expiry = !token.expires_at
      ? t('No expiry')
      : expired ? t('Expired on {date}', { date: date(token.expires_at) }) : t('Expires {date}', { date: date(token.expires_at) });
    const used = !token.last_used_at
      ? t('Never used')
      : token.last_used_client
        ? t('Last used {date} by {client}', { date: date(token.last_used_at), client: token.last_used_client })
        : t('Last used {date}', { date: date(token.last_used_at) });
    return [t(ACCESS_LABELS[token.access]), expiry, used].join(' · ');
  };

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-foreground">{t('Personal access tokens')}</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {t('A token lets an MCP client or script act as you. It sees and changes only what you can. Revoke it to cut it off at once.')}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setGenerating(true)}>
          <Plus size={14} aria-hidden="true" />
          <span>{t('Generate token')}</span>
        </Button>
      </div>

      {error ? (
        <p className="text-[12px] text-[var(--status-danger)]">{t("Couldn't load tokens")}: {error.message}</p>
      ) : loading ? (
        <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>
      ) : tokens.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{t('No tokens yet.')}</p>
      ) : (
        <div className="divide-y divide-border/40 rounded-lg border border-border/60">
          {tokens.map((token) => (
            <div key={token.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-foreground">{token.name}</span>
                  <code className="shrink-0 font-mono text-[11px] text-muted-foreground">{token.token_prefix}…</code>
                </div>
                <div className="truncate text-[12px] text-muted-foreground">{describe(token)}</div>
              </div>
              <Button variant="danger" size="xs" onClick={() => confirmRevoke(token)} disabled={revoke.isPending}>{t('Revoke')}</Button>
            </div>
          ))}
        </div>
      )}
      {revokeError && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{revokeError}</p>}

      {generating && <GenerateTokenDialog onClose={() => setGenerating(false)} />}
    </section>
  );
}

function GenerateTokenDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { issue } = usePersonalAccessTokenActions();
  const [name, setName] = useState('');
  const [expiresDays, setExpiresDays] = useState<TokenExpiryDays>(90);
  const [access, setAccess] = useState<PersonalAccessTokenAccess>('read_write');
  const [error, setError] = useState<string | null>(null);
  // The plaintext lives here only, and goes when the dialog closes.
  const [issued, setIssued] = useState<string | null>(null);

  // Drop the issued token from the MutationCache too, not only from this state.
  const close = () => {
    issue.reset();
    onClose();
  };

  const generate = async () => {
    if (issue.isPending) return;
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) { setError(t('Enter a name.')); return; }
    try {
      const result = await issue.mutateAsync({ name: trimmed, expiresDays, access });
      setIssued(result.token);
    } catch (e) {
      setError(errorCode(e) === '54000'
        ? t('You have 20 active tokens. Revoke one first.')
        : t('The token could not be generated. Try again.'));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-h-[calc(100dvh-48px)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{issued ? t('Token generated') : t('Generate token')}</DialogTitle>
          <DialogDescription className="text-[12px]">
            {issued
              ? t('Copy the token now. It is not shown again; if you lose it, revoke it and generate a new one.')
              : t('The token acts as you, within your permissions, until it expires or you revoke it.')}
          </DialogDescription>
          <p className="text-[12px] text-muted-foreground">
            {t('Revoke tokens you no longer use; changing your password does not revoke them.')}
          </p>
        </DialogHeader>

        {issued ? (
          <div className="space-y-4">
            <Field label={t('Token')}>
              <CopyField value={issued} label={t('Token')} />
            </Field>
            <Field label={t('Connect Claude Code')}>
              <CopyField value={claudeMcpAddCommand(issued)} multiline />
            </Field>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label={t('Name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus
                placeholder={t('e.g. laptop')} aria-label={t('Name')} className="h-8 text-[13px] md:text-[13px]"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void generate(); }} />
            </Field>
            <Field label={t('Expiry')}>
              <div className="flex flex-wrap gap-1" role="group" aria-label={t('Expiry')}>
                {EXPIRY_OPTIONS.map((o) => (
                  <Button key={String(o.days)} shape="tab" size="sm" variant={expiresDays === o.days ? 'secondary' : 'ghost'}
                    aria-pressed={expiresDays === o.days} onClick={() => setExpiresDays(o.days)}>
                    {t(o.label)}
                  </Button>
                ))}
              </div>
              {expiresDays === null && (
                <p className="mt-2 text-[12px] text-[var(--status-warning)]">{t('A token without expiry works until you revoke it.')}</p>
              )}
            </Field>
            <Field label={t('Access')}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ChoiceCard selected={access === 'read_write'} label={t('Read & write')} onClick={() => setAccess('read_write')}>
                  <span className="text-[12px] text-muted-foreground">{t('Read the board, and create and update Elements, comments, assignees and labels.')}</span>
                </ChoiceCard>
                <ChoiceCard selected={access === 'read'} label={t('Read only')} onClick={() => setAccess('read')}>
                  <span className="text-[12px] text-muted-foreground">{t('Read the board. Every write is refused.')}</span>
                </ChoiceCard>
              </div>
            </Field>
          </div>
        )}

        {error && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>}

        <DialogFooter>
          {issued ? (
            <Button variant="primary" size="sm" onClick={close}>{t('Done')}</Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={close}>{t('Cancel')}</Button>
              <Button variant="primary" size="sm" onClick={generate} disabled={issue.isPending}>
                {issue.isPending ? t('Generating…') : t('Generate')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
