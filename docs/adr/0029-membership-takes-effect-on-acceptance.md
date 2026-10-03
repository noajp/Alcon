# 0029 — Membership takes effect on acceptance

## 背景

Space・Domain・Object の所属（`activity_space_members` / `domain_members` / `object_members`）は、可視性・Worker の Space（ADR 0028）・担当の割り当て・オーナーによる稼働の調整のすべての根拠になる。ところが所属の行は、招く側がそのまま書いていた。Space のオーナー、Domain のオーナー・admin、Object の Domain のオーナー・admin は、相手の同意なく任意のアカウントをメンバーにでき、メンバーになった瞬間にその人の Worker がその Space に入り、オーナーはその人の稼働時間・状態・不在の予定を変えられた。

同じ INSERT ポリシーには、さらに 2 つの穴があった。`domain_members` と `object_members` は `user_id = auth.uid()` なら役割も対象も問わずに通したので、UUID を知っていれば誰でも他人の Domain や Object に owner として入れた。`activity_space_members` の UPDATE はオーナーに `user_id` の書き換えを許していたので、自分の行を他人の所属に変えられた。

## 選択肢

- 招待の持ち方：所属の表に `status`（pending / active）を足す／招待を別の表に置く
- 招待の書き込み：ブラウザが RLS の範囲で書く／SECURITY DEFINER の RPC だけが書く
- 承諾の経路：承諾で所属の行を作る RPC／招待の行を承諾済みに変えると、トリガが所属の行を作る
- 招待の届け方：通知だけ／通知と、Profile・初回画面の一覧

## 決定

- **招待は `membership_invitations` に置く。** 所属の表は「参加している人」だけを表す。行は Space・Domain・Object のどれか 1 つを指し、招かれた人・招いた人・招いた時点の名前（`scope_name` / `inviter_name`）・状態（pending / accepted / declined / canceled）を持つ。同じ人への同じ対象の保留中の招待は 1 つだけ。
- **書き込みは RPC だけが行う。** ブラウザに INSERT / UPDATE / DELETE の権限はない。
  - `invite_member(scope, id, user)`：その対象を管理する人（Space のオーナー、Domain のオーナー・admin、Object の Domain のオーナー・admin）だけが呼べる。自分自身、すでにメンバーの人、保留中の招待がある人、7 日以内に同じ対象への招待を辞退した人は招けない。招かれた人に `kind = 'invite'` の通知を送る。送り手は `auth.uid()`、文面はサーバーで作る。
  - `respond_to_invite(id, accept)`：招かれた本人だけが、保留中の間に呼べる。承諾すると役割 member で所属の行を作り、既存のトリガがその人の Worker を用意する。招いた人がもうその対象を管理していなければ、招待は取り消し扱いになる。
  - `cancel_invite(id)`：招いた人か、その対象を管理する人が取り消せる。通知も消える。
- **招待を読めるのは**、招かれた人、招いた人、その対象のメンバー（一覧に「Invited」と出すため）、Object の Domain を管理する人。
- **作った人の owner の行はサーバーが書く。** Space・Domain・Object を作ると、同じ INSERT の中でトリガが作った人（`auth.uid()`）を owner として登録する。作った人を表す列（`activity_spaces.created_by` / `domains.user_id` / `objects.user_id`）は作成時に呼び出した人になり、その後はログイン中の誰も変えられない。
- **Domain は参加している Space の中に作る。** Domain を作れるのは、`activity_space_id` が自分の参加している Space か空のときだけ。Domain を別の Space へ移せる（`activity_space_id` を変えられる）のは、その Domain の owner・admin のうち、移動元と移動先の両方の Space のオーナーである人だけ（どちらかが空ならもう一方だけ）。Space を削除したときは、その Domain は Space のない Domain として残る。
- **ブラウザが書ける所属の行は、見えている Domain・Object に member として自分が加わる行だけ（Discover）。** 他人の行も、owner の行も、Space の行も書けない。所属の行は人と対象を変えられず、変えられるのは役割だけ。`domain_members` / `object_members` の役割は owner / admin / member で、Domain と Object は Space と同じく最後の owner を外せない（対象そのものやアカウントの削除は別）。例外は、Object の Domain の owner・admin がその Object の最後の owner を外すときで、その人が同じ操作の中で owner を引き継ぐ。引き継いだ人は Object の owner なので、その Object を削除することもできる。Domain の owner・admin は、Object に参加しなくてもそのメンバーを見て外せる。
- **Object を管理する人は主 Domain（`objects.domain_id`）で決まり、その列は両端を管理する人だけが変えられる。** Object を別の Domain に移せるのは、移動元の Domain の owner・admin（Domain のない Object ならその Object の owner・admin）で、かつ移動先の Domain の owner・admin である人だけ。管理の判定（`user_manages_scope_as`）は `object_domains`（複数 Domain への所属）を読まない。
- **どの経路で参加しても、同じ対象への保留中の招待は承諾済みになる。** 保留中の招待の相手がすでにメンバーである状態は作らない。
- **招待は Inbox と Profile に届く。** Inbox では Accept / Decline を出し、答えた後はその結果を示す。Space をまだ持たない人の初回画面にも保留中の招待を並べ、Space を作らずに招待へ参加できるようにする。メンバー一覧は保留中の招待を「Invited」として淡く示し、管理する人には「Cancel invite」を出す。保留中の招待はピッカー・Worker・所属の判定のどれにも入らない。

## 根拠

所属の表に状態を足すと、`is_activity_space_member`・`user_can_see_domain`・`worker_in_space`・`user_can_list_worker` など所属を読むすべての関数と、ブラウザの直接の読み取りが、状態を見るよう書き換えなければならない。1 か所でも漏れれば、承諾していない人がメンバーとして扱われる。招待を別の表に置けば、既存の読み手は何も知らないまま正しく、漏れは「見えない」側に倒れる。

招待をブラウザに書かせると、招く権限と招待の中身（対象・相手・文面・通知）を RLS と CHECK で組み立てることになり、通知の送り手や文面を偽れる余地が残る。RPC にまとめれば、権限の判定・重複の拒否・名前の記録・通知の作成が 1 つのトランザクションで決まる。

承諾で所属の行を作るのは RPC の中だけにした。招待の状態をトリガで所属に変えると、状態を書ける経路がそのまま所属を作る経路になる。

作った人の登録をブラウザに残すと、「作った人」を示す列が証拠になる。ところが Object のメンバーは `objects.user_id` を、Domain の admin は `domains.user_id` を書き換えられたので、「まだ誰もいないとき」に限っても、Discover で加わる → 列を自分に書き換える → 抜けて 0 人にする → 作った人として owner で戻る、という順で他人の Object の owner になれた。登録を作成と同じ INSERT のトリガに移せば、ブラウザが owner の行を書く経路そのものがなくなる。列を作成後に固定するのは、他の判定（`user_can_see_domain` の作成者の分岐など）でも作った人を偽れないようにするため。

Domain を作れる Space を参加している Space に限るのは、作った人がその Domain の owner として登録されるから。どの Space にでも作れると、Domain の owner としてその Space の名簿（`worker_in_space`）に入り、「この Space の Domain」を信じる判定のすべてに加わってしまう。Space 間の移動を両方の Space のオーナーに限るのも同じ理由で、自分の Domain を他の Space へ持ち込むことも、Space の Domain を Object ごと持ち出すこともできないようにする。

辞退から 7 日は同じ人を同じ対象に招けないようにしたのは、辞退の直後に招き直すと通知を繰り返し送れてしまうから。取り消した招待は相手が断ったわけではないので、待たずに招き直せる。

最後の owner を外せないようにしたのは、owner のいない Domain・Object を誰も管理できなくなるから。Space にはすでに同じ制約がある。ただし Object を作った人が Space や Domain から外れても、その Object の唯一の owner として中身を見続け、削除もできてしまう。Object を管理するのはその Domain の owner・admin なので、その人たちが最後の owner を外したときは引き継ぎにした。外すことを拒めば外れた人のアクセスが残り、引き継がずに外せば owner のいない Object が残る。

引き継ぎは「Domain の管理者なら Object の owner になれる」ことでもあるので、Domain の管理者であることを Object のメンバーが作れてはならない。`objects` の UPDATE は Object のメンバーなら列を問わず通すため、主 Domain を自分の作った Domain に書き換えれば、その Domain の owner として Object の管理者になり、最後の owner を外して引き継げた。移動を両端の管理者に限れば、管理者の立場は移動元の管理者から渡されたときにしか生まれない。`object_domains` は Domain の作成者が任意の Object を結び付けられる（可視性の穴として別に扱う）ので、管理の判定には使わない。

招いた人の権限を承諾の時点で確かめ直すのは、外されたオーナーの古い招待が、外された後に所属を作らないようにするため。

## 覆す条件

- アカウントを持たない人をメールで招く要望が出たら、招待の相手をアカウントではなくメールアドレスで持ち、サインアップ時に引き当てる
- 招待の数が多く、招く側の Space を作るだけで誰にでも招待を送れること（迷惑な招待）が実際の問題になったら、送信の回数制限か、招かれる側が受け取る相手を選ぶ設定を持つ
- Space の member や Domain の member にも招く権限を渡したいという要望が出たら、`user_manages_scope_as` の条件を役割ごとの設定にする
