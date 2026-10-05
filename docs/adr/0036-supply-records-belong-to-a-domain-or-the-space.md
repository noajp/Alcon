# 0036 — Supply records belong to a Domain or to the Space

## 背景

SCM の行（拠点・仕入先・品目・在庫・台帳・発注）は Space に属し、Space のメンバー全員が読み書きしていた（[ADR 0031](0031-scm-owns-its-ledger-and-acts-within-a-policy.md)）。一方 Execution は Domain の公開範囲で閉じる。Private Domain の Object と Element は Domain のメンバーにしか見えない。

演習（物流会社・IT 会社・特殊作戦を 1 つの Space で運用）では、Private にした特殊作戦の隠し倉庫・仲介者・装備が、物流会社の段ボールと同じ一覧に並び、Space の全員が見て編集できた。行動は隠れるのに、その行動を支える物資は隠れない。部隊・病棟・店舗のように、物資を持つのは組織の中の単位であり、Space ではない。

ELE_DEC-013 で、SCM を Execution の需要に資源を供給する仕組みとしてつなぎ直すと決めた。その第 1 段階として、物資の持ち主を Domain にする。

## 選択肢

- 境界の単位：Space のまま（見せ方だけ Domain で絞る）／Domain ごとに別の SCM（方針・番号・台帳も Domain ごと）／記録ごとに Domain を選べ、無ければ Space で共有
- 可視性の決め方：SCM 専用の権限表／Domain の可視性（`user_can_see_domain`）をそのまま使う
- 混在の扱い：1 つの記録が複数の Domain の物を含んでもよい（見える人は全部を見られる人に限る）／1 つの記録は高々 1 つの Domain

## 決定

- **拠点・仕入先・品目は任意で 1 つの Domain に属する**（`domain_id`、同じ Space の Domain に限る）。無ければ Space で共有する。Domain に属する記録は、その Domain を見られる人だけが読み書きする。
- **在庫・台帳・発注・発注明細は参照先で見える。** 名指す拠点・品目・仕入先（明細なら発注と品目）がすべて見える人にだけ見える。判定は definer の小さな関数（`scm_location_visible` ほか）で、RLS から呼ぶ。
- **1 つの記録は Domain を混ぜない。** Domain の品目は同じ Domain の拠点にだけ置き・動かし・発注する。Domain の仕入先は同じ Domain の拠点にだけ納め、同じ Domain の品目の既定の仕入先にだけなれる。Space で共有の品目・仕入先はどの拠点にも使える。トリガ（`scm_check_scope`）が書き込みと Domain の付け替えを、見えない行も含めて確かめる。
- **Domain は物資を残したまま消えず、別の Space へ移らない。** Space ごと消すときは一緒に消える。
- **方針・発注番号・月次予算は Space に 1 つ。** 発注番号は見えない Domain の発注も数えて振り（definer のトリガ）、予算は今月の確定済み支出を Domain をまたいで合計して判定する（`scm_committed_spend`。返すのは合計だけ）。日次のオートパイロットは範囲（Space で共有の拠点、または Domain ごと）ごとに 1 回で、見えない Domain の分を他の人が使い切らない。リセットは見えない記録があると拒む（外部キーのカスケードは RLS を通らないため）。
- **画面は範囲で絞る。** SCM のサイドバーで「すべて／Space で共有／各 Domain」を選ぶと、全ペインがその範囲の拠点と、それに使える共有の品目・仕入先を示す。新しい記録はその範囲の Domain に入る。Domain の Overview には供給のウィジェット（充足率・拠点数・発注残・欠品リスク）が出る。

## 根拠

境界を 2 つ持つと、どちらが正しいかを利用者が覚えることになる。Domain の公開範囲は Execution で既に使われ、招待・承諾・Private の意味が揃っている。SCM が同じ関数で判定すれば、Domain を Private にした瞬間に物資も隠れ、メンバーを外せば物資も見えなくなる。

Domain ごとに別の SCM にすると、Space 共通の資材（段ボール・燃料・共通の仕入先）を Domain の数だけ複製することになり、拠点間の移動や Space の予算が成り立たない。記録ごとに選べ、無ければ共有、が両方を満たす。

1 つの記録に複数の Domain を混ぜると、見えるのは両方を見られる人だけになり、片方の Domain の責任者から自分の発注が消える。混ぜないと決めれば、発注・在庫の 1 行が必ず 1 つの持ち主に属し、③で承認を Domain の責任者へ上げる先も一意に決まる。

## 覆す条件

- **Domain ごとに方針（サービス水準・予算・自動承認の上限）が要る** → `scm_policies` に Domain の行を足し、計画はその範囲の方針を使う（③④で再検討）。
- **Domain のゲスト（Space 非メンバー）にも物資を見せたい** → 可視判定から Space メンバーの条件を外し、`user_can_see_domain` だけにする。今は Space メンバーに限る。
- **同じ SKU を Domain ごとに別の品目として持ちたい** → `(activity_space_id, sku)` の一意を `(activity_space_id, domain_id, sku)` に変える。今は Space で 1 つで、見えない Domain の SKU と重なると登録が拒まれる。
