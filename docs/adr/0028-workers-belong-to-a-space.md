# 0028 — Workers belong to a Space; names follow the Element, assignment follows the boundary

## 背景

組織の信頼境界は ActivitySpace で、Domain・Object・Element の可視性はサーバー側のヘルパー（`user_can_see_domain` / `_object` / `_element`）で強制している。ところが Worker（担当者）だけは境界の外にあった。`workers` の RLS は「ログインしていれば全件」で、担当者ピッカーは全 Worker を並べていた。そのため、ある Space の Element に別の組織の人や AI を割り当てられ、別組織の人の名前と所属も見えていた。AI の Worker も全体で 1 つしかなく、Space ごとの指示を持てなかった。エージェントの実行（ADR 0027）は Element に割り当てられた AI Worker の `ai_config.instructions` を読むので、別の Space の AI を割り当てれば、その指示が自分の Element で動いた（ELE_QLT-090）。

Worker には 3 種類ある。アカウントに結び付いた人（`user_id`）、Object に属する Worker（`object_id`）、どちらも持たない Worker（AI と、アカウントのない人の名簿）。前の 2 つは所属から Space が決まるが、最後の 1 つには Space を表す手がかりがなかった。

## 選択肢

- Worker の Space の持ち方：Worker ごとに `activity_space_id` を必須にする／所属（`user_id` → メンバーシップ、`object_id` → Object の Space）で決め、どちらもない Worker だけ列で決める／Space × Worker の junction を作る
- 名前の見え方：割り当てられる Worker の名前だけを見せる／割り当てと表示を分け、見える Element や Object にすでに付いている Worker の名前も見せる
- 強制の場所：クライアントのピッカーで絞る／DB の RPC で判定し、ピッカーとボードツールが同じ RPC を読む
- 移行：RLS を一度に締める／先に読み取り口（RPC）と所属を足し、利用側を移してから RLS を締める

## 決定

- **Worker の Space は所属で決める。** `user_id` があれば、その人の Space メンバー・Domain メンバー・Object メンバーの所属。なければ `object_id` の Object の Space。どちらもない Worker だけ `workers.activity_space_id`（`on delete set null`）で決める。CHECK 制約は置かない。
- **割り当ては境界に従う。** `worker_assignable(worker, element)` が真になるのは次のすべてを満たすとき：呼び出した人が Element を見られる。その Worker を一覧できる。Worker が inactive でない。Element の Space（主 Object の Domain の Space）があれば Worker がその Space に属する。人の Worker なら、その人自身も Element を見られる。担当者の候補は `list_assignable_workers(space, domain, element)` で取り、アプリのピッカー、テンプレート、MCP / Copilot のボードツール、エージェントの Worker 選択がすべてこれを通る。
- **名前は Element に付いてくる。** 割り当てられない Worker でも、見える Element や Object にすでに付いていれば名前を表示する。Assignee は `element.assignees`、Lead や Person 型の Property は id で引いて表示する。
- **Space ごとに AI を置く。** 各 Space に ai_agent の Worker「Claude」を 1 つ置き、新しい Space には作成時のトリガで作る。エージェントは、Element に割り当てられる AI Worker のプロファイルだけを読み、それ以外は既定のエージェントとして動く。
- **メンバーになると自分の Worker ができる。** Space・Domain・Object のメンバーになったとき、DB のトリガがその人の human Worker を用意する。アプリが他人の Worker 行を作ることはない。
- **段階的に締める。** 先に列・ヘルパー・RPC・トリガを足し、利用側をすべて RPC に移す。その後で `workers` / `element_assignees` / `agent_runs` の RLS と通知関数を締め、表示の規則（見える Element・Object に付いた Worker の名前は見える）を SELECT ポリシーにする。
- 既存の、所属を持たない Worker は、割り当てと Lead がすべて 1 つの Space にあるときだけ、その Space に寄せる。複数の Space にまたがる、またはどこにも付いていない Worker は NULL のままにする。どの Space のピッカーにも出なくなるが、すでに付いている Element では名前が見える。

## 根拠

全 Worker に `activity_space_id` を必須にすると、人の Worker は「どの Space に属するか」を所属と列の 2 か所で持つことになり、招待や脱退のたびに食い違う。人は複数の Space に属しうるので、1 列では表せない。junction は表せるが、所属テーブルとの二重管理になる。所属から導けるものは導き、導けない Worker だけ列に持たせるのが、真実を 1 か所に保つ形になる。

割り当てと表示を同じ規則にすると、Space を出た人や、所属のない名簿の人が担当している既存の Element で、担当者が空欄になる。過去の記録は残すべき事実で、「今後割り当てられるか」とは別の問いになる。

クライアントだけで絞ると、MCP やエージェントのような別の入口が同じ判定を書き直すことになり、1 か所の漏れが境界の穴になる。判定を DB の SECURITY DEFINER 関数 1 つにまとめれば、どの入口も同じ答えを読む。「別の人として見えるか」の判定（`*_as`）は、本物の可視性ヘルパーを `auth.uid()` だけ差し替えて写し取り、本番の全 Element で元の関数と一致することを確かめた。`auth.uid()` を `set_config` で偽装する方法は、呼び出し中の権限を書き換えるので採らない。

RLS を一度に締めると、まだ全件読み取りに頼っている画面（名前の解決、Team の名簿、通知）が一斉に空になる。先に読み取り口を足して利用側を移せば、締める段階では漏れている読み取りだけが残る。

## 覆す条件

- 1 人が多数の Space に属し、`worker_in_space` の所属の判定（Space・Domain・Object メンバーのどれか）が一覧の速度で問題になったら、所属を集計した表かマテリアライズドビューを持つ
- 所属のない名簿の人を複数の Space で使い回す要望が実際に出たら、`activity_space_id` を junction にする
- inactive の Worker も割り当てたい場面（過去の作業の付け直しなど）が出たら、inactive を割り当ての条件から外し、ピッカーの表示だけで区別する
- Domain に招かれただけの人（Guest）を、その Domain 以外の同じ Space の Element に割り当てたいという要望が出たら、`worker_in_space` を Space 単位ではなく Domain 単位に狭めるか広げるかを決め直す（今は、Space 内のどの Domain のメンバーでも Space に属するとみなし、最後に「その人が Element を見られるか」で絞っている）
- Space ごとの AI が 1 つでは足りず、役割の違う複数の AI を置くようになったら、AI の作成をトリガではなく Space の設定から行う
