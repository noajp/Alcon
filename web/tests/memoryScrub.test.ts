import { describe, expect, it } from 'vitest';

// The scrub (_shared/memoryScrub.ts): a candidate carrying a secret
// is dropped whole — the patterns below are the floor under the
// structural defence (the distillation digest never holds raw tool
// I/O). Just as important is what stays clean: ordinary know-how,
// numbers, ids and hashes are memories' normal content.
const scrub = await import(new URL('../../supabase/functions/_shared/memoryScrub.ts', import.meta.url).pathname);

describe('scrubText', () => {
  it('catches labelled credentials and headers', () => {
    expect(scrub.scrubText('api_key = "abcd1234efgh5678" を使う').clean).toBe(false);
    expect(scrub.scrubText('Authorization: Bearer abcdefgh12345678 で送る').clean).toBe(false);
    expect(scrub.scrubText('password: hunter2hunter2').clean).toBe(false);
    expect(scrub.scrubText('接続は postgres://user:secretpass@db.internal:5432/app').clean).toBe(false);
  });

  it('catches the known key shapes and key blocks', () => {
    expect(scrub.scrubText('キー AKIAIOSFODNN7EXAMPLE を使う').clean).toBe(false);
    expect(scrub.scrubText('ghp_abcdefghijklmnopqrstuvwxyz0123456789').clean).toBe(false);
    expect(scrub.scrubText('sk-abcdefghijklmnopqrstuvwxyz').clean).toBe(false);
    expect(scrub.scrubText('-----BEGIN PRIVATE KEY-----').clean).toBe(false);
    expect(scrub.scrubText('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3AAA').clean).toBe(false);
  });

  it('catches a one-time code named as one', () => {
    expect(scrub.scrubText('確認コードは 483920 です').clean).toBe(false);
    expect(scrub.scrubText('verification code 112233').clean).toBe(false);
  });

  it('catches an unlabelled high-entropy token', () => {
    expect(scrub.scrubText('値は xK9mQ2wZ8vN4bR7tY3pL6sD1fG5hJ0aX だった').clean).toBe(false);
  });

  it('leaves ordinary know-how clean', () => {
    expect(scrub.scrubText('X の一覧 API は limit=50 以下でないと 504 になる。締めは翌営業日。').clean).toBe(true);
    expect(scrub.scrubText('週次報告は金曜 17 時締め。表のキーは請求書番号で統一する。').clean).toBe(true);
    expect(scrub.scrubText('6 月の締め集計は A 社の遅延請求で 2 件ずれた（合計 1,234,500 円）。').clean).toBe(true);
    // A bare word is not a credential: only an assignment with a value trips it.
    expect(scrub.scrubText('token の有効期限は短いので、期限切れなら再発行が要る。').clean).toBe(true);
    // A hex hash / id is an identifier, not a secret.
    expect(scrub.scrubText('対象の run は 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08').clean).toBe(true);
  });
});

describe('scrubCandidate', () => {
  it('drops the whole candidate when any field is tainted', () => {
    const r = scrub.scrubCandidate({ title: '連携の癖', gist: 'api_key = "abcd1234efgh5678"', body: '本文は無事。' });
    expect(r.clean).toBe(false);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(scrub.scrubCandidate({ title: '連携の癖', gist: '一行', body: '本文。' }).clean).toBe(true);
  });
});
