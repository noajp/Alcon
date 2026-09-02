import {
  AtSign, UserPlus, MessageSquare, RefreshCw, ShieldCheck, Calendar, Bell,
} from 'lucide-react';
import type { NotificationKind } from '@/hooks/useSupabase';

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
  mention:            { icon: AtSign,        color: 'text-blue-400',    label: 'Mention' },
  assigned:           { icon: UserPlus,      color: 'text-emerald-400', label: 'Assigned' },
  comment:            { icon: MessageSquare, color: 'text-foreground/80', label: 'Comment' },
  status_change:      { icon: RefreshCw,     color: 'text-amber-400',   label: 'Status' },
  approval_requested: { icon: ShieldCheck,   color: 'text-purple-400',  label: 'Approval requested' },
  approval_decided:   { icon: ShieldCheck,   color: 'text-purple-400',  label: 'Approval decision' },
  due_soon:           { icon: Calendar,      color: 'text-red-400',     label: 'Due soon' },
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
    label: kind ? kind.replace(/_/g, ' ') : 'Update',
  };
}
