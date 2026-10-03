# 意思決定記録（ADR）

このコードベースはほとんどをエージェントが書いている。判断の根拠が PR 本文とセッションの文脈にしか無いと、**セッションが死んだ瞬間に理由が消え、次が同じ議論をやり直すか、前提が変わったことに気づかないまま古い判断に従い続ける。**

後者が実際に起きた。`el_UXQ-009`（QuickAdd 連続作成）は「InlineAddRow が既に同じ機能を持っているので二重実装を避ける」という理由で保留された。その後 InlineAddRow は削除され、追加は QuickAdd に一本化された。**保留の前提は消えていたのに誰も気づかず**、urgent の作業が盤面で沈んだままになった。理由が書き残されていれば、削除した側がその場で気づけた。

## 書くもの

構造や運用の判断で、**あとから「なぜこうなっているのか」と訊かれうるもの**。

書く: スキーマの形（列 vs テーブル）、処理の置き場所（クライアント vs DB vs Edge Function）、ゲートの厳しさ、権限の境界、状態の意味。

書かない: 実装の細部、命名、その場の修正。判断が1つの PR に閉じて他に波及しないなら不要。

## 形式

1判断1ファイル。`NNNN-短い名前.md`、連番。節は5つ:

- **背景** — 何が問題だったか。ここに事実だけを書く
- **選択肢** — 実際に検討したもの。1つしか無かったなら、そう書く
- **決定** — 選んだもの
- **根拠** — なぜ。**他の選択肢を捨てた理由**が本体
- **覆す条件** — 何が変わればこの判断は間違いになるか

最後の節が一番重要で、一番よく省略される。「未来永劫これが正しい」と書くのは、判断ではなく信仰。**どういう観測があれば考え直すべきかを、判断した本人が一番よく知っている。**

## 更新の作法

前提が変わって判断が覆ったら、**その ADR を上書きしない**。新しい ADR を書き、古い方の冒頭に `> 置き換え: NNNN` を1行足す。ADR は現在の設計の説明ではなく、判断の履歴。ここだけは [CLAUDE.md の「改訂の作法」](../../.claude/CLAUDE.md)（差分を残さず上書きする）の例外になる — 履歴を残すことがこのディレクトリの存在理由なので。

## 索引

| | 判断 |
|---|---|
| [0001](0001-element-direction-jsonb.md) | Element の Direction を jsonb 列にする |
| [0002](0002-activity-rollup-rpc.md) | 活動集計をサーバー側 RPC でやる |
| [0003](0003-comment-notifications-in-the-database.md) | コメント通知を DB トリガで作る |
| [0004](0004-design-lint-scoped-to-changed-files.md) | design-lint を変更ファイル限定のラチェットにする |
| [0005](0005-event-driven-loop.md) | 自走ループを時計ではなくイベントで駆動する |
| [0006](0006-ci-never-holds-the-service-role.md) | CI に service role を持たせない |
| [0007](0007-waiting-is-blocked-not-in-progress.md) | 人の判断待ちは blocked であって in_progress ではない |
| [0008](0008-dom-tests-opt-in-per-file.md) | DOM テストは設定分割ではなくファイル単位の opt-in |
| [0009](0009-loop-starts-from-a-hook.md) | ループの起動をセッションではなく hook に持たせる |
| [0010](0010-agents-notify-only-who-they-name.md) | エージェントのコメントは名指しした相手にだけ通知する |
| [0011](0011-loop-state-lives-in-the-lock.md) | ループの状態はロックファイルに置き、レポートは盤面に置く |
| [0012](0012-naming-the-agent-is-what-makes-an-order.md) | Campaign のコメントは、エージェントを名指ししたときだけ指示になる |
| [0013](0013-principles-and-independent-review.md) | 規約は原則の派生として書き、規約も独立レビューを通して届ける |
| [0014](0014-a-failure-is-a-transition.md) | 障害は状態ではなく遷移として報告する |
| [0015](0015-decisions-are-elements-assigned-to-a-person.md) | 判断は Campaign のコメントではなく、人にアサインされた Element で求める |
| [0016](0016-the-loop-reads-the-holders-log-and-watches-its-own-pulse.md) | ループを止めない — 受信は保持者のログの tail、時計は自分の死活、無人稼働は scheduled task |
| [0017](0017-campaign-objects-live-in-the-junction.md) | Campaign の Object 集合は junction にだけ置く |
| [0018](0018-data-hooks-read-through-the-query-cache.md) | データフックは query cache を通し、identity はセッションから読む |
| [0019](0019-one-delta-stream.md) | サーバーが確定した変更は 1 本の差分ストリームで受ける |
| [0020](0020-widget-data-and-addressable-boards.md) | Widget は永続データを参照し、配置を対象別に保存する |
| [0021](0021-the-lease-is-taken-by-rpc-not-by-prose.md) | リースは RPC で取る — 散文は記録であって取得ではない。保持者は表示名ではなくセッショントークン |
| [0022](0022-intents-are-read-with-the-initiative-and-written-by-its-owner.md) | Intent は Initiative と一緒に読め、書けるのはそのオーナーだけ |
| [0023](0023-domain-approaches-preserve-the-basis-of-judgment.md) | Domain の構想と判断根拠を保存する |
| [0024](0024-generated-apps-live-in-object-widgets.md) | Objectのウィジェット内で生成アプリと入力を分けて保存する |
| [0025](0025-generated-apps-read-scoped-object-context.md) | 生成アプリに配置先Objectの実データ読み取り契約を提供する |
| [0026](0026-external-ai-reaches-the-board-through-mcp-with-the-callers-rls.md) | 外部 AI は MCP（Edge Function）から本人の RLS で盤面を読み書きする |
| [0027](0027-agents-act-on-elements-with-the-callers-rls-and-stop-for-approval.md) | エージェントは本人の RLS で Element を代行し、外部への書き込みは承認を通す |
| [0028](0028-workers-belong-to-a-space.md) | Worker は Space に属する — 名前は Element に付いてきて、割り当ては境界に従う |
| [0029](0029-membership-takes-effect-on-acceptance.md) | 所属は招かれた本人の承諾で成立する — 招待は別の表に置き、RPC だけが書く |
| [0030](0030-unused-objects-are-archived-and-domains-with-objects-stay.md) | 使わなくなった Object はアーカイブし、Object が残る Domain は削除しない |
| [0031](0031-external-callers-authenticate-with-a-pat-or-oauth-and-get-a-short-lived-user-jwt.md) | 外部の呼び出しは PAT か OAuth で認証し、関数が本人の短命な JWT を発行する |
