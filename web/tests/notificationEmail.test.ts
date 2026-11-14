import { describe, expect, it, vi } from 'vitest';
import { notificationEmailDefault, EMAIL_NOTIFICATION_KINDS } from '@/Function/shared/notificationKinds';

const mod = await import(new URL('../../supabase/functions/_shared/notificationEmail.ts', import.meta.url).pathname);
const { renderNotificationEmail, deliverNotificationEmails } = mod;

describe('renderNotificationEmail', () => {
  it('names who assigned and the Element, and links to the Inbox', () => {
    const e = renderNotificationEmail({ kind: 'assigned', title: 'You were added to 見積書', actorName: '佐藤', target: { type: 'element', title: '見積書' }, appUrl: 'https://app.example.com/' });
    expect(e.subject).toBe('「見積書」の担当になりました');
    expect(e.text).toContain('佐藤 さんが、あなたを「見積書」の担当に加えました。');
    expect(e.text).toContain('https://app.example.com/?view=inbox');
    const linked = renderNotificationEmail({ kind: 'assigned', title: 't', target: { type: 'element', title: '見積書', id: 'abc' }, appUrl: 'https://app.example.com/' });
    expect(linked.text).toContain('https://app.example.com/?element=abc');
  });

  it('escapes what people typed', () => {
    const e = renderNotificationEmail({ kind: 'assigned', title: 't', actorName: '<b>x</b>', target: { type: 'element', title: '<script>' }, appUrl: 'https://a.example' });
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
  });

  it('says Lead for an Object, and names who mentioned or commented', () => {
    const lead = renderNotificationEmail({ kind: 'assigned', title: 't', actorName: '佐藤', target: { type: 'object', title: '新規開拓' }, appUrl: 'https://a.example' });
    expect(lead.subject).toBe('「新規開拓」の Lead になりました');
    expect(lead.text).toContain('佐藤 さんが、あなたを「新規開拓」の Lead にしました。');
    const mention = renderNotificationEmail({ kind: 'mention', title: 't', actorName: '佐藤', body: '確認お願いします', target: { type: 'strategy', title: '関東展開' }, appUrl: 'https://a.example' });
    expect(mention.subject).toBe('佐藤 さんが「関東展開」であなたをメンションしました');
    expect(mention.text).toContain('確認お願いします');
    const comment = renderNotificationEmail({ kind: 'comment', title: 't', actorName: '佐藤', target: { type: 'element', title: '見積書' }, appUrl: 'https://a.example' });
    expect(comment.subject).toBe('佐藤 さんが「見積書」にコメントしました');
  });

  it('falls back to the notification title for other kinds', () => {
    expect(renderNotificationEmail({ kind: 'due_soon', title: 'Due soon: 見積書', appUrl: 'https://a.example' }).subject).toBe('Due soon: 見積書');
  });
});

describe('email defaults', () => {
  it('what is addressed to the person is emailed by default, and offered', () => {
    for (const kind of ['assigned', 'mention', 'comment']) {
      expect(notificationEmailDefault(kind)).toBe(true);
      expect(EMAIL_NOTIFICATION_KINDS).toContain(kind);
    }
    expect(notificationEmailDefault('due_soon')).toBe(false);
  });

  it('the server default matches the app default', async () => {
    const fs = await import('node:fs');
    const sql = fs.readFileSync(new URL('../../supabase/migrations/20270109090000_notification_emails.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/select p_kind in \('assigned', 'mention', 'comment'\)/);
  });
});

function fakeAdmin(rows: unknown[], notification: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  const table = (name: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: name === 'notifications' ? notification : name === 'elements' ? { title: '見積書' } : { display_name: '佐藤' } }) }) }),
    update: (patch: Record<string, unknown>) => ({ eq: async () => { updates.push(patch); return {}; } }),
  });
  return {
    updates,
    rpc: async () => ({ data: rows, error: null }),
    from: table,
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'a@example.com' } } }) } },
  };
}

describe('deliverNotificationEmails', () => {
  const row = { id: 'e1', notification_id: 'n1', recipient_id: 'u1', attempts: 1 };
  const unread = { kind: 'assigned', title: 't', body: null, actor_id: 'u2', actor_name: null, element_id: 'el1', is_read: false };

  it('skips, not keeps, when sending is not set up', async () => {
    const admin = fakeAdmin([row], unread);
    const r = await deliverNotificationEmails(admin, { apiKey: undefined, from: 'x', appUrl: 'https://a' });
    expect(r).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(admin.updates[0].status).toBe('skipped');
  });

  it('sends one email per queued row and marks it sent', async () => {
    const admin = fakeAdmin([row], unread);
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    const r = await deliverNotificationEmails(admin, { apiKey: 'k', from: 'Clayware <n@example.com>', appUrl: 'https://a', fetch });
    expect(r.sent).toBe(1);
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.to).toEqual(['a@example.com']);
    expect(body.subject).toBe('「見積書」の担当になりました');
    expect(admin.updates[0].status).toBe('sent');
  });

  it('does not email what was already read in the app', async () => {
    const admin = fakeAdmin([row], { ...unread, is_read: true });
    const fetch = vi.fn();
    const r = await deliverNotificationEmails(admin, { apiKey: 'k', from: 'f', appUrl: 'https://a', fetch });
    expect(r.skipped).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('puts a failed send back in the queue until the last attempt', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 500 }));
    const first = fakeAdmin([row], unread);
    await deliverNotificationEmails(first, { apiKey: 'k', from: 'f', appUrl: 'https://a', fetch });
    expect(first.updates[0].status).toBe('pending');
    const last = fakeAdmin([{ ...row, attempts: 3 }], unread);
    await deliverNotificationEmails(last, { apiKey: 'k', from: 'f', appUrl: 'https://a', fetch });
    expect(last.updates[0].status).toBe('failed');
  });
});
