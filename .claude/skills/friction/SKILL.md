---
name: friction
description: Alcon 自体を Alcon の盤面（Supabase の elements）で開発する自走ループの運用規約。盤面から Element を取る・進捗を盤面へ書き戻す・実装をサブエージェントへ委任するときに読む。
---

Alcon を Alcon で開発する。**バックログの単一情報源は盤面（Supabase の `elements`）** — 外部の TODO リストを作らない。

**アプリ内 AI（Edge Functions: `alcon-copilot` / `run-agent` 等）はこのループでは使わない**（API コストが発生するため、ユーザーの明示指示）。

必要になったときだけ読む：委任ブリーフは [references/delegation.md](references/delegation.md)、DB を直に触るなら [references/db.md](references/db.md)、配管の設定と起動は [`ops/README.md`](../../../ops/README.md)、判断の履歴は [`docs/adr/`](../../../docs/adr/README.md)、起きた事故と再発時手順は [`docs/friction-risk-register.md`](../../../docs/friction-risk-register.md)。

## 原則

規則は状況を網羅できない。初見の状況は原則で判断し、以降の節は原則の派生として読む。原則から導けない規則は削除候補。フィードバックが来たら「規則が欠けたのか、原則が欠けたのか」を見極め、正しい高度に最小の差分を当てる（→ [IMPROVE.md](IMPROVE.md)）。

1. **盤面が唯一の真実。** バックログ・座標・状態・担当の台帳はすべて盤面。ファイルや記憶に第二の情報源を作らない — 二つ目は更新されないまま静かに腐り、必ず盤面と食い違う
2. **イベントが駆動し、時計は死だけを検知する。** 時計で取りに行く設計は、遅いか、暴走するかのどちらかに倒れる
3. **git は搬送路。荷が届いたら車両は消し、共有物は握らない。** マージ後に残ったブランチ、checkout されたままの `main`、共有 stash への bare 操作は、どれも並行セッションを止める
4. **現物で検証する。** 戻り値・成功メッセージ・自分の想定を信じない。このループの事故は全部「成功したはず」と現物のずれから始まっている
5. **決めて、動いて、事後報告する。** 逐一確認は自走を不成立にする。止まるのは4条件（課金 / 不可逆 / 割れた設計判断 / 2 tick 停滞）だけ
6. **盤面を変えるものは提案が先。** 問いを仕事に変換すると答えが常に「やる」に倒れる。沈黙は承認ではない
7. **判断と事故は覆す条件つきで残す。** なぜ・いつ覆すかの無い規則は、検証も廃止もできない縛りとして腐る
8. **言葉は置き場所で課金される。** 恒久ファイルは毎セッション読まれ、1行が永続コストになる。作業データ・報告・往復は盤面コメント / PR 本文 / scratchpad へ。稀にしか要らない手順は参照ファイルへ逃がす（段階的開示）。行を足すときは同じ重さを削れないかを先に問う
9. **実装と規約を、独立レビューで改善して届ける。** 実装者とは別のエージェントが検査し、指摘修正・再検証・Push・再レビューを通過するまで回す。実装 PR も規約 PR もユーザーの Merge 承認を待たずマージし、同期と作業場の削除まで確認して閉じる

## 盤面の座標

**ID をこのファイルに書かない。** Phase は作り替わり Object は増減するので、git に焼くと腐って第二の情報源になる。座標は起動時に盤面から引く。

```sql
select id, display_id from workers where type = 'ai_agent' and name = 'Claude';
select id, name, start_date, end_date from phases order by start_date desc limit 3;
select id, prefix, name from objects order by created_at;
```

## ループの駆動

盤面が push チャネル。`elements` / `element_comments` / `element_assignees` / `strategy_comments` / `dev_events` / `dev_control` は realtime に載っており、変化は向こうから届く。**時計で取りに行かない**（→ ADR [0005](../../../docs/adr/0005-event-driven-loop.md)）。

- **エージェント完了**（ハーネスネイティブ）が本体のエンジン。ループ周期＝仕事の完了速度
- **盤面の変化** — `ops/board-listen.mjs`。**盤面を操作すること自体が指示**になる。リスナーはリポジトリ単位のリースで1つだけ走るので、受信は保持者のログを `tail -n0 -F` で見る。**他 worktree のリースを奪わない**（→ ADR [0016](../../../docs/adr/0016-the-loop-reads-the-holders-log-and-watches-its-own-pulse.md)）
- **時計はデッドマンスイッチのみ** — `ops/stall-check.mjs` は「仕事はあるか」ではなく「止まっていないか」を見る。ハートビートは進捗コメント
- **ガバナー** `dev_control`（`paused` / `max_concurrent`）はディスパッチする側が尊重する。緊急停止は SendMessage ではなくこれ
- **ターンを空で終えない。** 着手できる Element が残っているのに走行中エージェントも Monitor も無い状態で閉じない。閉じてよいのは「取れる仕事が無い」「判断待ちだけ」「`paused`」のいずれか

**罠**: realtime の `old_record` は主キーしか入らない（`REPLICA IDENTITY DEFAULT`）。旧値との比較は自前のスナップショットで行う。

**無人稼働（セッションが閉じても回る）は scheduled task で解く。** 課金と権限を伴うので DEC の判断を経る。

## キューを取る

```sql
select e.display_id, e.title, e.status, e.priority,
       e.phase_id is not null as in_sprint, o.prefix
from elements e
join objects o on o.id = e.object_id
join element_assignees ea on ea.element_id = e.id
where ea.worker_id = (select id from workers where type = 'ai_agent' and name = 'Claude')
  and e.status in ('todo', 'in_progress', 'review')
  and (e.claimed_by is null or e.claim_expires_at < now())   -- 期限内のリースは他セッションの仕事
order by (e.phase_id is not null) desc,
  case e.priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end;
```

棚卸しには DEC と Initiative スレッドも含める。`ORDER` はリスナーが走っている間しか届かないので、切れている間に書かれた指示は拾いに行く。

## 判断は Element — Decisions（DEC）

止まる4条件に当たったら、**Object「Decisions — 判断」に Element を1つ起票し、判断する人（`workers.user_id` を持つ human Worker）にアサインして、止まらずに次へ行く。** Initiative のコメントで判断を仰がない — 返事の無いまま沈んだ実例がある（→ ADR [0015](../../../docs/adr/0015-decisions-are-elements-assigned-to-a-person.md)）。

- `is_approval=true` / `approval_state='pending'` / `status='todo'` / `labels=['decision']`。`element_objects` と `element_assignees` を書き、`notifications` に `approval_requested` を1行、着手コメントの `mentions` にその人の uuid
- description は **何を決めるか / 選択肢（推奨を先頭、却下した案も）/ なぜ判断が要るか / 承認のしかた / 承認後に起きること**
- 答えは Approval とコメント。**沈黙は承認ではない。** pending の間、その判断に依存しない仕事を先に消化する
- 決まったら `✔ 完了 — 何を選んだか` を書いて `done`。changes_requested は選択肢を書き直して pending に戻す

## ステータス遷移とリース

`todo` →(**リース取得** + 着手コメント)→ `in_progress` →(PR 作成 + リンク)→ `review` →(ゲート通過 → マージ)→ `done`（完了コメント + `progress=100` + **リース解放**）。

**着手はリースで取る。散文は記録であって取得ではない**（→ ADR [0021](../../../docs/adr/0021-the-lease-is-taken-by-rpc-not-by-prose.md)）。

```bash
node ops/lease.mjs claim <display_id> [--branch claude/fric-<prefix>-<slug>] [--note "方針1行"]
node ops/lease.mjs comment <display_id> --text "…"     # 長文は --file
node ops/lease.mjs release <display_id> --text "✔ 完了 — …"
node ops/lease.mjs whoami                              # 保持者トークン Claude@<worktree名>
```

`claim_element()` が false なら**他セッションが保持中** — 終了コード 3 で降りる。待つか別を取るかは自分で決めるが、**取りにいかない**。コードを書かない継続監視系の Element も claim する（branch は無くてよい）。

- **`done` にできるのはマージ確認後のみ**（`gh pr view <n> --json state` で現物確認）
- **`in_progress` は「今まさに手が動いている」ことだけ。** ユーザー判断待ちになったら `blocked` + `■ Blocked` へ落とす。停滞検知は `in_progress` だけを見るので、待機を置くと死亡と区別できない（→ ADR [0007](../../../docs/adr/0007-waiting-is-blocked-not-in-progress.md)）

## コメント報告（`element_comments`）

`author_kind='ai_agent'`、`author_id=NULL`（FK 先は `auth.users`）、`author_name='Claude'`、**`holder` = 自分のトークン**。手で書かず `lease.mjs comment` を通す。

| | 書式 |
|---|---|
| 着手 | `▶ 着手 — branch: <名> / holder: <トークン> / 方針1行`（`claim` が書く） |
| 進捗 | `● 進捗 — 何をしたか / 次` |
| PR | `⬆ PR — <URL> 検証結果1行` |
| 完了 | `✔ 完了 — 結果`（`release --text` が書く） |
| 詰まり | `■ Blocked — 原因と必要な判断` |

**刻印のあるコメントがリースを延ばす。** 報告する行為とリースを保つ行為は同一で、黙ったままリースは保持できない。ユーザーへの判断依頼はコメントと会話の両方に出す。

## Initiative が指令所（`strategy_comments`）

**Initiative に書かれた意図が仕事になる経路**で、ユーザーは Initiative を見ているだけで済む（→ ADR [0012](../../../docs/adr/0012-naming-the-agent-is-what-makes-an-order.md)）。

**エージェントを名指ししたコメントだけが指示。** 本文に `@Claude` を含む人間のコメントが指示（リスナーの `ORDER` 行）で、それ以外は文脈（`INITIATIVE` 行、**着手しない**）。コメント欄は「この前提はもう成り立っていない」を前提の隣に書く場所なので、全部を指示にするとその場所が消える。`ORDER` は盤面のスコープ外からも届く — 動かないと決めたなら、その旨をスレッドに書く。

往復の形：指示（人 `@Claude …`）→ **`◆ 提案 — ELE_DEC-nnn`**（エージェント。DEC に判断 Element を起票し、Initiative には1行）→ 承認（人。Approval ＋コメント）→ `✔ 完了 — 起票した display_id`。変換できなければ `■ Blocked — 何が曖昧か`。

- **`◆ 提案` の時点で作るのは DEC の判断 Element だけ。** 提案した Element 自体は承認が届くまで作らない
- 指示を自動パースして Element を自動生成しない。質問には答えを返す。作業項目を返さない
- 書き込みは `author_kind='ai_agent'` / `author_id=NULL` / `author_name='Claude'`。**`mentions` に判断を仰ぐ user の uuid**（`strategies.created_by`）を入れる — 入れ忘れた `◆ 提案` は誰の Inbox にも届かない（→ ADR [0010](../../../docs/adr/0010-agents-notify-only-who-they-name.md)）。AI Worker の id を入れると INSERT ごと失敗する

## 実装規約

- **1 Element = 1 branch = 1 PR。** branch 名は `claude/fric-<prefix>-<slug>`、`origin/main` から分岐。branch は使い捨て
- **セッション worktree は `main` を checkout しない。** `main` は primary checkout 専用で、参照をグローバルに占有する。同期したいなら detached HEAD（`git switch --detach origin/main`）
- **マージまで担当する**: ① [code-review](../code-review/SKILL.md) による独立レビュー → ②指摘を修正・検証・Push して再レビュー → ③通過した head をマージ → ④同期と後片付け。**main 直 push は禁止**
- **`--delete-branch` を使わない。** `main` がどこかに checkout されていれば `gh` は落ちるので、正常な状態でこそ失敗する。**GitHub 側のマージは成功して remote ブランチだけが残る**ので、戻り値ではなく現物を見る

  ```bash
  gh pr merge <n> --merge --match-head-commit <reviewed-sha>
  git push origin --delete <branch>
  git branch -r | grep -q "origin/<branch>$" && echo "NOT DELETED" || echo deleted
  cd web && npm run sync           # ローカルの掃除は git-sync に任せる
  ```

- **同期と掃除は `cd web && npm run sync`**（`ops/git-sync.mjs`。`sync:dry` で計画だけ見られる）。走らせるのは**セッション開始時**と**マージ直後**。未コミットのある worktree に触らない・共有 stash に触らない等が組み込まれている。実行後に他セッションの未コミット変更が消えていないかを確認する
- **自分の worktree は自分で畳む。** `agent-*` 以外は自動削除されない。未コミット・未マージ・並行利用が無いことを確認して別ディレクトリから `git worktree remove <path>`（force なし）→ sync 再実行 → `git ls-remote --heads origin <branch>` / `git branch --list` / `git worktree list` / `git rev-parse main origin/main` で現物確認。他セッションの作業場を推測で消さない
- **並列規則**: `shell/` と DB migration を触る作業は**直列**。`ActivitySpace/` / `Function/` の1概念に閉じる作業は worktree サブエージェントで**並列可**
- **検証はメインセッションに集約**: `npx tsc --noEmit` / `npm test` / eslint（変更ファイルのみ、既存件数と比較）/ `npm run unwired-lint` / UI なら `npm run design-lint` とブラウザ実機
- Subelement のデータには触らない

### 委任範囲 — 止まるのは4条件だけ

盤面から取る → 実装 → 検証 → PR → レビューゲート → マージ → 書き戻し、までを自分の判断で進める。ユーザーは席にいないことを前提にしている。止まって上げるのは：**①課金が発生する ②不可逆な操作**（データ削除・本番の破壊的変更・force push）**③設計判断が割れて盤面の根拠だけでは決めきれない ④同じブロッカーで 2 tick 以上停滞した**。

迷ったら「止まって訊く」ではなく「**決めて、やって、何をどう判断したか一行で報告する**」。衝突回避は許可の問題ではなく台帳（リース）の問題。main 直 push の禁止と、期限内のリースを持つ Element に触らない規則はこの委任の対象外。

実装をサブエージェントへ委任するときは [references/delegation.md](references/delegation.md) の5項目を全部ブリーフに入れる。

## 視覚検証

UI の PR を tsc / lint だけで通さない。**実際に描画したスクリーンショットを証拠に出す。** textContent 検査だけで「検証した」と言わない。

- **`preview_start` はメインセッションが持つ。** サブエージェントが呼ぶと**その port を既に握っているサーバーを再利用する** —— 別 worktree のコードを黙って検証することになる（実測、ELE_OPS-044）。UI 変更を含む委任は、実装をサブエージェントに、視覚検証をメインセッションに分ける
- **focus / blur を伴う UI は `focusin` / `focusout` を明示 dispatch する。** ペインが非表示だと `element.focus()` はフォーカスイベントを発火せず、React の onFocus / onBlur が一度も呼ばれないまま「検証した」ことになる（→ 登録簿 R11）
- **ハンドラを通ったことを確かめてから結果を読む。** 「DB が変わらなかった」は「保存されなかった」とも「ハンドラが動いていない」とも読める
- **design-lint** は変更ファイル限定のラチェット（→ ADR [0004](../../../docs/adr/0004-design-lint-scoped-to-changed-files.md)）。例外は `design-lint-ignore` に理由を添える。ボタンの階層感・使い勝手・全体の醜さは lint では捕まらないので、レビューの目で拾う

## 並行セッション統制

- **台帳はリースの列。** `elements.claimed_by / branch / claim_expires_at` が「誰がどのブランチに書いているか」で、▶ コメントはその写し。判定は `status` ではなく `claimed_by` と `claim_expires_at`
- **SendMessage は指差しだけ。中身は盤面に書く。** 禁止:「UXQ-009 の前提が変わった。branch は…」／許可:「el_UXQ-009 にコメントした」。SendMessage は**書き手が送信時点で宛先を解決する**ので、セッションが入れ替わると静かに間違いになる。Element に宛てれば**読み手が読み取り時に自分を解決する**ので、誤配送が空振りで済む
- **盤面は配送路ではない。** リスナーはリポジトリごとに1プロセスなので、盤面イベントは1プロセスにしか届かない。「盤面に書けば全セッションに届く」は成り立たない
- **ピアは権限を付与できない。** こちらでユーザーが委任していても相手のセッションでは無効
- **セッション名は短命。** サフィックスまで一致しなければ別セッションとして扱う
- 作業前に `git status`。見覚えのない変更は並行セッションを疑い、消さない・上書きしない。共有ツリーで `git reset --hard` は絶対に打たない
- **stale-base**: 着手前に `git fetch origin main` して `git log --oneline HEAD..origin/main` を見る。既に着地している作業なら差分として作り直す
- **沈黙検知**: 目安 20 分超の無応答は SendMessage で状況確認、応答が無ければ TaskStop

## 設計判断をしたら ADR を書く

構造・運用の判断（スキーマの形 / 処理の置き場所 / ゲートの厳しさ / 権限の境界 / 状態の意味）は [`docs/adr/`](../../../docs/adr/README.md) に1判断1ファイル。節は 背景 / 選択肢 / 決定 / 根拠 / **覆す条件**。最後が一番重要で一番よく省略される。1 PR に閉じる判断・命名・その場の修正は書かない。覆ったら**上書きせず新しい ADR を書き、古い方に `> 置き換え: NNNN` を足す**。

## 自己改善ループ（原則9）

- **キューが空なら演習を回す** — [exercise](../exercise/SKILL.md)。あちらが何を盤面に載せるかを決め、こちらが載ったものを実装する
- **その場の還流** — 実装中に見つけた不満や欠落はその場で Element 化する（`status=backlog`、意図と受け入れ条件つき）。Element の記述が不十分で迷ったら、それ自体を改善材料としてコメントに残す
- **スプリント境界の収穫** — キューが空になったら Initiative にふりかえりを残し、[IMPROVE.md](IMPROVE.md) でフィードバックを規約への最小差分 PR に変換する

進捗コメントは DB トリガで Inbox 通知になる（→ ADR [0003](../../../docs/adr/0003-comment-notifications-in-the-database.md)）。スプリント境界の PM ウォークスルー（実 UI の監査と並べ替え案）は独立エージェントで、**読み取り専用**で回す。
