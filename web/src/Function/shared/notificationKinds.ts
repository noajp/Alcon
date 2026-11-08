import {
  AtSign, UserPlus, RefreshCw, ShieldCheck, Calendar, CalendarClock, Bell, Plug, TriangleAlert, HeartPulse,
  ArrowUpCircle, HelpCircle,
} from '@/ui/icons';
import type { NotificationKind } from '@/hooks/useSupabase';
import { MessageIcon } from '@/Function/shared/conceptIcons';
import { translate } from '@/Function/i18n/I18nProvider';

export interface NotificationKindMeta {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  label: string;
}

// Shared between the Inbox feed (which surface earned the icon/color) and
// Settings > Notifications (which lets a user mute a kind). One row per
// NotificationKind, so adding a kind here is the only place both surfaces
// need updating.
export const NOTIFICATION_KIND_META: Record<NotificationKind, NotificationKindMeta> = {
  mention:            { icon: AtSign,        color: 'text-[var(--accent-default)]',    label: 'Mention' },
  assigned:           { icon: UserPlus,      color: 'text-emerald-400', label: 'Assigned' },
  comment:            { icon: MessageIcon,   color: 'text-foreground/80', label: 'Comment' },
  status_change:      { icon: RefreshCw,     color: 'text-amber-400',   label: 'Status' },
  approval_requested: { icon: ShieldCheck,   color: 'text-purple-400',  label: 'Approval requested' },
  approval_decided:   { icon: ShieldCheck,   color: 'text-purple-400',  label: 'Approval decision' },
  due_soon:           { icon: Calendar,      color: 'text-[var(--status-danger)]',     label: 'Due soon' },
  review_due:         { icon: CalendarClock,  color: 'text-amber-400',   label: 'Review due' },
  invite:             { icon: UserPlus,      color: 'text-[var(--accent-default)]', label: 'Invitation' },
  asset_announced:    { icon: Plug,          color: 'text-[var(--accent-default)]', label: 'Asset announced' },
  measure_missed:     { icon: TriangleAlert, color: 'text-[var(--status-danger)]', label: 'Success condition missed' },
  heartbeat:          { icon: HeartPulse,    color: 'text-rose-400',    label: 'Heartbeat' },
  promotion:          { icon: ArrowUpCircle, color: 'text-teal-400',    label: 'Promotion' },
  question:           { icon: HelpCircle,    color: 'text-sky-400',     label: 'Question' },
};

export const NOTIFICATION_KINDS = Object.keys(NOTIFICATION_KIND_META) as NotificationKind[];

// `notifications.kind` does carry a CHECK constraint, but a newer deploy can
// widen it before this build knows the new value — and the mute preference
// for a kind lives in `notification_preferences.kind`, a plain text column
// with no such constraint at all. Falling off the end of the meta map used
// to take the whole Inbox down with it.
export function notificationKindMeta(kind: string): NotificationKindMeta {
  return NOTIFICATION_KIND_META[kind as NotificationKind] ?? {
    icon: Bell,
    color: 'text-muted-foreground',
    label: kind ? kind.replace(/_/g, ' ') : translate('Update'),
  };
}
