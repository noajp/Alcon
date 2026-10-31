import { describe, expect, it } from 'vitest';
import { attachKind, toolVerb } from '@/Function/copilot/copilotFiles';

describe('AI attachments', () => {
  it('reads PDF, Markdown and text — by type, or by name when the browser leaves it untyped', () => {
    expect(attachKind('plan.pdf', 'application/pdf')).toBe('pdf');
    expect(attachKind('PLAN.PDF', '')).toBe('pdf');
    expect(attachKind('notes.md', '')).toBe('text');
    expect(attachKind('notes.markdown', 'text/markdown')).toBe('text');
    expect(attachKind('log.txt', 'text/plain')).toBe('text');
    expect(attachKind('deck.pptx', 'application/vnd.ms-powerpoint')).toBeNull();
    expect(attachKind('photo.png', 'image/png')).toBeNull();
  });
});

describe('AI step wording', () => {
  it('names what a tool call does', () => {
    expect(toolVerb('listElements')).toBe('Reading');
    expect(toolVerb('deleteObject')).toBe('Deleting');
    expect(toolVerb('bulkDeleteElements')).toBe('Deleting');
    expect(toolVerb('createElement')).toBe('Creating');
    expect(toolVerb('updateElement')).toBe('Updating');
    expect(toolVerb('strategy', { action: 'list' })).toBe('Reading');
    expect(toolVerb('strategy', { action: 'deleteInitiative' })).toBe('Deleting');
  });
});
