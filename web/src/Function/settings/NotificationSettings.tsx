'use client';

import { SettingsIsland, ToggleRow } from './SettingsControls';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useNotificationPreferences } from './useNotificationPreferences';
import { NOTIFICATION_KINDS, NOTIFICATION_KIND_META } from '@/Function/shared/notificationKinds';

const KIND_HINT: Partial<Record<string, string>> = {
  mention: 'Someone @mentions you in a comment',
  assigned: "You're assigned to an Element",
  comment: 'A new comment on an Element you own or are assigned to',
  status_change: "An Element you're involved with changes status, or an agent run you started finishes or fails",
  approval_requested: 'Your approval is requested on an Element or by an AI workflow',
  approval_decided: 'A decision is recorded on an approval you requested',
  due_soon: "An Element you're involved with is due soon",
  invite: 'Someone invites you to a Space, Domain or Object. Invitations also wait in Settings > Profile',
};

export function NotificationSettings() {
  const { t } = useI18n();
  const { muted, loading, error, pendingKinds, setKindMuted } = useNotificationPreferences();

  return (
    <div className="space-y-6">
      <p className="text-[12px] text-muted-foreground -mt-2">
        {t('Choose which kinds of activity create a notification in your Inbox. Off means it never gets created — not just hidden.')}
      </p>

      {error && (
        <div className="text-[12px] text-destructive">{error}</div>
      )}
      <SettingsIsland>
        {NOTIFICATION_KINDS.map((kind) => {
          const meta = NOTIFICATION_KIND_META[kind];
          const isEnabled = !muted.has(kind);
          return (
            <ToggleRow
              key={kind}
              label={t(meta.label)}
              desc={KIND_HINT[kind] ? t(KIND_HINT[kind]!) : undefined}
              value={isEnabled}
              onChange={(v) => setKindMuted(kind, !v)}
              disabled={loading || pendingKinds.has(kind)}
            />
          );
        })}
      </SettingsIsland>
    </div>
  );
}
