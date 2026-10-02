# 0028 — Workers belong to a Space; names follow the Element, assignment follows the boundary

## 背景

組織の信頼境界は ActivitySpace で、Domain・Object・Element の可視性はサーバー側のヘルパー（`user_can_see_domain` / `_object` / `_element`）で強制している。ところが Worker（担当者）だけは境界の外にあった。`workers` の RLS は「ログインしていれば全件」で、担当者ピッカーは全 Worker を並べていた。そのため、ある Space の Element に別の組織の人や AI を割り当てられ、別組織の人の名前と所属も見えていた。AI の Worker も全体で 1 つしかなく、Space ごとの指示を持てなかった。エージェントの実行（ADR 0027）は Element に割り当てられた AI Worker の `ai_config.instructions` を読むので、別の Space の AI を割り当てれば、その指示が自分の Element で動いた（ELE_QLT-090）。

Worker には 3 種類ある。アカウントに結び付いた人（`user_id`）、Object に属する Worker（`object_id`）、どちらも持たない Worker（AI と、アカウントのない人の名簿）。前の 2 つは所属から Space が決まるが、最後の 1 つには Space を表す手がかりがなかった。

## 選択肢

- Worker の Space の持ち方：Worker ごとに `activity_space_id` を必須にする／所属（`object_id` → Object の Space、`user_id` → メンバーシップ）で決め、どちらもない Worker だけ列で決める／Space × Worker の junction を作る
- 名前の見え方：割り当てられる Worker の名前だけを見せる／割り当てと表示を分け、見える Element や Object にすでに付いている Worker の名前も見せる
- 強制の場所：クライアントのピッカーで絞る／DB の RPC で判定し、ピッカーとボードツールが同じ RPC を読む
- Worker の変更権限：ログインしていれば誰でも／Worker の種類ごとに、その Worker の範囲にいる人だけ
- 通知：割り当てや所有をそのまま宛先にする／宛先ごとに Element を見られるかで絞る

## 決定

- **Worker の Space は所属で決める。** `object_id` があれば、その Object の Space。アカウントに接続された Object の Worker も同じで、その Object の中の、その人の顔（ペルソナ）として扱う。`object_id` がなく `user_id` があれば、その人の Space メンバー・Domain メンバー・Object メンバーの所属。どちらもない Worker だけ `workers.activity_space_id`（`on delete set null`）で決める。一覧できるかどうか（`user_can_list_worker`）も同じ順で、Object の Worker はその Object を見られる人が一覧できる。CHECK 制約は置かない。
- **割り当ては境界に従う。** `worker_assignable(worker, element)` が真になるのは次のすべてを満たすとき：呼び出した人が Element を見られる。その Worker を一覧できる。Worker が inactive でない（自分自身を割り当てる場合は inactive でもよい）。Element の Space（主 Object の Domain の Space）があれば Worker がその Space に属する。人の Worker なら、その人自身も Element を見られる。担当者の候補は `list_assignable_workers(space, domain, element)` で取り、アプリのピッカー、テンプレート、MCP / Copilot のボードツール、エージェントの Worker 選択がすべてこれを通る。
- **名前は Element に付いてくる。** 割り当てられない Worker でも、見える Element や Object にすでに付いていれば名前を表示する。Assignee は `element.assignees`、Lead や Person 型の Property は id で引いて表示する。
- **Space ごとに AI を置く。** 各 Space に ai_agent の Worker「Claude」を 1 つ置き、新しい Space には作成時のトリガで作る。エージェントは、Element に割り当てられる AI Worker のプロファイルだけを読み、それ以外は既定のエージェントとして動く。
- **メンバーになると自分の Worker ができる。** Space・Domain・Object のメンバーになったとき、DB のトリガがその人の human Worker を用意する。アプリが他人の Worker 行を作ることはない。
- **RLS で強制する。** `workers` を読めるのは、自分の Worker、一覧できる Worker（`user_can_list_worker`）、見える Element にすでに付いている担当者、そして見える Object の Lead と見える Element の Person 型の値のうち、その Object・Element と同じ Space に属する Worker。Lead と Person 値は誰でも書ける列なので、別の組織の Worker を指しても名前は見えない。`element_assignees` は見える Element の行だけを読み・消せ、追加と変更は `worker_assignable` が通すものだけ。`agent_runs` を作るときに指定できる Worker も `worker_assignable` が通すものだけ。取り込み（`import_existing_work`）も担当者を同じ関数で確かめる。
- **Worker を変えられる人は Worker の種類で決まる。** 本人。所属のない Worker ならその Space のメンバー。Object の Worker ならその Object を見られる人。他人の Worker なら、その人が属する Space か Domain のオーナー（`user_can_manage_worker`）。UPDATE は変更前と変更後の両方でこの条件を満たす必要があり、変えられる列はトリガが決める。
  - Worker の種類（human / ai_agent）と識別子は誰も変えられない。
  - 人の Worker（`user_id` あり）は、アカウントから外すことも別のアカウントへ付け替えることも、Space や Object へ移すこともできない。名前・アバター・役割・メールなどを変えられるのは本人だけで、オーナーが変えられるのは通常稼働時間（`capacity_hours_per_day`）と状態（active / inactive）だけ。
  - アカウントへの接続（Team 設定の Connect）は、アカウントのない human の Object Worker だけを、その Object の Space か Domain のオーナーが、その Space にいる人へ結ぶ。Space の名簿にある所属のない Worker は接続しない。どのアカウントにも自分の human Worker がすでにあり、1 アカウント 1 つの制約に必ずかかるため。接続した Worker もその Object の Worker のままで、その人の他の Space のピッカーや名簿には出ない。
  - Worker を別の Space・Object へ移せるのは、移動先の Space のメンバーか Object を見られる人だけ。
  - 新しく作れるのは、自分の human Worker、自分が属する Space の所属のない Worker、見える Object の Worker。
  - 削除できるのは所属のない Worker だけで、その Space のオーナーが行う。人の Worker はアカウントから外せないので、削除の対象にならない。人がチームを離れるときはメンバーシップを外し、Worker を inactive にする。
- **残るリスク：同意のない所属。** Space を作った人は、相手の同意なく任意のアカウントを Space のメンバーに加えられる。その Space のオーナーは、加えた人の Worker の通常稼働時間と状態を変えられる。Worker は 1 人に 1 つなので、inactive にすると他の Space のピッカーからもその人が消える（本人と、本来の Space のオーナーは戻せる）。名前・種類・AI の指示・アカウントの結び付き・削除には届かない。同じ方法で自分の Object の Worker をその人のアカウントに接続することもできるが、その Worker は攻撃者の Object の中にしか現れず、その人の他の組織のピッカー・名簿・割り当てには入らない（その人自身の一覧には自分の Worker として見える）。所属の承認（招待を受けた本人が承諾する）を持つまで、この範囲のリスクは残す。
- **通知は Element を見られる人にだけ届く。** 状態変更・コメント・メンション・期日の通知は、宛先ごとに `user_can_see_element_as` で絞る。境界より前に別の Space の人へ付いた担当は残っていても、その人に Element の通知は届かない。
- 既存の、所属を持たない Worker は、割り当てと Lead がすべて 1 つの Space にあるときだけ、その Space に寄せる。複数の Space にまたがる、またはどこにも付いていない Worker は NULL のままにする。どの Space のピッカーにも出なくなるが、すでに付いている Element では名前が見える。

## 根拠

全 Worker に `activity_space_id` を必須にすると、人の Worker は「どの Space に属するか」を所属と列の 2 か所で持つことになり、招待や脱退のたびに食い違う。人は複数の Space に属しうるので、1 列では表せない。junction は表せるが、所属テーブルとの二重管理になる。所属から導けるものは導き、導けない Worker だけ列に持たせるのが、真実を 1 か所に保つ形になる。

割り当てと表示を同じ規則にすると、Space を出た人や、所属のない名簿の人が担当している既存の Element で、担当者が空欄になる。過去の記録は残すべき事実で、「今後割り当てられるか」とは別の問いになる。

クライアントだけで絞ると、MCP やエージェントのような別の入口が同じ判定を書き直すことになり、1 か所の漏れが境界の穴になる。判定を DB の SECURITY DEFINER 関数 1 つにまとめれば、どの入口も同じ答えを読む。「別の人として見えるか」の判定（`*_as`）は、本物の可視性ヘルパーを `auth.uid()` だけ差し替えて写し取り、本番の全 Element で元の関数と一致することを確かめた。`auth.uid()` を `set_config` で偽装する方法は、呼び出し中の権限を書き換えるので採らない。

表示の規則を割り当ての規則と分けて SELECT ポリシーにしたのは、名前の解決・Team の名簿・Workload が `workers` を直接読むから。割り当てられる範囲だけを見せると、過去の担当者・Lead が空欄になる。

人の Worker の変更をオーナーには稼働時間と状態だけに絞るのは、オーナーであることの根拠になる所属を、相手の同意なしに作れるから。名前や種類、AI の指示、アカウントの結び付きまで任せると、他の組織の人の Worker を AI に変えて指示を仕込んだり、アカウントから外して担当ごと削除したりできてしまう。

UPDATE の WITH CHECK は Worker を id で引き直さず、新しい行の列（`user_id` / `object_id` / `activity_space_id`）で判定する。WITH CHECK の中で id から表を読むと変更前の行が返り、付け替え先を検査できないため。SELECT ポリシーも同じ理由で、所属のない Worker と Object の Worker は行の列で判定し、INSERT … RETURNING が自分の書いた行を読めるようにしている。

通知の宛先を割り当てから絞るだけにすると、境界より前の担当や、見えなくなった Object の担当者・コメント参加者に Element の題名と本文が届く。宛先ごとに可視性を確かめれば、古い割り当てを消さずに漏れを止められる。

## 覆す条件

- 1 人が多数の Space に属し、`worker_in_space` の所属の判定（Space・Domain・Object メンバーのどれか）が一覧の速度で問題になったら、所属を集計した表かマテリアライズドビューを持つ
- 所属のない名簿の人を複数の Space で使い回す要望が実際に出たら、`activity_space_id` を junction にする
- inactive の Worker も割り当てたい場面（過去の作業の付け直しなど）が出たら、inactive を割り当ての条件から外し、ピッカーの表示だけで区別する
- Domain に招かれただけの人（Guest）を、その Domain 以外の同じ Space の Element に割り当てたいという要望が出たら、`worker_in_space` を Space 単位ではなく Domain 単位に狭めるか広げるかを決め直す（今は、Space 内のどの Domain のメンバーでも Space に属するとみなし、最後に「その人が Element を見られるか」で絞っている）
- Space ごとの AI が 1 つでは足りず、役割の違う複数の AI を置くようになったら、AI の作成をトリガではなく Space の設定から行う
- 所属の承認（招待を受けた本人の承諾）を持ったら、オーナーが人の Worker の稼働時間と状態を変えられる条件を、承認済みの所属に限る
- Domain のオーナーにも所属のない Worker の削除を任せたい、あるいは Space の名簿の Worker をアカウントへ統合したいという要望が出たら、DELETE の条件と、2 つの Worker の履歴をまとめる手順を決め直す
