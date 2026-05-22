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
