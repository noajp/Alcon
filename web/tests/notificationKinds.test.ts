// notificationKindMeta is shared between the Inbox feed (Alcon's original
// consumer) and Settings > Notifications (el_QLT-020). Both rely on the
// fallback for a `kind` value newer than this build knows about — the
// column is plain text with no CHECK constraint on purpose, so this is the
// one thing standing between an unrecognized kind and a crashed Inbox.

import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_META,
  notificationKindMeta,
} from '@/alcon/shared/notificationKinds';

describe('notificationKindMeta', () => {
  it('returns the declared meta for every known kind', () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(notificationKindMeta(kind)).toBe(NOTIFICATION_KIND_META[kind]);
    }
  });

  it('falls back to a readable label for an unrecognized kind, without crashing', () => {
    const meta = notificationKindMeta('some_future_kind');
    expect(meta.label).toBe('some future kind');
    expect(meta.color).toBe('text-muted-foreground');
  });

  it('falls back to "Update" for an empty kind', () => {
    expect(notificationKindMeta('').label).toBe('Update');
  });
});

describe('NOTIFICATION_KINDS', () => {
  it('lists every kind exactly once, matching NOTIFICATION_KIND_META', () => {
    expect(new Set(NOTIFICATION_KINDS).size).toBe(NOTIFICATION_KINDS.length);
    expect(NOTIFICATION_KINDS.sort()).toEqual(Object.keys(NOTIFICATION_KIND_META).sort());
  });
});
