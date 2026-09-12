# DB を直に触るときの不変条件

[SKILL.md](../SKILL.md) から参照。SQL で盤面の行を作る・migration を書くときだけ読む。

## Element を SQL で作る

- **junction を二重に書く。** `element_objects` が無いと UI に出ず、`element_assignees` が無いとキュー取得クエリに載らない — どちらも「作ったのに存在しないのと同じ」状態を作る。作成直後に両方を SELECT で確認する
- **`display_id` は INSERT で指定してもトリガが採番し直す。** だから **`insert ... returning id` を CTE で受けて、その id で関連を張る**。`where display_id = '...'` で引き直してはいけない
  - 指定した `el_TRJ-011` が `el_TRJ-012` として採番され、直後の `where display_id in (...)` による junction 付与が丸ごと外れた実例がある。しかも `el_TRJ-011` は既存の別 Element だったので、検証クエリは「関連あり」と答えた —— **間違った行を見て正しいと判定した**
  - 罠は「junction を書き忘れる」ことではない。**指定した display_id で行を参照できないので、「INSERT してから display_id で引いて関連を張る」というパターン自体が構造的に安全でない**
- **同一ステートメント内の CTE / トリガ挿入行は外側から見えない。** 検証 SELECT は必ず別クエリで打つ
- **Domain を生 SQL で作ったら `domain_members`（owner）も書く。** `useDomains` はメンバーシップで絞り込む（UI の `createDomain()` は自動で書くが生 INSERT は飛ばす）。忘れるとどこにも出てこず「バグかも」と早合点する

## migration

**`to_regclass` ガード必須。** PR の preview branch は空 DB に `supabase/migrations/*.sql` を replay するが、基底スキーマはそのフォルダの外にある。ガードが無いと `42P01` で `MIGRATIONS_FAILED`。

```sql
do $$
begin
  if to_regclass('public.<table>') is null then
    raise notice '<what> skipped: <table> not present'; return;
  end if;
  execute '<DDL>';   -- DDL は execute '...' の中（動的）に。空 DB でも parse を通すため
end $$;
```

本番への適用は MCP `apply_migration`（リポジトリのファイルと同内容）。
