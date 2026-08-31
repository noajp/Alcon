# IMPROVE — 規約を改善する観察工程

[SKILL.md](SKILL.md)（基本スキル）はドメインの手続きを知っている。この工程は**基本スキルがどこで現実と食い違ったか**だけを見る。読むのはスプリント境界（キューが空になったとき）とユーザーが求めたときのみ。定期 cron を作らない（原則2）。

成果物は**規約への最小差分 PR**。収穫・分析の作業データは scratchpad の一時ファイルに置き、リポジトリにコミットしない（原則8）。

## 収穫 — 今スプリントの窓で5系統

窓は盤面から引く：

```sql
select id, name, start_date, end_date from phases order by start_date desc limit 1;
```

1. **実 PR への人間の指摘** — エージェントの出力に人間がどう反応したか

```bash
gh pr list --state merged --search "merged:>=<start_date>" --json number,title
gh pr view <n> --json reviews,comments
gh api repos/{owner}/{repo}/pulls/<n>/comments --paginate   # インライン指摘
```

2. **詰まりと迷い** — ループが止まった場所と理由

```sql
select e.display_id, c.content, c.created_at
from element_comments c join elements e on e.id = c.element_id
where c.created_at >= '<start_date>' and c.content like '■%'
order by c.created_at;
```

3. **提案と応答** — スレッド順で読む。承認の来なかった `◆ 提案` と明示的な否認

```sql
select s.name, c.author_kind, c.author_name, c.content, c.created_at
from strategy_comments c join strategies s on s.id = c.strategy_id
where c.created_at >= '<start_date>'
order by s.id, c.created_at;
```

4. **リポジトリ側イベント** — CI red・停滞検知の発火

```sql
select kind, ref, title, created_at from dev_events
where created_at >= '<start_date>' order by created_at;
```

5. **事故登録簿の新規エントリ**

```bash
git log --since='<start_date>' --oneline -- docs/friction-risk-register.md
```

## 分類と検証 — フィードバックを盲信しない

各シグナルを分類する：**事故**（リカバリ手順が生まれた）/ **修正**（人間が出力を直した・刺した）/ **否認**（提案が承認されなかった）/ **摩擦**（Blocked・迷い・二度手間）。

焼き込む前に3つの検証を通す：

- **再発性** — 1回きりの文脈依存を全域規則にしない。初出のシグナルはコメント・risk register に留め、2回目が来たら規約に上げるのが既定。既に2回以上再演している事故は最優先
- **現物照合** — フィードバックが前提にしている状態が今も真か、盤面とコードで確かめる。フィードバック自体が間違っている・古いことを想定する（原則4）
- **高度判定** — 既存の原則から導けるなら派生規則を1行足すだけ。どの原則からも導けないなら、欠けているのは原則の側 — その追加・修正は影響が広いので単独 PR にする

## 出力 — 最小差分 PR の規約

- 1 PR = 1 関心事。宛先は SKILL.md / design の references / CLAUDE.md のいずれか
- 規則には理由を併記し、どの原則の派生かが読めるように書く。網羅列挙より「何を探すか」の指針
- **サイズはラチェット**（原則8）。行を足すときは同じ重さを削れないか先に問う。同型の規則が並び始めたら原則への圧縮を提案する — 原則は規則の圧縮形
- PR 本文に、変更を促したシグナル（PR 番号・コメント・事故）を列挙する。ファイル本体には履歴を書かない（改訂の作法）
- **自己マージ禁止**（原則9）。ゲートまで通し、ユーザー承認がループを閉じる
- 焼き込まないもの：マシン固有の事情（→ メモリ）、盤面の状態・ID、一度きりの修正、コードで直せるもの（→ Element 起票か design-lint 規則化）

## 改善しているかの計測

スプリントをまたいで比較し、ふりかえりコメントに数字で残す。悪化はこの工程自身への差し戻し材料：

- `■ Blocked` の件数と、同一原因の再発
- 実 PR 1件あたりのレビュー指摘数（ゲートで刺された数）
- 登録済み事故の再演数 — 再演は規約が機能していない証拠
- 規約差分 PR の否認率 — 高いなら収穫か検証が緩い
