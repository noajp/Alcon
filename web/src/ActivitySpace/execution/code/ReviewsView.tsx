'use client';

import { useMemo, useState } from 'react';
import { Bot, CheckCircle2, Github, Inbox, ListOrdered, RefreshCw } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useAuthContext } from '@/providers/AuthProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { FONT } from '@/shared/designTokens';
import { buildIntegrationRow, presetById, readLastTest } from '@/Function/integrations/catalog';
import { useIntegrationActions, useIntegrationOAuthStatus, useIntegrations, useIsSpaceOwner } from '@/Function/integrations/data';
import { OAUTH_RETURN_VIEW_KEY, setOAuthOutcome, useOAuthOutcome } from '@/Function/integrations/oauthReturn';
import type { Integration } from '@/types/database';
import { setActiveSettingsSection } from '@/Function/settings/settingsNav';
import type { InboxBucket } from '@/Function/codeReview/diffModel';
import { useReviewInbox } from '@/hooks/codeChangeData';
import { CodeChangeRow } from './CodeChangesSection';
import { CodeReviewScreen } from './CodeReviewDialog';
import type { NavigationState } from '@/types/navigation';
import { CodeChangeIcon } from './codeChangeLabels';

// Reviews — code review inside the work it serves. The Space's pull requests,
// each linked to the Element it carries out, sorted for the person looking:
// the ones waiting on their review, their own, the rest that are open, and
// the finished. The sidebar lists them; the one picked there opens here as the
// review screen (guided sections, the diff, the intent beside it). With none
// picked this is the overview: until GitHub is connected it says what
// connecting gives, and an owner connects it here — signing in with GitHub,
// which comes back to this page.

const HIDE_INTRO_KEY = 'alcon.reviews.hideIntro';

const TABS: { id: InboxBucket; label: string; empty: string }[] = [
  { id: 'review', label: 'Needs your review', empty: 'Nothing is waiting on your review.' },
  { id: 'mine', label: 'Yours', empty: 'No open pull requests on your Elements.' },
  { id: 'open', label: 'Other open', empty: 'No other open pull requests.' },
  { id: 'done', label: 'Merged and closed', empty: 'Nothing merged or closed yet.' },
];

export function ReviewsView({ navigation, onNavigate, onOpenSettings }: {
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const { user } = useAuthContext();
  const spaceId = useActiveSpaceId();
  const integrations = useIntegrations(spaceId);
  const github = integrations.data.find((r) => r.preset === 'github' && r.enabled) ?? null;
  const connected = !!github?.secret_id;
  const outcome = useOAuthOutcome();
  const inbox = useReviewInbox(spaceId, user?.id ?? null);
  const [tab, setTab] = useState<InboxBucket>('review');
  const openId = navigation.codeChangeId ?? null;
  const [hideIntro, setHideIntro] = useState(() => {
    try { return localStorage.getItem(HIDE_INTRO_KEY) === '1'; } catch { return false; }
  });

  const counts = useMemo(() => {
    const out: Record<InboxBucket, number> = { review: 0, mine: 0, open: 0, done: 0 };
    for (const e of inbox.data) out[e.bucket] += 1;
    return out;
  }, [inbox.data]);
  const rows = inbox.data.filter((e) => e.bucket === tab);
  const open = inbox.data.find((e) => e.change.id === openId)?.change ?? null;
  const showIntro = !integrations.loading && !connected && !hideIntro;

  if (openId) {
    if (open) return <CodeReviewScreen key={open.id} change={open} />;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-card text-[13px] text-muted-foreground">
        {inbox.loading ? t('Loading…') : (
          <>
            {t('This pull request is not in this Space.')}
            <Button variant="ghost" size="sm" onClick={() => onNavigate({ codeChangeId: null })}>{t('Overview')}</Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-card">
      <div className="mx-auto w-full max-w-5xl space-y-8 px-8 py-8">
        <header className="flex items-center gap-3">
          <CodeChangeIcon size={18} className="text-muted-foreground" />
          <h1 className="text-2xl font-semibold leading-tight tracking-[-0.012em] text-foreground">{t('Reviews')}</h1>
          <div className="flex-1" />
          {connected ? (
            <GithubStatus lastTest={github!.last_test} onManage={onOpenSettings} />
          ) : !showIntro && !integrations.loading ? (
            <Button variant="ghost" size="sm" onClick={() => { setHideIntro(false); try { localStorage.removeItem(HIDE_INTRO_KEY); } catch { /* per-viewer */ } }}>
              <Github size={14} />{t('Connect GitHub')}
            </Button>
          ) : null}
        </header>

        {outcome && (
          <div role="status" className={`flex items-start justify-between gap-3 rounded-md px-3 py-2 text-[12px] text-foreground ${
            outcome.status === 'ok' ? 'bg-[var(--status-success-subtle)]' : outcome.status === 'error' ? 'bg-[var(--status-danger-subtle)]' : 'bg-[var(--surface-strong)]'}`}>
            <span>
              {outcome.status === 'pending' ? t('Finishing sign-in…')
                : outcome.status === 'ok' ? t('{name} is connected.', { name: 'GitHub' })
                  : outcome.message ? t(outcome.message) : t('Sign-in did not finish, so nothing was connected. Try again.')}
            </span>
            {outcome.status !== 'pending' && <Button variant="ghost" size="xs" onClick={() => setOAuthOutcome(null)}>{t('Dismiss')}</Button>}
          </div>
        )}

        {showIntro && (
          <Intro
            spaceId={spaceId}
            existing={github}
            onDismiss={() => { setHideIntro(true); try { localStorage.setItem(HIDE_INTRO_KEY, '1'); } catch { /* per-viewer */ } }}
          />
        )}

        <section>
          <div className="flex items-center gap-1 border-b border-[var(--border-default)]" role="tablist">
            {TABS.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}
                className={`-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-2 text-[13px] ${tab === x.id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                {t(x.label)}
                {counts[x.id] > 0 && <span className="rounded-full bg-[var(--surface-strong)] px-1.5 text-[11px] tabular-nums">{counts[x.id]}</span>}
              </button>
            ))}
            <div className="flex-1" />
            <Button variant="ghost" size="icon-xs" onClick={() => void inbox.refetch()} aria-label={t('Refresh')} title={t('Refresh')}>
              <RefreshCw size={12} />
            </Button>
          </div>
          <div className="pt-2">
            {inbox.loading && <p className="px-2 py-3 text-[12px] text-muted-foreground">{t('Loading…')}</p>}
            {inbox.error && <p className="px-2 py-3 text-[12px] text-[var(--status-danger)]">{inbox.error.message}</p>}
            {!inbox.loading && !inbox.error && rows.length === 0 && (
              <p className="px-2 py-3 text-[12px] text-muted-foreground">
                {inbox.data.length === 0 ? t('No pull requests yet. An agent working on an Element opens one, or link one from the Element’s Code changes.') : t(TABS.find((x) => x.id === tab)!.empty)}
              </p>
            )}
            {rows.map(({ change, element }) => (
              <CodeChangeRow key={change.id} change={change} onOpen={() => onNavigate({ codeChangeId: change.id })}
                context={element && (
                  <span className="max-w-48 shrink-0 truncate text-[12px] text-muted-foreground" title={element.title}>
                    {element.display_id ? <span className="font-mono">{element.display_id}</span> : element.title}
                  </span>
                )} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function GithubStatus({ lastTest, onManage }: { lastTest: unknown; onManage: () => void }) {
  const { t } = useI18n();
  const test = readLastTest(lastTest);
  return (
    <button type="button" onClick={() => { setActiveSettingsSection('integrations'); onManage(); }}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-strong)]"
      title={t('Manage in Settings › Integrations')}>
      <Github size={14} />
      {test && !test.ok ? <span className="text-[var(--status-warning)]">{t('GitHub needs attention')}</span> : <><CheckCircle2 size={12} className="text-[var(--status-success)]" />{t('GitHub connected')}</>}
    </button>
  );
}

const FEATURES = [
  { icon: ListOrdered, title: 'Guided reviews', body: 'Review a large pull request one meaningful section at a time. The guide says what each part changes, and why.' },
  { icon: Inbox, title: 'Review inbox', body: 'The pull requests on your Elements, and the ones waiting on your review, in one list.' },
  { icon: Github, title: 'GitHub sync', body: 'Verdicts, line comments and merges made here go to the pull request on GitHub; comments written on GitHub show here.' },
  { icon: Bot, title: 'Iterate', body: 'Ask the Element’s agent to address the open comments; it pushes to the same branch and the diff follows.' },
] as const;

/** What connecting GitHub gives, and — for an owner — the connection itself. */
function Intro({ spaceId, existing, onDismiss }: { spaceId: string | null; existing: Integration | null; onDismiss: () => void }) {
  const { t } = useI18n();
  const isOwner = useIsSpaceOwner(spaceId);
  return (
    <section className="rounded-lg border border-[var(--border-default)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-4 py-2">
        <CodeChangeIcon size={14} className="text-muted-foreground" />
        <span className="text-[13px] font-medium text-foreground">{t('Code review')}</span>
        <span className="rounded-md border border-[var(--border-default)] px-1.5 text-[11px] text-muted-foreground">{t('Get started')}</span>
        <div className="flex-1" />
        <button type="button" onClick={onDismiss} className="text-[12px] text-muted-foreground hover:text-foreground">{t('I don’t do code review')}</button>
      </div>
      <div className="space-y-8 p-8">
        <div className="max-w-xl space-y-4">
          <h2 className="text-xl font-semibold text-foreground">{t('Review code against the intent')}</h2>
          <p className="text-[14px] leading-relaxed text-[var(--text-secondary)]">
            {t('See pull requests beside the Elements they carry out and the Initiatives they serve. Check whether the software does what was intended, discuss it line by line, and merge — without switching to GitHub.')}
          </p>
          {isOwner && spaceId ? (
            <ConnectGithub spaceId={spaceId} existing={existing} />
          ) : isOwner === false ? (
            <p className="text-[12px] text-muted-foreground">{t('An owner of this Space connects GitHub. Public repositories can be reviewed without it.')}</p>
          ) : null}
        </div>
        <div className="grid gap-x-12 gap-y-6 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="space-y-1.5">
              <f.icon size={16} className="text-muted-foreground" />
              <div className={`${FONT.label} text-foreground`}>{t(f.title)}</div>
              <p className="text-[13px] text-[var(--text-secondary)]">{t(f.body)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Signs in with GitHub: creates the Space's GitHub integration (or reuses
 *  one that is not signed in yet) and leaves for GitHub's authorization
 *  screen. integration-oauth brings the browser back here, and only then is
 *  the token stored — in Vault, never read back. */
function ConnectGithub({ spaceId, existing }: { spaceId: string; existing: Integration | null }) {
  const { t } = useI18n();
  const actions = useIntegrationActions(spaceId);
  const ready = useIntegrationOAuthStatus(true, 'github');
  const [error, setError] = useState<string | null>(null);
  const busy = actions.create.isPending || actions.signIn.isPending;

  const connect = async () => {
    setError(null);
    try {
      let id = existing?.id ?? null;
      if (!id) {
        const preset = presetById('github');
        if (!preset) return;
        const built = buildIntegrationRow(preset, spaceId, { delegation: 'approve_each', enabled: true });
        if (!built.ok) { setError(t(built.error)); return; }
        id = (await actions.create.mutateAsync({ row: built.row, secret: '' })).id;
      }
      const url = await actions.signIn.mutateAsync(id);
      try { sessionStorage.setItem(OAUTH_RETURN_VIEW_KEY, 'reviews'); } catch { /* lands in Settings › Integrations instead */ }
      window.location.assign(url);
    } catch (e) {
      setError(t(e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="space-y-2">
      <Button variant="primary" onClick={() => void connect()} disabled={busy || ready !== true}>
        <Github size={14} />{busy ? t('Opening GitHub…') : t('Connect GitHub')}
      </Button>
      {ready === false && (
        <p className="text-[12px] text-[var(--status-warning)]">{t('GitHub sign-in is not set up yet. An administrator needs to register the GitHub OAuth App before this can be connected.')}</p>
      )}
      {ready && <p className="text-[12px] text-muted-foreground">{t('Connect opens GitHub sign-in. Alcon asks to read and write the repositories you can reach, to review and merge pull requests and to let agents push branches.')}</p>}
      {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}
    </div>
  );
}
