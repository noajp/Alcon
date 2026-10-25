'use client';

import { SettingsSection, SettingsRow } from './SettingsSection';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useNotificationPreferences } from './useNotificationPreferences';
import { NOTIFICATION_KINDS, NOTIFICATION_KIND_META } from '@/Function/shared/notificationKinds';

const KIND_HINT: Partial<Record<string, string>> = {
  mention: 'Someone @mentions you in a comment',
  assigned: "You're assigned to an Element",
  comment: 'A new comment on an Element you own or are assigned to',
  status_change: "An Element you're involved with changes status, or an agent run you started finishes or fails",
  approval_requested: 'Your approval is requested on an Element',
  approval_decided: 'A decision is recorded on an approval you requested',
  due_soon: "An Element you're involved with is due soon",
  invite: 'Someone invites you to a Space, Domain or Object. Invitations also wait in Settings > Profile',
};

function ToggleSwitch({
  value, onChange, disabled, label,
}: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-[18px] w-8 items-center rounded-full transition-colors disabled:opacity-50 ${
        value ? 'bg-primary' : 'bg-muted-foreground/30'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          value ? 'translate-x-[15px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

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
      <SettingsSection title="">
        {NOTIFICATION_KINDS.map((kind) => {
          const meta = NOTIFICATION_KIND_META[kind];
          const isEnabled = !muted.has(kind);
          return (
            <SettingsRow key={kind} label={t(meta.label)} hint={KIND_HINT[kind] ? t(KIND_HINT[kind]!) : undefined}>
              <ToggleSwitch
                label={t(meta.label)}
                value={isEnabled}
                onChange={(v) => setKindMuted(kind, !v)}
                disabled={loading || pendingKinds.has(kind)}
              />
            </SettingsRow>
          );
        })}
      </SettingsSection>
    </div>
  );
}
