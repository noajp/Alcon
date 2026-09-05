import { describe, expect, it, vi } from 'vitest';
import { readReportPost } from '../../ops/reportPost.mjs';

describe('explicit report posting', () => {
  it('keeps ordinary diagnostic reads read-only', () => {
    const read = vi.fn();
    expect(readReportPost(['--hours', '72'], read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it.each([['--post'], ['--post', '--hours', '72']])('rejects a legacy bare post before reading anything: %j', (...args) => {
    const read = vi.fn();
    expect(() => readReportPost(args, read)).toThrow('--post requires a UTF-8 file');
    expect(read).not.toHaveBeenCalled();
  });
  it('requires an explicit author', () => {
    expect(() => readReportPost(['--post', 'note.txt'], vi.fn())).toThrow('--author');
  });
  it('rejects an empty narrative', () => {
    expect(() => readReportPost(['--post', 'note.txt', '--author', 'Codex'], () => '  ')).toThrow('empty');
  });
  it('posts only the supplied narrative and author', () => {
    const read = vi.fn(() => '  Decision: keep the historical comments.\n');
    expect(readReportPost(['--hours', '72', '--post', 'note.txt', '--author', 'Codex'], read))
      .toEqual({ author: 'Codex', content: 'Decision: keep the historical comments.' });
    expect(read).toHaveBeenCalledWith('note.txt');
  });
});
