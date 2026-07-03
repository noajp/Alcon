import type { ConversationListItem, ConversationMemberProfile } from '@/types/database';

// Members of a conversation other than the current user.
export function otherMembers(
  members: ConversationMemberProfile[],
  myUserId: string | null
): ConversationMemberProfile[] {
  return members.filter((m) => m.user_id !== myUserId);
}

// Display name for a conversation row / header:
//  - group  → its title, else the other members' names joined
//  - direct → the other person's name
export function conversationTitle(c: ConversationListItem, myUserId: string | null): string {
  if (c.kind === 'group') {
    if (c.title?.trim()) return c.title.trim();
    const names = otherMembers(c.members, myUserId).map((m) => m.display_name ?? 'Unknown');
    return names.length ? names.join(', ') : 'New group';
  }
  return otherMembers(c.members, myUserId)[0]?.display_name ?? 'Unknown';
}

// Avatar for a direct conversation (the other person). Groups have no
// single avatar — callers fall back to a group icon.
export function conversationAvatarUrl(c: ConversationListItem, myUserId: string | null): string | null {
  if (c.kind === 'group') return null;
  return otherMembers(c.members, myUserId)[0]?.avatar_url ?? null;
}

export function initialOf(name: string | null | undefined): string {
  return (name ?? '?').trim().charAt(0).toUpperCase() || '?';
}

// Compact relative timestamp for conversation rows: 今 / n分 / n時間 / n日,
// falling back to M/d beyond a week.
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return '今';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}時間`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}日`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// Day label for in-thread date separators: 今日 / 昨日 / M月d日 (older years
// get 年 prepended).
export function formatDaySeparator(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (dayDiff === 0) return '今日';
  if (dayDiff === 1) return '昨日';
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** True when two ISO timestamps fall on different calendar days. */
export function isDifferentDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() !== db.getFullYear() ||
    da.getMonth() !== db.getMonth() ||
    da.getDate() !== db.getDate()
  );
}
