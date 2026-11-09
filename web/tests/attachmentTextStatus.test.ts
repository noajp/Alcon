import { describe, expect, it } from 'vitest';
import { textOutcomeOf, textSearchCaptionOf } from '@/hooks/attachmentData';

// The state a file's words are in is recorded beside them (attachment_
// texts.status), so a failed read is no longer the same '' as a file
// that genuinely has no words — and can be retried while the terminal
// states are left alone. These pin the pure halves of that recording:
// what a settled extraction means, and the one quiet caption the Files
// pane shows for each state.

describe('textOutcomeOf — what a settled extraction records', () => {
  it('words found: the words, as ok', () => {
    expect(textOutcomeOf('本文テキスト')).toEqual({ body: '本文テキスト', status: 'ok' });
  });

  it('no words to read (an image, a scan): empty — not a failure', () => {
    expect(textOutcomeOf(null)).toEqual({ body: '', status: 'empty' });
    expect(textOutcomeOf('')).toEqual({ body: '', status: 'empty' });
  });
});

describe('textSearchCaptionOf — the pane’s one quiet line per state', () => {
  it('ok, and not-yet-known, say nothing', () => {
    expect(textSearchCaptionOf('ok')).toBeNull();
    expect(textSearchCaptionOf(undefined)).toBeNull();
  });

  it('no row yet, and a failed read, say the words are not searchable yet', () => {
    expect(textSearchCaptionOf(null)).toBe('Contents are not searchable yet');
    expect(textSearchCaptionOf('failed')).toBe('Contents are not searchable yet');
  });

  it('empty and too_large each say their own state', () => {
    expect(textSearchCaptionOf('empty')).toBe('No readable text in this file');
    expect(textSearchCaptionOf('too_large')).toBe('Too large to search its contents');
  });
});
