import { describe, expect, it } from 'vitest';
import { questionTicketIdsOf, splitInbox } from '@/Function/shared/inboxModel';

// The Inbox leads with what waits on the person: questions whose
// ticket still stands open. The split follows the ticket, not the
// notification's read flag.
const n = (id: string, kind: string, ticket: string | null = null, read = false) =>
  ({ id, kind, question_ticket_id: ticket, is_read: read });

describe('questionTicketIdsOf', () => {
  it('names each question ticket once, and nothing else', () => {
    const feed = [n('a', 'question', 't1'), n('b', 'status_change'), n('c', 'question', 't1'), n('d', 'question', 't2'), n('e', 'question', null), n('f', 'mention', 't9')];
    expect(questionTicketIdsOf(feed)).toEqual(['t1', 't2']);
  });
});

describe('splitInbox', () => {
  const feed = [n('a', 'status_change'), n('b', 'question', 't1', true), n('c', 'mention'), n('d', 'question', 't2'), n('e', 'question', 't3')];

  it('puts open questions first, read or not, and keeps both groups in order', () => {
    const { waiting, rest } = splitInbox(feed, new Set(['t1', 't3']));
    expect(waiting.map((x) => x.id)).toEqual(['b', 'e']);
    expect(rest.map((x) => x.id)).toEqual(['a', 'c', 'd']);
  });

  it('an answered or expired question is an ordinary row again', () => {
    const { waiting, rest } = splitInbox(feed, new Set());
    expect(waiting).toEqual([]);
    expect(rest.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('claims nothing is waiting until the open tickets are known', () => {
    expect(splitInbox(feed, null).waiting).toEqual([]);
    expect(splitInbox(feed, null).rest).toHaveLength(5);
  });

  it('a question without a ticket never waits', () => {
    expect(splitInbox([n('x', 'question', null)], new Set(['t1'])).waiting).toEqual([]);
  });
});
