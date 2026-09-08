# 0017. Campaign の Object 集合は junction にだけ置く

2026-09-03 / el_QLT-009

## 背景

Campaign（`strategies`）が束ねる Object の集合は、2つの場所に書かれていた。`strategy_objects` junction と、`strategies.scope` jsonb の `object_ids` キーである。

`useStrategies` は junction しか読まない。だから事実上の情報源は junction だった。しかし `scope.object_ids` を持つ行は残っており、2026-08-31 に作られた Campaign は両方を持っていた（内容は一致していた）。二重書きは、両者が一致している間は症状が無い。**食い違った瞬間に、どちらも信用できなくなる** —— 読む側が junction を見ているのに、書いた側が scope だけを更新していれば、画面は古いままで、直そうにもどちらが正なのか判断する材料が無い。

リポジトリ内のコードには `scope.object_ids` を書く経路がもう無かった。初期の `hooks/useStrategies.ts` にあった `setScope({ object_ids })` は Strategy shell への置き換えで消え、以後の `createStrategy` / `setStrategyObjects` は junction にしか書かない。残っていたのは `StrategyScope` 型の `object_ids?: string[]` フィールドと、DB 上の既存行、そしてリポジトリ外からの手書き SQL（演習の Campaign を種まきする経路）である。型にフィールドが残っている限り、「ここに書いてもよい」と読めてしまう。

## 選択肢

1. **junction を単一情報源にする。** `scope.object_ids` は書かず、読まず、型からも消す
2. `scope.object_ids` を単一情報源にする。junction を廃止する
3. 両方を保ち、書き込み時に同期させる（トリガか、書き込み経路の規約で）

## 決定

1。`strategy_objects` が Campaign の Object 集合の唯一の置き場。`scope.object_ids` はどのコードも書かず、どのコードも読まない。`StrategyScope` 型からフィールドを消す。

Object 集合を組み立てる経路は `ActivitySpace/strategy/initiative/initiativeObjects.ts` の `assembleStrategies` に1本化し、`web/tests/initiativeObjects.test.ts` が「scope に古い `object_ids` が残っていて junction と食い違っていても、junction だけが採られる」ことを縛る。

既存行の `scope.object_ids` は消さない。前方互換のみ —— 読まれないキーが残っているだけで害は無く、消すための migration は「既存テーブルに触る migration」の負担（`to_regclass` ガード、preview replay）に見合わない。

`scope.domain_ids` / `filter` / `display` はこの判断の対象外。Domain のヒントと保存ビューは Object 集合とは別の関心事で、そのまま残す。

## 根拠

junction が正であるべき理由は、**集合が関係だから**である。Object は複数の Campaign に属せる。「この Object はどの Campaign に入っているか」という逆引きは、Object のレール（`ObjectPropertiesWidget`、`CampaignIntentWidget`）が常に必要としている。junction ならこれは `object_id` の等価検索で済み、インデックスも RLS も張れる。jsonb 配列に入れると逆引きは `@>` の全件走査になり、RLS は「配列のどこかに自分の見える Object が含まれるか」を jsonb 演算で書くことになる。Campaign の境界可視性（migration 20260902140000）は既に `strategy_objects` を足場にしており、選択肢2はこれを作り直すことになる。

選択肢3を捨てたのは、**同期は二重書きを固定化するだけ**だからである。トリガで同期すれば「食い違わない」は保証できるが、2つ目の置き場が存在する理由が「もう1つあるから」以外に無い。同期のコストを払って得るものが無い。

型からフィールドを消すのは、コードの経路を消すだけでは足りないからである。今回、コードの書き込み経路は既に無くなっていたのに、両方を持つ行が生まれた。型に `object_ids` が残っていれば、次に Campaign を作る経路（UI でも SQL でも）が「型にあるから」と埋める。**書けない形にして初めて、書かれない。**

## 覆す条件

- Campaign の中で Object の並び順を持ちたくなったとき。junction の行には順序が無く、`created_at` 順しか出せない。Campaign ごとに Object を手で並べ替える要求が出れば、junction に `order_index` を足すか、順序付きの配列（= scope 側の形）を検討し直す合図
- Campaign が Object を持たずに Domain 単位のスコープを持ちたくなったとき。現在 `scope.domain_ids` は Domain のヒントであって、Campaign の「中身」ではない。「この Domain の全 Object を（明示的に列挙せず）束ねる Campaign」が要るなら、Object 集合が「列挙」から「条件」に変わり、junction では表せない
- Campaign の Object 集合に Object 以外（Element や Phase）が混ざるようになったとき。junction は `strategy_id × object_id` の形しか持てない
