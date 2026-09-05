# 0015. 判断は Campaign のコメントではなく、人にアサインされた Element で求める

2026-09-03 / ELE_DEC-001〜003

## 背景

friction の規約は、止まる4条件（課金 / 不可逆 / 割れた設計判断 / 2 tick 停滞）に当たったとき、Campaign のコメントに `■ 判断依頼` や `◆ 提案` を書き、`mentions` で通知して待つ形だった。

これは一度失敗している。2026-09-01 に書いた migration 適用の依頼は、2日間返事が無いまま Campaign のスレッドに沈んだ。原因は文面ではなく置き場所にある。Campaign のコメントは Inbox に1回流れて終わり、**「誰の仕事か」がどこにも書かれない**。担当も期限も状態も持たないので、ユーザーの My Elements に出ず、未回答のまま溜まっていることが盤面のどこにも現れない。

同日、ユーザーから「承認が要るものは Element として起票し、自分にアサインしてほしい」という指示があった。

## 選択肢

1. 現状維持 — Campaign のコメントで判断を仰ぐ
2. 判断を Element にする — Object「Decisions」に起票し、`is_approval` を有効にして、判断する人の Worker にアサインする
3. 判断専用のテーブルと UI を作る

## 決定

2。Object「Decisions — 判断」（prefix `DEC`）に 1 判断 = 1 Element で起票し、`is_approval=true` / `approval_state='pending'` で、判断する人の Worker にアサインする。答えは Element の Approval（approved / changes_requested / rejected）と、その Element へのコメント。決まるまでループはその判断に依存しない仕事を先に消化する。Campaign への `◆ 提案` も同じ形にし、Campaign のスレッドには DEC の display_id を指すだけの1行を残す。

## 根拠

- Element は担当・状態・期限・承認ワークフローを**既に**持つ唯一の単位。`is_approval` / `element_approvals` / `approval_requested` 通知は 2026-05 から存在していて、使われていなかった。3 はその再発明になる
- 判断を Element にすると、盤面が唯一の真実（原則1）のまま、My Elements と Inbox の両方に乗り、`approval_state` の遷移がイベントとしてリスナーに届く（原則2）。回答待ちの数も溜まり具合も、Element を数えれば分かる
- 1 は失敗の実例が既にあり、失敗が沈黙として現れる形（返事が来ないことに誰も気づかない）なので、繰り返す理由が無い
- 「判断」を Execution 層の単位に置くことは概念モデルと矛盾しない。判断は人に投入される仕事であり、Strategy 層に置くべき「意図」ではない。判断の**根拠**（なぜその選択肢か）は Campaign の description と Decisions 面に残り、**行為**が Element になる

## 覆す条件

- DEC の pending が溜まり続けて approve されないなら、判断の粒度か頻度が間違っている。止まる4条件そのものを見直す
- `approval_state` の遷移がリスナーに届かないと実測されたら（realtime の取りこぼし）、棚卸しクエリの側で拾う設計に寄せる
- 判断する人が複数になったら、誰にアサインするかの規則が要る。今は1人なので不要
