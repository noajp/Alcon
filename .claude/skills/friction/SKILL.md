---
name: friction
description: Alcon 自体を Alcon の盤面で開発する自走ループの運用規約 — 盤面から仕事を取り、実装し、PR を出し、レビューゲートを通してマージし、盤面へ書き戻すまで。自己開発ループを回すとき、盤面の Element に着手するとき、進捗を盤面へ書き戻すとき、実装をサブエージェントへ委任するときに読む。
---

Alcon を Alcon で開発する。**バックログの単一情報源は盤面（Supabase の `elements`）** — 外部の TODO リストを作らない。

**アプリ内 AI（Edge Functions: `alcon-copilot` / `run-agent` 等）はこのループでは使わない。** API コストが発生するため、ユーザーの明示指示。

配管（リスナー・停滞検知・ガバナー・イベント台帳の設定と起動）は [`ops/README.md`](../../../ops/README.md)。判断の履歴は [`docs/adr/`](../../../docs/adr/README.md)。実際に起きた事故と再発時手順は [`docs/friction-risk-register.md`](../../../docs/friction-risk-register.md)。

## 原則

規則は状況を網羅できない。初見の状況は原則で判断し、以降の節の規則は原則の派生として読む。原則から導けない規則は削除候補。フィードバックが来たら「規則が欠けたのか、原則が欠けたのか」を見極め、正しい高度に最小の差分を当てる（→ [IMPROVE.md](IMPROVE.md)）。

1. **盤面が唯一の真実。** バックログ・座標・状態・担当の台帳はすべて盤面。ファイルや記憶に第二の情報源を作らない — 二つ目は更新されないまま静かに腐り、必ず盤面と食い違う
2. **イベントが駆動し、時計は死だけを検知する。** 完了と変化は向こうから押してくる。時計で取りに行く設計は、遅いか、cron より速く暴走するかのどちらかに倒れる
3. **git は搬送路。荷が届いたら車両は消し、共有物は握らない。** ブランチは Element を main へ運ぶ使い捨ての車両であって、状態の置き場ではない。マージ後に残った remote/local ブランチ、checkout されたままの `main`、共有 stash への bare 操作は、どれも並行セッションを止める障害物になる
4. **現物で検証する。** 戻り値・成功メッセージ・自分の想定を信じない。remote から消えたか、盤面の行がどうなったか、実際に描画されたか — 変更後の実物を別経路で見る。このループの事故は全部「成功したはず」と現物のずれから始まっている
5. **決めて、動いて、事後報告する。** 逐一確認は自走を不成立にする。止まるのは4条件（課金 / 不可逆 / 割れた設計判断 / 2 tick 停滞）だけ
6. **盤面を変えるものは提案が先。** 問いを仕事に変換すると答えが常に「やる」に倒れる。`◆ 提案` を置き、承認された分だけ起票する。沈黙は承認ではない
7. **判断と事故は覆す条件つきで残す。** 未来のセッションは今の文脈を持たない。なぜ・いつ覆すかの無い規則は、検証も廃止もできない縛りとして腐る。ADR と risk register は改善ループの原料でもある
8. **言葉は置き場所で課金される。** 恒久ファイル（この規約・CLAUDE.md・スキル）は毎セッション読まれ、1行が永続コストになる。作業データ・報告・往復は盤面コメント / PR 本文 / scratchpad の一時ファイルへ。リポジトリに md を足すのは毎回読む価値のあるものだけで、稀にしか要らない手順は参照ファイルへ逃がす（段階的開示）。規約に行を足すときは、同じ重さを削れないかを先に問う
9. **実装と規約を、独立レビューで改善して届ける。** フィードバックは規約へ焼き込み、実装者とは別のエージェントが検査する。指摘修正・再検証・Push・再レビューを通過するまで回し、実装 PR も規約 PR もユーザーの Merge 承認を待たずマージする。ローカルとリモートを同期し、今回完了した worktree とブランチの削除まで確認して閉じる。

## 盤面の座標

**ID をこのファイルに書かない。** Domain / Initiative / Phase / Object の UUID は盤面の状態であってリポジトリの状態ではない。Phase はスプリントごとに作り替わり、Object は増減し、別の Supabase プロジェクトに向ければ全部が変わる。git に焼くと更新されないまま静かに腐り、盤面と食い違う第二の情報源になる — 「単一情報源は盤面」という前提そのものを壊す。接続先プロジェクトは `CLAUDE.md` の Supabase 節にある。座標は起動時に盤面から引く。

```sql
-- 自分（AI Worker）
select id, display_id from workers where type = 'ai_agent' and name = 'Claude';
-- 現在のスプリントと守備範囲
select id, name, start_date, end_date from phases order by start_date desc limit 3;
select id, prefix, name from objects order by created_at;
```

## ループの駆動

盤面が push チャネル。`elements` / `element_comments` / `element_assignees` / `strategy_comments` / `dev_events` / `dev_control` は `supabase_realtime` publication に入っており、変化は向こうから届く。**時計で取りに行かない**（→ ADR [0005](../../../docs/adr/0005-event-driven-loop.md)）。

- **① エージェント完了**（ハーネスネイティブ）＝ 本体のエンジン。サブエージェント完了で監督が再起動され、ループ周期＝仕事の完了速度になる
- **② 盤面の変化** — `ops/board-listen.mjs` を Monitor 配下で回すと1変化＝1通知。**盤面を操作すること自体が指示**になる。Initiative のコメントもここに乗る（下の「Initiative が指令所」）
- **③ リポジトリのイベント** — CI → Edge Function `dev-event` → `dev_events` → ②と同じストリームに合流。CI red と main 移動のみ通知（green は黙る）
- **時計はデッドマンスイッチのみ** — `ops/stall-check.mjs`。「仕事はあるか」ではなく「止まっていないか」。ハートビートは進捗コメント（`updated_at` は編集でも動くので死んだエージェントと区別できない）。健全時は無出力
- **ガバナー** `dev_control`（`paused` / `max_concurrent`）。イベント駆動は cron より速く暴走するので必須。ディスパッチする側が両方を尊重する義務を負う — リスナーは報告するだけで強制しない
- **受信は保持者のログの tail。** hook が起動したリスナーはリポジトリ単位のリースで1つだけ走り、stdout を捨てて自分のログ（`$TMPDIR/friction-loop-*-board-listen.log`）に書く。イベントを通知として受けたいセッションは、そのログを Monitor（persistent）で `tail -n0 -F` する。**他 worktree が持つリースを奪わない** — 殺せばそのセッションの受信が消える（→ ADR [0016](../../../docs/adr/0016-the-loop-reads-the-holders-log-and-watches-its-own-pulse.md)）
- **セッションの中の時計は自分の死活を見る。** CronCreate で 40 分前後のティックを1つ張り、「走行中エージェント無し ∧ 着手できる Element あり」のときだけ次を取る。仕事を探す時計ではなく、自分のループが途切れていないかを見る時計。7日で失効するので張り直す
- **ターンを空で終えない。** 着手できる Element が残っているのに、走行中エージェントも Monitor も無い状態でターンを閉じない。閉じてよいのは「取れる仕事が無い」「判断待ちだけが残った」「`paused`」のいずれか

**罠**: realtime の `old_record` は `REPLICA IDENTITY DEFAULT` のため主キーしか入らない。旧値との比較は必ず自前のスナップショットで行う（`old_record` と比較すると全 update が全フィールド変更として誤報告される）。

**無人稼働（セッションが閉じても回る）は scheduled task で解く。** 課金と権限（作成はユーザー自身の発話が要る）を伴うので DEC の判断を経る。承認されるまでの守備範囲は「セッションが生きている間の即応」。

## キューを取る（起動時の棚卸し / イベントが無いとき）

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

## 判断は Element — Decisions（DEC）

止まる4条件（課金 / 不可逆 / 割れた設計判断 / 2 tick 停滞）に当たったら、**Object「Decisions — 判断」に Element を1つ起票し、判断する人（`workers.user_id` を持つ human Worker）にアサインして、止まらずに次の仕事へ行く。** Initiative のコメントで判断を仰がない — 返事の無いまま沈んだ実例がある（→ ADR [0015](../../../docs/adr/0015-decisions-are-elements-assigned-to-a-person.md)）。

- `is_approval=true` / `approval_state='pending'` / `status='todo'` / `labels=['decision']`。`element_objects` と `element_assignees`（判断する人の Worker）を書き、`notifications` に `approval_requested` を1行、着手コメントの `mentions` にその人の uuid
- description は **何を決めるか / 選択肢（推奨を先頭、却下した案も）/ なぜ判断が要るか / 承認のしかた / 承認後に起きること**
- 答えは Element の Approval（approved / changes_requested / rejected）と、その Element へのコメント。**沈黙は承認ではない。** pending の間、その判断に依存しない仕事を先に消化する
- 決まったら `✔ 完了 — 何を選んだか` を書いて `done`。changes_requested は選択肢を書き直して pending に戻す

棚卸しには DEC を含める。`approval_state` が動いたのに `done` でないものが反映待ちの判断で、人間のコメントが付いたものは指示として読む。

```sql
select display_id, title, approval_state, status from elements
where object_id = (select id from objects where prefix = 'DEC')
  and status <> 'done' order by created_at;
```

## ステータス遷移

`todo` →(**リース取得** + 着手コメント)→ `in_progress` →(PR 作成 + PR リンク)→ `review` →(ゲート通過 → マージ)→ `done`（完了コメント + `progress=100` + **リース解放**）。

**着手はリースで取る。散文は記録であって取得ではない**（→ ADR [0021](../../../docs/adr/0021-the-lease-is-taken-by-rpc-not-by-prose.md)）。

```bash
node ops/lease.mjs claim <display_id> [--branch claude/fric-<prefix>-<slug>] [--note "方針1行"]
```

`claim_element()` が true を返せば `in_progress` に上げて ▶ を書く。false なら**他セッションが保持中** — `HELD` と保持者・branch・期限を出して終了コード 3 で降りる。待つか別を取るかは自分で決めるが、**取りにいかない**。保持者トークンは `node ops/lease.mjs whoami`（`Claude@<worktree名>`）。全セッションが `author_name='Claude'` で書くので、表示名は保持者になれない。

**`done` にできるのはマージ確認後のみ。** ユーザーが並走してマージすることもあるので `gh pr view <n> --json state` で確認してから落とす。

**`in_progress` は「今まさに手が動いている」ことだけを意味する。** 継続監視系の Element（スプリント計測など、branch を持たないもの）が自分のサイクルを終えてユーザー判断待ちになったら、`in_progress` に留めず `blocked` + `■ Blocked` コメントへ落とす。判断が来たら `in_progress` に戻す。理由は ADR [0007](../../../docs/adr/0007-waiting-is-blocked-not-in-progress.md) — 停滞検知は `in_progress` だけを見るので、待機を `in_progress` に置くと死亡と区別できず、盤面も嘘をつく。

## コメント報告（`element_comments`）

`author_kind='ai_agent'`、`author_id=NULL`（FK 先は `auth.users` — Worker id を入れると FK 違反）、`author_name='Claude'`、**`holder` = 自分のトークン**。

書くのは `node ops/lease.mjs comment <display_id> --text "…"`（長文は `--file`）。刻印を手で忘れる余地を残さない。

| | 書式 |
|---|---|
| 着手 | `▶ 着手 — branch: <名> / holder: <トークン> / 方針1行`（`lease.mjs claim` が書く。コードを書かない Element は `branch:` が無い） |
| 進捗 | `● 進捗 — 何をしたか / 次` |
| PR | `⬆ PR — <URL> 検証結果1行` |
| 完了 | `✔ 完了 — 結果`（`lease.mjs release --text` が書いてリースを返す） |
| 詰まり | `■ Blocked — 原因と必要な判断` |

**刻印のあるコメントがリースを延ばす**（`claim_expires_at` を TTL 満額へ）。報告する行為とリースを保つ行為は同一で、黙ったままリースは保持できない。`holder` が無い／他人のコメントは記録にはなるが延長しない。停滞検知のハートビートも同じコメントなので、時計は増えない。ユーザーへの判断依頼はコメントと会話の両方に出す。

## Initiative が指令所（`strategy_comments`）

上向き（実行の事実が Initiative に届く）の裏返し。**Initiative に書かれた意図が仕事になる経路**で、ユーザーは Initiative を見ているだけで済む。判断の根拠は ADR [0012](../../../docs/adr/0012-naming-the-agent-is-what-makes-an-order.md)。

**指示の識別 — エージェントを名指ししたコメントだけが指示。** 本文に `@Claude` を含む人間のコメントが指示で、それ以外は文脈。Initiative のコメント欄は「この前提はもう成り立っていない」を前提の隣に書くための場所なので、**全部を指示にすると、その場所が消える**。リスナーは両方を別の行として出す。

| リスナーの行 | 意味 |
|---|---|
| `ORDER    <Initiative> — <誰>: …` | 名指しあり。指示 |
| `INITIATIVE <Initiative> — <誰>: …` | 名指しなし。文脈。**着手しない** |

`ORDER` は盤面（Friction Dev）のスコープ外の Initiative からも届く。名前を打った人に沈黙を返さないため — 動かないと決めたなら、その旨をスレッドに書く。

**他チームの盤面から届いた声は [FEEDBACK.md](FEEDBACK.md)。** 妥当性の4つの問いと、「起票しない」という結末の出し方。読むのは声が届いたときだけ（原則8）。

**往復の形。**

| | 誰が | 書式 |
|---|---|---|
| 指示 | 人 | `@Claude …`（Initiative のコメント欄。記法は名指しだけ） |
| 提案 | エージェント | DEC に判断 Element を起票（本文に番号付きで1行1 Element: Object の prefix / タイトル / 意図 / 受け入れ条件）。Initiative には `◆ 提案 — ELE_DEC-nnn` の1行 |
| 承認 | 人 | その DEC Element の Approval ＋コメント。「1 と 3 を」「全部」「2 は要らない」 |
| 起票 | エージェント | `✔ 完了 — 起票した display_id`（DEC と Initiative の両方に） |
| 変換できない | エージェント | `■ Blocked — 何が曖昧か / 必要な判断` |

**規約の中身は1つだけ: 指示への反応は必ずまずコメントで、盤面を変えるものは `◆ 提案` を先に置く。**

- **`◆ 提案` の時点で書くのは DEC の判断 Element だけ。** 提案した Element 自体は承認が届くまで作らない。**沈黙は承認ではない**
- 指示を自動パースして Element を自動生成しない。**「問い」を「やること」に変換すると答えが常に「やる」に倒れる**。質問には答えを返す。作業項目を返さない
- 起票は承認された分だけ。承認されなかった案は残さず、必要ならもう一度提案する

**起動時の棚卸しに Initiative スレッドと DEC を含める。** `ORDER` はリスナーが走っている間しか届かない。セッションが切れている間に書かれた指示と、返事の来ていない判断 Element は、盤面のキューと同じように拾いに行く。

```sql
select s.name, c.author_kind, c.author_name, c.content, c.created_at
from strategy_comments c
join strategies s on s.id = c.strategy_id
order by c.created_at desc limit 20;
```

**書き込みの形。** `author_kind='ai_agent'`、`author_id=NULL`（FK 先は `auth.users`）、`author_name='Claude'`。**`mentions` に判断を仰ぐ user の uuid を入れる** — エージェントのコメントは名指しした相手にしか通知されない（ADR [0010](../../../docs/adr/0010-agents-notify-only-who-they-name.md)）ので、入れ忘れた `◆ 提案` は誰の Inbox にも届かない。uuid は `strategies.created_by` から引く。`mentions` に AI Worker の id を入れてはいけない（`notifications.recipient_id` の FK が `auth.users` を指しており、INSERT ごと失敗する）。

## 実装規約

- **1 Element = 1 branch = 1 PR。** branch 名は `claude/fric-<prefix>-<slug>`、`origin/main` から分岐。branch は使い捨て — remote は main と短命ブランチだけに保つ
- **セッション worktree は `main` を checkout しない。** マージ後に同期したくなったら detached HEAD（`git switch --detach origin/main`）か作業ブランチに居ること。`main` は primary checkout 専用
  - ローカルな選択に見えるが、実際には **`main` という参照をグローバルに占有する**。1セッションの何気ない checkout が fleet 全体の後処理を止める
  - 実測: `npm run sync` の primary checkout 復旧が `fatal: 'main' is already used by worktree at ...` で止まる。そして primary が古いブランチに居座ると、`git branch -d` が **HEAD 基準**でマージ判定するため、`origin/main` に完全に含まれるブランチまで `not fully merged` で拒否される —— ローカルブランチが溜まる本当の原因はこれ
  - **この規約は `--delete-branch` の失敗を直さない。** あちらは `main` が**どこかに** checkout されていれば起きるので、規約が要求する正常な状態（primary が main に居る）でこそ必ず起きる。対処は上のマージ手順の側
- **マージまで担当する**: ① [code-review](../code-review/SKILL.md) による独立レビュー → ②指摘を修正・検証・Push して再レビュー → ③通過した head をマージ → ④`cd web && npm run sync` と後片付け確認。実装・規約とも Merge 承認待ちは不要。**main 直 push は禁止**。
- **`--delete-branch` を使わない。** リンク worktree から走らせると**構造的に失敗する**
  ```bash
  gh pr merge <n> --merge --match-head-commit <reviewed-sha>
  git push origin --delete <branch>
  # gh の戻り値に頼らず現物を確認。取り残しの側が喋るように書く
  git branch -r | grep -q "origin/<branch>$" && echo "NOT DELETED" || echo deleted
  cd web && npm run sync           # ローカルの掃除は git-sync に任せる
  ```
  - `gh` は remote ブランチを消す前にローカルを base へ切り替えようとするので、**`main` がどこかに checkout されていれば落ちる**。握っているのがセッション worktree か primary checkout かは関係なく、**正常な状態でも落ちる**
  - **GitHub 側のマージは成功し、remote ブランチだけが残る。** PR #218 と #219 で実測、どちらも手で `git push origin --delete` した
  - 長らく成功して見えていたのは、primary checkout が feature ブランチに居座って**誰も `main` を握っていなかった**から。el_OPS-019 でそれを直したら失敗が恒常化した —— **片方のバグがもう片方を隠していた**
  - 落ちたとき `gh` が非ゼロを返すかは**未検証**。だから戻り値ではなく「remote から消えたこと」を確認する
- **同期と掃除は `cd web && npm run sync`（`ops/git-sync.mjs`）**。通常の同期・掃除はこのスクリプトに集約する。走らせるのは**セッション開始時**と**マージ直後**。`npm run sync:dry` で計画だけ見られる（どちらも `web/` から。スクリプトは `web/package.json` にある）
  - 未コミットのある worktree に触らない / checkout 中のブランチを消さない / `agent-*` worktree だけ削除 / 共有 stash に触らない、が組み込まれている
  - マージ判定は `git cherry`（パッチ同一性）。マージ直前に rebase する運用で SHA が変わるため、祖先関係では判定できない
  - 実行後に**他セッションの未コミット変更が消えていないか**を確認する
  - `agent-*` 以外の今回の作業場は自動削除されない。完了した自分の worktree に限り、未コミット・未マージ・ロック・並行利用が無いことを確認し、別ディレクトリから `git worktree remove <path>`（force なし）で削除して sync を再実行する。削除対象は今回の PR と紐づけ、他セッションの作業場を推測で消さない。
  - 最後に `git ls-remote --heads origin <branch>`、`git branch --list <branch>`、`git worktree list` で削除を、`git rev-parse main origin/main` で同期を確認する。sync は worktree 削除後にブランチが残ることがあるので、必要なら再実行する。
- **完了・Blocked でリースを返す**: `node ops/lease.mjs release <display_id> --text "✔ 完了 — …"`。返し忘れは 40 分で自然に切れるが、切れるまでの間は他セッションを待たせる
- **並列規則**: `shell/` と DB migration を触る作業は**直列**。`alcon/<concept>/` 内で閉じる作業は worktree サブエージェントで**並列可**
- **検証はメインセッションに集約**: `npx tsc --noEmit` / `npm test` / eslint（変更ファイルのみ、既存件数と比較）/ ブラウザ実機。UI 実装は design skill 経由
- Subelement のデータには触らない

### 委任範囲 — 止まるのは4条件だけ

盤面から仕事を取る → ブランチ → 実装 → 検証 → コミット → push → PR → レビューゲート → マージ → 盤面へ書き戻し、までを自分の判断で進める。「〜していいですか」と訊いて止まらない。ユーザーは席にいないことを前提にしている。逐一確認は自走ループそのものを不成立にする。

止まってユーザーに上げるのは4つ:

1. **課金が発生する時** — クラウド routine、外部サービス、新規リソース
2. **不可逆な操作** — データ削除、本番スキーマの破壊的変更、force push
3. **設計判断が割れて**盤面の根拠だけでは決めきれない時
4. **同じブロッカーで 2 tick 以上停滞した時**

迷ったら「止まって訊く」ではなく「**決めて、やって、何をどう判断したか一行で報告する**」。報告は事後でよい。並行セッションとの衝突回避は許可の問題ではなく台帳の問題で、台帳はリース（`lease.mjs claim` が取り、false なら降りる）。main 直 push の禁止と、期限内のリースを持つ Element に触らない規則はこの委任の対象外で、引き続き守る。

## DB を直に触るときの不変条件

- **Element を SQL で作るなら junction を二重に書く。** `element_objects` が無いと UI に出ず、`element_assignees` が無いとキュー取得クエリに載らない — どちらも「作ったのに存在しないのと同じ」状態を作る。作成直後に両方を SELECT で確認する
- **`display_id` は INSERT で指定してもトリガが採番し直す。** だから **`insert ... returning id` を CTE で受けて、その id で関連を張る**。`where display_id = '...'` で引き直してはいけない
  - 指定した `el_TRJ-011` が `el_TRJ-012` として採番され、直後の `where display_id in (...)` による junction / assignee の付与が丸ごと外れた実例がある（2026-08-30）。しかも `el_TRJ-011` は既存の別 Element だったので、検証クエリは「関連あり」と答えた —— **間違った行を見て正しいと判定した**
  - 罠は「junction を書き忘れる」ことではない。**指定した display_id で行を参照できないので、「INSERT してから display_id で引いて関連を張る」というパターン自体が構造的に安全でない**
- **同一ステートメント内の CTE / トリガ挿入行は外側から見えない。** 検証 SELECT は必ず別クエリで打つ
- **migration は `to_regclass` ガード必須。** PR の preview branch は空 DB に `supabase/migrations/*.sql` を replay するが、基底スキーマはそのフォルダの外にある。ガードが無いと `42P01` で `MIGRATIONS_FAILED` になる

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

## 標準ブリーフ — 実装を委任するときの必須5項目

委任プロンプトに以下を**全部**含める。欠けたまま投入したら、それは指示側の不足。

1. **作業場所** — `isolation: worktree`。冒頭で `git fetch origin main && git checkout -b claude/fric-<prefix>-<slug> origin/main`。メインチェックアウトに書かない・main に居座らない
2. **環境** — `web/node_modules` が無ければ既存 worktree から `cp -c -R`（APFS の CoW で高速）**したうえで `npm install` を必ず走らせる**。**symlink は turbopack が「filesystem root 外」として拒否する**
   - CoW コピーは高速化の手段であって、依存解決の代替ではない。**コピー元が古いと依存の欠けた木ができる。** `jsdom` と `@testing-library/react` を欠いた worktree で `npx tsc --noEmit` が **main のコードに対して TS2307 を報告**した実例がある（CI は `npm ci` なので green）。ゲート自体は正直に落ちるが、**実装エージェントは自分の環境より先にコードを疑うので「main が壊れている」と誤診する**
3. **検証** — tsc 0 / `npm test` / eslint は変更ファイルの前後比較 / UI なら `npm run design-lint` と design skill の `references/` 読了 / `npm run unwired-lint`
   - **サブエージェントは `preview_start` を使わない。ブラウザでの視覚検証はメインセッションが持つ。** `preview_start {name: "alcon-web"}` は**その port を既に握っているサーバーがあればそれを再利用する** —— どの worktree を配信していようと関係なく、`autoPort: true` でも先に port で一致する。実測（2026-09-07、ELE_OPS-044）: 自分の木に `<meta name="worktree-probe">` を仕込んだサブエージェントが `preview_start` を呼ぶと `reused: true` が返り、配信ページに probe は**0件**、サーバープロセスの cwd は**別セッションの worktree**だった。自分の木は `.next` すら作られていない
   - **これは「動かない」ではなく「黙って別のコードを検証する」。** 失敗は返らず、getComputedStyle も textContent も他人の木の答えを返す。UI 変更を含む委任は、実装をサブエージェントに、視覚検証をメインセッションに分ける
   - **新規ファイルを足したら、コミットしてから `npm run unwired-lint` を回し直す。** この検査は `git ls-files` で対象を集めるので、**untracked のファイルは1つも見えない** —— 新規ファイルの export は全部見逃され、手元は 0 件、CI は落ちる。2人の実装エージェントが同じ穴を踏んだ（PR #268 は `HOURS_BY_PRIORITY` で実際に CI FAILURE）
4. **報告書式** — PR URL・変更ファイル・検証の前後比較・迷った点（Element 記述の不足を正直に）
5. **禁止** — マージ・main 直 push・無関係ファイル・Subelement データ・`preview_start`（上記3参照）・資格情報の入力（他セッションや他タブの認証トークンを借用する行為を含む。ログインできないなら「ログイン不要の代替検証」に落とす）

### レビューから還流した条項（実装ブリーフに毎回焼き込む）

- 楽観更新には必ずロールバックを書く（保存失敗で「保存済み」の顔をさせない）
- Escape は取り消し。blur=保存の経路に合流させない（フォーカス時にスナップショット → Escape で復元）
- jsonb 等の丸ごと上書き書き込みは Promise チェーンで直列化する（到達順の逆転で新しい値が消える）
- key が同じままプロップの中身だけ変わるケース（realtime 反映）で、seed-once の state が腐らないかを設計時に問う
- 連打操作（Enter 連続）は debounce し、write / activity log / refresh をバーストさせない

## 並行セッション統制

- **台帳はリースの列。** `elements.claimed_by / branch / claim_expires_at` が「誰がどのブランチに書いているか」で、▶ コメントはその写しにすぎない。`lease.mjs claim` が両方を同時に書くので食い違わない。コードを書かない継続監視系の Element も claim する — branch は無くてよいが、保持者は要る
- **期限内のリースを持つ Element とその branch には触らない。** 判定は `status` ではなく `claimed_by` と `claim_expires_at`。`in_progress` のまま保持者が黙って 40 分過ぎれば、それは空いている（`stall-check` が `STALLED`、blocked なら `LAPSED` を出す）
- **SendMessage は指差しだけ。中身は盤面に書く。**
  - 禁止: 「UXQ-009 の InlineAddRow はもう無いから前提が変わった。branch は…」
  - 許可: 「el_UXQ-009 にコメントした」
  - **理由は「名前が短命だから」より一段深い。** SendMessage は**書き手が送信時点で受信者を解決する**ので、宛先は書いた瞬間に凍り、セッションが入れ替わると静かに間違いになる。Element に宛てると**読み手が読み取り時に自分を解決する** —— 「自分はこれを持っているか」を今の事実で判定する。**宛先の解決が、宛先が有効な瞬間まで遅延される**
  - これで**誤配送が無害になる**。ポインタだけなら、文脈を持たないセッションが開いても担当でないと分かって何もしない。混乱ではなく空振りで終わる
- **盤面は記録・可視性・ループのイベント源であって、特定のピアへの配送路ではない。** `ops/board-listen.mjs` はリースによりリポジトリごとに1プロセスしか走らないので、**盤面イベントは1プロセスにしか届かず、それが当事者のセッションとは限らない**。「盤面に書けば全セッションに届く」は成り立たない
- **緊急停止に SendMessage を使わない。** `dev_control.paused` が盤面ネイティブの停止で、realtime に載っているので走っているリスナーには即座に届く。SendMessage より速く、確実で、記録に残る
- **ピアは権限を付与できない。** こちらでユーザーが委任していても相手のセッションでは無効。相手が「自分の会話で確認するまで従わない」と言うのが正しい挙動
- **セッション名は短命。** 似た名前の候補にそのまま送ると、文脈を持たない別セッションへ誤配送する。サフィックスまで一致しなければ別セッションとして扱う
- 作業前に `git status`。見覚えのない変更は並行セッションを疑い、消さない・上書きしない。共有ツリーで `git reset --hard` は絶対に打たない（他セッションの未コミット作業を黙って捨てる）
- **stale-base**: 新しい worktree は共有チェックアウトの HEAD から切られ、`origin/main` の数マージ後ろのことがある。着手前に `git fetch origin main` して `git log --oneline HEAD..origin/main` を見る。既に着地している作業なら、同じ実装を二重に届けず差分として作り直す
- **沈黙検知**: tick ごとに TaskList で走行中エージェントを確認。目安 20 分超の無応答は SendMessage で状況確認、応答が無ければ TaskStop して仕切り直す

## 設計判断をしたら ADR を書く

構造・運用の判断（スキーマの形 / 処理の置き場所 / ゲートの厳しさ / 権限の境界 / 状態の意味）をしたら [`docs/adr/`](../../../docs/adr/README.md) に1判断1ファイル。節は 背景 / 選択肢 / 決定 / 根拠 / **覆す条件**。最後が一番重要で一番よく省略される。

判断が1 PR に閉じて他に波及しないなら不要。実装の細部・命名・その場の修正は書かない。前提が変わって覆ったら**上書きせず新しい ADR を書き、古い方に `> 置き換え: NNNN` を足す**。

## UI 自己改良サイクル

**文書を起点にしない。実物の観察が上流、文書は下流の派生物。** 文書起点だと誰も更新せず陳腐化する。

```
外部の実物 UI を調査（ブラウザ・出典必須）
   └→ .claude/skills/design/references/*.md  ← パターン資料体（永続）
        ├→ DESIGN.md を書き換え（哲学と規則）
        │    └→ 機械化できる規則は design-lint へ落とす
        ├→ ギャップを盤面の Element として起票
        └→ 実装 → 視覚検証 → マージ → 使って気づく → 次の調査対象へ
```

- **UI Researcher**: 外部の**公開** UI を実際にブラウザで見て、px・ms・キー名の粒度でパターンを `references/` に書く。出典 URL 必須、調べられなかった項目は `未検証` と明記。ログイン・資格情報入力・資産複製は禁止
- **Design Curator**: `references/` と実装の実態から `DESIGN.md` を上書き更新し、機械検査できる規則を design-lint に追加する
- **視覚検証は必須**: UI の PR は tsc / lint だけで通さない。実際に描画したスクリーンショットを証拠に出し、`DESIGN.md` と `references/` に照らして自己批評する。textContent 検査だけで「検証した」と言わない
- **ログイン不要の代替検証**（資格情報が使えない場合の最終手段）: 該当要素の className をブラウザ console で `document.createElement` → `getComputedStyle()` に通し、修正前後の計算値（border-width / style / 色）を比較する
- **design-lint** は変更ファイル限定のラチェット（→ ADR [0004](../../../docs/adr/0004-design-lint-scoped-to-changed-files.md)）。既存違反があるため全体ゲートにはしない。例外は `design-lint-ignore` コメントに理由を添えて明示
- **機械検査できない領域**（ボタンの階層感、ソートの使い勝手、全体の醜さ）は lint では捕まらない。`references/` との突き合わせとレビューの目で拾う

## 役割

- **PM（プロダクト判断）**: スプリントの開始/終了時に独立エージェントで実 UI をウォークスルーし、追加フローを監査する。並べ替え案と起票案を出す。**PM は読み取り専用**（SELECT のみ、UI での永続化操作は禁止）。適用はメインセッション
- **コードレビューゲート**: 実 PR は code-review skill。指摘の反映判断からマージまで一連
- 進捗コメントは DB トリガで Inbox 通知に変換される（→ ADR [0003](../../../docs/adr/0003-comment-notifications-in-the-database.md)）

## 自己改善ループ（原則9）

- **キューが空なら演習を回す** — 仕事を探すのではなく、Alcon で架空の作戦を実際に運用して摩擦を採る。規約は exercise スキル（[`../exercise/SKILL.md`](../exercise/SKILL.md)）。**このスキルは盤面に載ったものを実装する側で、何を載せるかはあちら側**
- **その場の還流** — 実装中・使用中に見つけた不満や欠落は**その場で Element 化**する（適切な Object、`status=backlog`、意図と受け入れ条件つき）。Element の description が不十分で迷ったら、それ自体を改善材料としてコメントに記録する（記述品質＝実行品質の検証）。キューとシグナルが自己補充される
- **スプリント境界の収穫** — キューが空になったら、ふりかえりコメントを Initiative に残して次スプリントの編成を提案するのに加え、[IMPROVE.md](IMPROVE.md) を読んで今スプリントのフィードバックを規約への最小差分 PR に変換する。手順が別ファイルなのは、スプリント境界にしか要らない言葉を毎 tick のコンテキストに載せないため（原則8）
