# 0022. Intent は Initiative と一緒に読め、書けるのはそのオーナーだけ

2026-09-07 / ELE_STR-025

## 背景

el_STR-008 で Initiative の SELECT を Space 境界（配下 Object が見える人）へ広げた。だが Initiative の中身である `intents` / `intent_bindings` は単一の ALL ポリシーでオーナー限定のままだった。結果、閲覧者が Initiative を開くと Measures / Decisions / Assumptions が**空**に見えた。読み取り専用ではなく、存在しないように見えた。そして各ウィジェットは空状態のコンポーザを出し、最初の送信が DB に拒否される。「見えるなら書ける」の逆の穴で、ELE_STR-021 が塞いだ穴と同じ形。

## 選択肢

1. そのまま（Intent はオーナーの私物とみなす）
2. SELECT を Initiative と同じ可視性に広げ、書き込みはオーナーに残す
3. 書き込みも Space メンバーに開く

## 決定

2。`intents_select` は `user_can_see_strategy(strategy_id)` — `strategies` の SELECT が使っているのと同じ述語 — で判定し、Initiative とその Intent は一緒に見えるか、一緒に見えないか、のどちらかにする。INSERT / UPDATE / DELETE は従来のオーナー判定を `intents_write` として残す。`intent_bindings` も同じ形（Intent 経由）。

Intent にぶら下がる7表（`intent_lineage` / `intent_audits` / `intent_predictions` / `intent_resources` / `intent_alignments` / `intent_escalations` / `intent_next_actions`）も同じ形にする。Decisions のレビュー済み判定は `intent_lineage` を読むので、ここを閉じたままだと閲覧者にはレビュー済みの決定が「Overdue」に見える —— 読めるはずの事実が別の事実に化ける。

コンポーザだけでなく行のコントロール（Edit / Delete / Reading / レビュー記録 / リンクの追加と解除 / ステータス変更）も `canEdit` で閉じる。ロックの理由はオーナーが判明してから出す。判明前に「オーナーだけ」と言えばオーナー自身に一瞬嘘をつくし、照会に失敗したなら拒否ではなく失敗と言う。

UI 側は `InitiativeIntentProvider` が Initiative の `created_by` を受け取り、`canEdit` を Intent の state として配る。Measures / Decisions / Assumptions のコンポーザは `canEdit` が偽なら disabled + 理由。判定は ELE_STR-021 と同じ `canEditInitiative`（表示名ではなく `created_by` と `auth.uid()`）。

## 根拠

- **Measures は Initiative の一部。** 「何を達成し、どう勝つか」の成功条件が見えない Initiative は、閲覧者にとって名前だけの箱になる。Strategy と Execution の往復可能性（CLAUDE.md の核）は、Element から Initiative へ跳んで**意図が読める**ことを前提にしている
- **述語を共有する。** 可視性の定義を二重に持つと、Initiative が見えて Intent が見えない（今回）か、その逆が起きる。同じ関数を読めば食い違えない
- **書き込みは広げない。** 意図を書けるのはそれを負う人。閲覧者が Measures を書き換えられる状態は、責任の所在を曖昧にする。読めるが書けない、を UI が正直に見せれば足りる
- **選択肢 1 を捨てた理由。** el_STR-008 が下した「Initiative は Space に見せる」という判断と矛盾する。見せると決めたものの中身を隠すのは、判断を半分だけ実装した状態

## 覆す条件

- Initiative にオーナー以外の編集者（共同オーナー、Domain の owner/admin）を認めるとき。そのとき `intents_write` は `strategies` の UPDATE ポリシーと同じ新しい述語を読むべきで、両者は同時に変える
- Intent の一部を「オーナーだけの下書き」として隠す必要が出たとき。行単位の可視性フラグが要り、これは別の設計になる
