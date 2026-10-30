import { describe, expect, it } from 'vitest';
import { AGENT_MENTION, classifyElementComment, isOurElement, resolveElementName } from '../../.claude/ops/elementScope.mjs';

// el_OPS-030. Measured on the real board: `formatComment()` had no scope
// check at all, so a comment on another team's Element passed straight
// through and came out as `COMMENT   element:3bced448 — Capt. Hale: …` — no
// display_id, no Object, no Domain. It was neither dropped nor readable,
// which is worse than either on its own.
//
// The fix has two halves, and both are pure decisions with no socket or REST
// call in them — the exact shape faultReporter.mjs was split out for, and
// tested the same way here.

const SELF = 'Claude';

describe('classifyElementComment', () => {
  it('reports our own board regardless of mention — it is our conversation, not chatter', () => {
    expect(classifyElementComment({ authorName: 'n.takanori', content: 'looks good', selfAuthor: SELF, isOurs: true })).toBe(
      'COMMENT',
    );
  });

  it('reports a foreign board only when the comment names the agent', () => {
    expect(
      classifyElementComment({ authorName: 'Capt. Hale', content: '配布ラインの一覧で @Claude 確認して', selfAuthor: SELF, isOurs: false }),
    ).toBe('FEEDBACK');
  });

  it('drops foreign chatter that does not name the agent — the deliberate silence, not a gap', () => {
    expect(
      classifyElementComment({ authorName: 'Capt. Hale', content: '配布ラインの一覧で確認して', selfAuthor: SELF, isOurs: false }),
    ).toBeNull();
  });

  it('drops our own echo before checking whose board it is — on our own board too', () => {
    // Without this ordering, every one of our own progress comments on
    // the dev Domain would re-report itself as a fresh COMMENT the moment it
    // arrives back off the realtime stream.
    expect(classifyElementComment({ authorName: SELF, content: '● 進捗 — done', selfAuthor: SELF, isOurs: true })).toBeNull();
  });

  it('drops our own echo on a foreign board too — a FEEDBACK reply must not report itself', () => {
    expect(
      classifyElementComment({ authorName: SELF, content: '◆ 提案 @Claude confirmed', selfAuthor: SELF, isOurs: false }),
    ).toBeNull();
  });
});

describe('AGENT_MENTION', () => {
  it('matches @claude at a word boundary, case-insensitively', () => {
    expect(AGENT_MENTION.test('@Claude can you check this')).toBe(true);
    expect(AGENT_MENTION.test('@CLAUDE, please look')).toBe(true);
    expect(AGENT_MENTION.test('ending with @claude')).toBe(true);
  });

  it('does not match a different name that merely starts the same', () => {
    // A word boundary after "claude" is required, so a name sharing the
    // prefix — a different bot, a different exercise's own agent — must not
    // false-positive into feedback meant for us.
    expect(AGENT_MENTION.test('@ClaudeBot handled this already')).toBe(false);
  });

  it('does not match the name mentioned in the middle of a sentence without @', () => {
    expect(AGENT_MENTION.test('Claude looked into this yesterday')).toBe(false);
  });
});

describe('resolveElementName', () => {
  const seeded = new Map([['e1', { label: 'el_OPS-030 fix the scope check' }]]);
  const foreign = new Map([['e2', { label: 'el_LOG-003 燃料・発電機の供給網', inScope: false }]]);

  it('prefers the seeded (the dev Domain) cache', () => {
    expect(resolveElementName('e1', { elementState: seeded, foreignElementState: foreign })).toBe(
      'el_OPS-030 fix the scope check',
    );
  });

  it('falls back to the on-demand cache for a resolved foreign Element', () => {
    expect(resolveElementName('e2', { elementState: seeded, foreignElementState: foreign })).toBe(
      'el_LOG-003 燃料・発電機の供給網',
    );
  });

  it('falls back to a bare uuid prefix only when neither cache has it', () => {
    // This is exactly the bug: before el_OPS-030, this bare fallback was the
    // *only* thing formatComment could ever produce for a foreign Element,
    // because nothing ever populated a foreign cache in the first place.
    expect(resolveElementName('3bced448-aaaa-bbbb-cccc-000000000000', { elementState: seeded, foreignElementState: foreign })).toBe(
      'element:3bced448',
    );
  });
});

describe('isOurElement', () => {
  const seeded = new Map([['e1', { label: 'ours' }]]);

  it('is true for anything in the seeded cache', () => {
    expect(isOurElement('e1', { elementState: seeded, foreignElementState: new Map() })).toBe(true);
  });

  it('is true for a foreign-cache entry whose object_id turned out to be ours — the seed-race case', () => {
    // A comment can arrive before the Element's own INSERT has been seen; the
    // on-demand lookup still resolves the real object_id and must not
    // misreport a genuinely-ours Element as foreign.
    const raced = new Map([['e3', { label: 'el_UXQ-099 just created', inScope: true }]]);
    expect(isOurElement('e3', { elementState: seeded, foreignElementState: raced })).toBe(true);
  });

  it('is false for a resolved foreign Element', () => {
    const foreign = new Map([['e2', { label: 'foreign', inScope: false }]]);
    expect(isOurElement('e2', { elementState: seeded, foreignElementState: foreign })).toBe(false);
  });

  it('is false for an id in neither cache — the default while a lookup is still in flight', () => {
    expect(isOurElement('unresolved', { elementState: seeded, foreignElementState: new Map() })).toBe(false);
  });
});
