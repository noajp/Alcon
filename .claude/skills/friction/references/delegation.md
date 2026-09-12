# 標準ブリーフ — 実装を委任するとき

[SKILL.md](../SKILL.md) の「委任範囲」から参照。以下5項目を**全部**含める。欠けたまま投入したら、それは指示側の不足。

1. **作業場所** — `isolation: worktree`。冒頭で `git fetch origin main && git checkout -b claude/fric-<prefix>-<slug> origin/main`。メインチェックアウトに書かない・main に居座らない

2. **環境** — `web/node_modules` が無ければ既存 worktree から `cp -c -R`（APFS の CoW）**したうえで `npm install` を必ず走らせる**。symlink は turbopack が「filesystem root 外」として拒否する
   - CoW コピーは高速化の手段であって依存解決の代替ではない。**コピー元が古いと依存の欠けた木ができる。** `jsdom` を欠いた worktree で `npx tsc --noEmit` が **main のコードに対して TS2307 を報告**した実例がある。ゲートは正直に落ちるが、**実装エージェントは自分の環境より先にコードを疑うので「main が壊れている」と誤診する**

3. **検証** — tsc 0 / `npm test` / eslint は変更ファイルの前後比較 / `npm run unwired-lint` / UI なら `npm run design-lint`
   - **サブエージェントは `preview_start` を使わない**（理由は SKILL.md の「視覚検証」）
   - **新規ファイルを足したら、コミットしてから `unwired-lint` を回し直す。** この検査は `git ls-files` で対象を集めるので **untracked のファイルは1つも見えない** —— 手元は 0 件、CI は落ちる（PR #268 で実際に CI FAILURE）

4. **報告書式** — PR URL・変更ファイル・検証の前後比較・迷った点（Element 記述の不足を正直に）

5. **禁止** — マージ・main 直 push・無関係ファイル・Subelement データ・`preview_start`・資格情報の入力（他セッションや他タブの認証トークンの借用を含む。ログインできないなら「ログイン不要の代替検証」に落とす）

## レビューから還流した条項（毎回焼き込む）

- 楽観更新には必ずロールバックを書く（保存失敗で「保存済み」の顔をさせない）
- Escape は取り消し。blur=保存の経路に合流させない（フォーカス時にスナップショット → Escape で復元）
- jsonb 等の丸ごと上書き書き込みは Promise チェーンで直列化する（到達順の逆転で新しい値が消える）
- key が同じままプロップの中身だけ変わるケース（realtime 反映）で、seed-once の state が腐らないかを設計時に問う
- 連打操作（Enter 連続）は debounce し、write / activity log / refresh をバーストさせない
- 既存の設計意図を先に読む — 「機能が無い」と感じた箇所に実装があり呼び出し元だけが無かった例が複数ある

## ログイン不要の代替検証

資格情報が使えないときの最終手段。該当要素の className をブラウザ console で `document.createElement` → `getComputedStyle()` に通し、修正前後の計算値（border-width / style / 色）を比較する。
