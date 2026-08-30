# 0001. Element の Direction を jsonb 列にする

2026-08-30 / el_TRJ-002・PR #193

## 背景

Element は「何をするか」（title）と「今どうなっているか」（status / assignee / due）は持っていたが、**「どう進めるか」と「何をもって完了とするか」の置き場が無かった**。方針も受け入れ条件も description の散文に埋もれ、構造として取り出せない。エージェントに委任するとき、この2つが曖昧だと実装がぶれる。

必要なのは approach（方針）/ acceptance（受け入れ条件）/ next（次の一手）の3つ。

## 選択肢

1. **専用テーブル** `element_directions`（element_id FK + 3列）
2. **平坦な列を3本** `elements` に足す（`direction_approach` 等）
3. **jsonb 列1本** `elements.direction`

## 決定

3。`elements.direction jsonb`、`jsonb_typeof(direction) = 'object'` の CHECK 制約のみを DB 側の保証とし、形の正規化はクライアントの `normalizeDirection`（`types/database.ts`）が担う。

## 根拠

Direction は Element と 1:1 で、Element 抜きに存在せず、Element と同時にしか読まれない。専用テーブルにすると全ての読み取りに join が増えるだけで、分離から得るものが無い。

平坦な3列との差は**将来の形の変更コスト**。acceptance は現在 `string[]` だが、「実際にチェックできるようにしたい」という要求が既に見えている（el_TRJ-010）。その時 jsonb なら `{text, checked}` への移行がマイグレーション無しで済み、平坦な列なら列の追加とバックフィルが要る。3つの下位フィールドが揃って1つの概念を成すので、DB から見て1つの値である方が実態に合う。

CHECK を `jsonb_typeof = 'object'` だけに留めたのは、**DB に形を強制させると形の変更が毎回マイグレーションになる**から。ここで守りたいのは「配列や文字列が紛れ込まない」ことだけで、中身の妥当性はクライアントの正規化が引き受ける。

## 覆す条件

- Direction を Element 抜きに検索・集計したくなったとき（例: 「受け入れ条件が空の Element を横断で探す」が頻出になる）。jsonb でも式インデックスで対応できるが、それが増えるなら列か表に切るべき合図
- Direction を Element と別の権限で扱いたくなったとき。列である以上 `elements` の RLS を共有するので、別扱いが要るなら分離が必要
- 下位フィールドが増えて実質スキーマになったとき。jsonb は「形が動く」ことへの投資であって、動かなくなったなら利点が消える
