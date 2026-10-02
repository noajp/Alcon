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
  - `invite_member(scope, id, user)`：その対象を管理する人（Space のオーナー、Domain のオーナー・admin、Object の Domain のオーナー・admin）だけが呼べる。自分自身、すでにメンバーの人、保留中の招待がある人は招けない。招かれた人に `kind = 'invite'` の通知を送る。送り手は `auth.uid()`、文面はサーバーで作る。
  - `respond_to_invite(id, accept)`：招かれた本人だけが、保留中の間に呼べる。承諾すると役割 member で所属の行を作り、既存のトリガがその人の Worker を用意する。招いた人がもうその対象を管理していなければ、招待は取り消し扱いになる。
  - `cancel_invite(id)`：招いた人か、その対象を管理する人が取り消せる。通知も消える。
- **招待を読めるのは**、招かれた人、招いた人、その対象のメンバー（一覧に「Invited」と出すため）、Object の Domain を管理する人。
- **ブラウザが書ける所属の行は自分の分だけ。** 作った人が最初のメンバーになる（Space・Domain・Object に、まだ誰もいないとき）か、すでに見えている Domain・Object に member として加わる（Discover）。他人の行も、owner としての自己参加も書けない。所属の行は人と対象を変えられず、変えられるのは役割だけ。`domain_members` / `object_members` の役割は owner / admin / member。
- **どの経路で参加しても、同じ対象への保留中の招待は承諾済みになる。** 保留中の招待の相手がすでにメンバーである状態は作らない。
- **招待は Inbox と Profile に届く。** Inbox では Accept / Decline を出し、答えた後はその結果を示す。Space をまだ持たない人の初回画面にも保留中の招待を並べ、Space を作らずに招待へ参加できるようにする。メンバー一覧は保留中の招待を「Invited」として淡く示し、管理する人には「Cancel invite」を出す。保留中の招待はピッカー・Worker・所属の判定のどれにも入らない。

## 根拠

所属の表に状態を足すと、`is_activity_space_member`・`user_can_see_domain`・`worker_in_space`・`user_can_list_worker` など所属を読むすべての関数と、ブラウザの直接の読み取りが、状態を見るよう書き換えなければならない。1 か所でも漏れれば、承諾していない人がメンバーとして扱われる。招待を別の表に置けば、既存の読み手は何も知らないまま正しく、漏れは「見えない」側に倒れる。

招待をブラウザに書かせると、招く権限と招待の中身（対象・相手・文面・通知）を RLS と CHECK で組み立てることになり、通知の送り手や文面を偽れる余地が残る。RPC にまとめれば、権限の判定・重複の拒否・名前の記録・通知の作成が 1 つのトランザクションで決まる。

承諾で所属の行を作るのは RPC の中だけにした。招待の状態をトリガで所属に変えると、状態を書ける経路がそのまま所属を作る経路になる。

作った人の自己参加を「まだ誰もいないとき」に限ったのは、`domains.user_id` / `objects.user_id` / `activity_spaces.created_by` が作った人の証拠として十分でないから。Domain の admin は `domains.user_id` を書き換えられ、Object のメンバーは `objects.user_id` を書き換えられる。最初のメンバーに限れば、作成の直後にしか通らない。

招いた人の権限を承諾の時点で確かめ直すのは、外されたオーナーの古い招待が、外された後に所属を作らないようにするため。

## 覆す条件

- アカウントを持たない人をメールで招く要望が出たら、招待の相手をアカウントではなくメールアドレスで持ち、サインアップ時に引き当てる
- 招待の数が多く、招く側の Space を作るだけで誰にでも招待を送れること（迷惑な招待）が実際の問題になったら、送信の回数制限か、招かれる側が受け取る相手を選ぶ設定を持つ
- Space の member や Domain の member にも招く権限を渡したいという要望が出たら、`user_manages_scope_as` の条件を役割ごとの設定にする
