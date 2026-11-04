'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from '@/ui/icons';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import { appDialog } from '@/Function/shared/appDialogStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { formatRelative } from '@/Function/shared/dateUtils';
import type { Asset, AssetEvent } from '@/types/database';
import { CopyButton } from './CopyField';
import { useIsSpaceOwner } from './data';
import { useAssetActions, useAssetEvents, useAssets } from './assetData';
import {
  ASSET_KIND_LABELS, ASSET_RELAY_URL, ASSET_STATUS_LABELS, describeManifest, describeObserved, isLive, relayEnvLines, sortAssets,
} from './assetModel';

// Settings › Customize › Connected assets (ADR 0036): the apps and AIs
// that joined this Space by adding one line. The relay address and the Space
// id are what that line needs; the list shows what announced itself, what it
// says about itself (unverified) and what the relay saw of it, and lets an
// owner accept or revoke. Each row opens to what the asset reported it did.

export function AssetRelayPanel() {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: assets, readAt, loading, error } = useAssets(spaceId);
  const ownerRole = useIsSpaceOwner(spaceId);
  const isOwner = ownerRole === true;
  const { accept, revoke } = useAssetActions(spaceId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // "Live" is judged against the moment the list was last read, which the
  // 5-second refetch keeps close enough to now.
  const now = readAt;

  const onAccept = (asset: Asset) => {
    setActionError(null);
    accept.mutate(asset.id, { onError: () => setActionError(t('The asset could not be accepted. Try again.')) });
  };
  const onRevoke = async (asset: Asset) => {
    if (!await appDialog.confirm(t('Revoke {name}? Its next call is refused and it stops reporting. What it already reported stays.', { name: asset.name }))) return;
    setActionError(null);
    revoke.mutate(asset.id, { onError: () => setActionError(t('The asset could not be revoked. Try again.')) });
  };

  const sorted = sortAssets(assets);
  const waiting = sorted.filter(a => a.status === 'unclaimed').length;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">{t('Connected assets')}</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {t('A local app or AI adds one line to its backend and announces itself here. It is recognized when an owner accepts it; from then on what it does is recorded in this Space.')}
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-foreground">{t('The one line')}</h3>
        <p className="text-[12px] text-muted-foreground">{t("Add Alcon's SDK (Node or Python) to the app and import it first, then paste these settings into the app's environment.")}</p>
        {spaceId && <CopyButton value={relayEnvLines(ASSET_RELAY_URL, spaceId)} label={t('Copy settings')} />}
        <p className="text-[12px] text-muted-foreground">
          {t('No key to issue: the app receives its own token on first contact and keeps it. What it reports about itself is unverified until you accept it.')}
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[13px] font-medium text-foreground">
              {t('Assets')}{waiting > 0 && <span className="ml-2 text-[12px] font-normal text-muted-foreground">{t('{n} waiting for acceptance', { n: waiting })}</span>}
            </h3>
            {!isOwner && <p className="mt-1 text-[12px] text-muted-foreground">{t('Only Space owners can accept or revoke assets. You can see what is connected.')}</p>}
          </div>
        </div>

        {error ? (
          <p className="text-[12px] text-[var(--status-danger)]">{t("Couldn't load assets")}: {error.message}</p>
        ) : loading ? (
          <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>
        ) : sorted.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">{t('Nothing has announced itself yet. Start an app with the line and it appears here.')}</p>
        ) : (
          <div className="divide-y divide-border/40 rounded-lg border border-border/60">
            {sorted.map(asset => (
              <AssetRow
                key={asset.id} asset={asset} now={now} open={openId === asset.id} isOwner={isOwner}
                busy={accept.isPending || revoke.isPending}
                onToggle={() => setOpenId(openId === asset.id ? null : asset.id)}
                onAccept={() => onAccept(asset)} onRevoke={() => void onRevoke(asset)}
              />
            ))}
          </div>
        )}
        {actionError && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{actionError}</p>}
      </section>
    </div>
  );
}

function StatusChip({ asset, now }: { asset: Asset; now: number }) {
  const { t } = useI18n();
  const live = isLive(asset, now);
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[var(--control-tab-radius)] border border-[var(--border-default)] px-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-[var(--status-success)]' : 'bg-[var(--border-default)]')} />
      {t(ASSET_STATUS_LABELS[asset.status])}
    </span>
  );
}

function AssetRow({ asset, now, open, isOwner, busy, onToggle, onAccept, onRevoke }: {
  asset: Asset; now: number; open: boolean; isOwner: boolean; busy: boolean;
  onToggle: () => void; onAccept: () => void; onRevoke: () => void;
}) {
  const { t } = useI18n();
  const self = describeManifest(asset.manifest);
  const seen = describeObserved(asset.observed);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Button variant="ghost" size="icon-xs" aria-expanded={open} aria-label={t(open ? 'Hide activity' : 'Show activity')} onClick={onToggle}>
          <Chevron size={12} aria-hidden="true" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">{asset.name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{t(ASSET_KIND_LABELS[asset.kind])}</span>
            <StatusChip asset={asset} now={now} />
          </div>
          <div className="truncate text-[12px] text-muted-foreground">
            {[
              asset.last_seen_at ? t('Last seen {date}', { date: formatRelative(asset.last_seen_at) }) : null,
              t('{n} event(s)', { n: asset.event_count }),
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
        {isOwner && asset.status === 'unclaimed' && (
          <Button variant="primary" size="xs" onClick={onAccept} disabled={busy}>{t('Accept')}</Button>
        )}
        {isOwner && asset.status !== 'revoked' && (
          <Button variant="danger" size="xs" onClick={onRevoke} disabled={busy}>{t('Revoke')}</Button>
        )}
      </div>
      {open && <AssetActivity asset={asset} self={self} seen={seen} />}
    </div>
  );
}

function AssetActivity({ asset, self, seen }: { asset: Asset; self: string | null; seen: string | null }) {
  const { t } = useI18n();
  const { data: events, loading, error } = useAssetEvents(asset.id);
  const when = (iso: string) => formatRelative(iso);
  return (
    <div className="border-t border-border/40 bg-[var(--surface-rail)]/40 px-3 py-2.5">
      {/* What it says about itself and where it was seen from — kept here,
          for when someone looks, rather than on the row. */}
      {(self || seen) && (
        <p className="mb-2 truncate text-[11px] text-muted-foreground">
          {[self ? `${t('Says')}: ${self}` : null, seen ? `${t('Seen')}: ${seen}` : null].filter(Boolean).join(' · ')}
        </p>
      )}
      {asset.status === 'unclaimed' && (
        <p className="mb-2 text-[12px] text-muted-foreground">{t('Not accepted yet: everything below is what the app says, unverified.')}</p>
      )}
      {error ? (
        <p className="text-[12px] text-[var(--status-danger)]">{t("Couldn't load activity")}: {error.message}</p>
      ) : loading ? (
        <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>
      ) : events.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{t('Nothing reported yet.')}</p>
      ) : (
        <ul className="space-y-1.5">
          {events.map(e => <EventLine key={e.id} event={e} when={when} />)}
        </ul>
      )}
    </div>
  );
}

function EventLine({ event, when }: { event: AssetEvent; when: (iso: string) => string }) {
  const { t, locale } = useI18n();
  const [showPayload, setShowPayload] = useState(false);
  const hasPayload = event.payload !== null && event.payload !== undefined;
  return (
    <li className="text-[12px]">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-foreground">{event.summary}</span>
        <time dateTime={event.occurred_at} title={new Date(event.occurred_at).toLocaleString(locale)} className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{when(event.occurred_at)}</time>
        {hasPayload && (
          <Button variant="ghost" size="xs" onClick={() => setShowPayload(v => !v)}>{t(showPayload ? 'Hide details' : 'Details')}</Button>
        )}
      </div>
      {showPayload && hasPayload && (
        <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-border/60 px-2 py-1.5 font-mono text-[11px] text-muted-foreground">{JSON.stringify(event.payload, null, 2)}</pre>
      )}
    </li>
  );
}
