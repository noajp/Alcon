# 0030 — Unused Objects are archived; a Domain with Objects is not deleted

## 背景

Object は必ず Domain に置く（Domain → Object → Element、ADR 0029）。ところが、使わなくなった Object を片付ける手段は削除しかなかった。削除すると、その Object にだけ属する Element・コメント・判断の記録も一緒に消える。残しておけば、Domain の一覧、移動先や起票先のピッカー、My Elements、Now、Calendar、Workload、MCP のボードツールに、終わった仕事が並び続ける。

Domain の削除も同じ穴を持っていた。`objects.domain_id` の外部キーは `on delete set null` なので、Object を持つ Domain を消すと、その Object は Domain のない Object として残った。Domain のない Object は Space を持たず、管理する人も Object の owner・admin に縮み、Space の Property の例外（ADR 0028）の対象にもなる。「Object は必ず Domain にある」という規則を、Domain の削除が破っていた。

## 選択肢

- 片付け方：削除だけ／状態列（status）／アーカイブの時刻（`archived_at`）
- 隠す場所：RLS の SELECT ポリシー／一覧の読み取りごと（RPC とクライアントの共通フィルタ）
- 権限の強制：RPC だけが書く／BEFORE UPDATE トリガ／両方
- Domain の削除：Object を Domain の外に出して消す／Object ごと消す／Object が残っていれば拒む

## 決定

- **使わなくなった Object はアーカイブする。** `objects.archived_at`（と `archived_by`）を持ち、データはすべて残す。アーカイブした Object は、Domain の Objects 一覧・サイドバー・ピッカー（Strategy の Object 選択、移動先、QuickAdd の起票先、Notebook、Discover、Phase の候補）・Calendar と Workload の Domain の範囲・Team の名簿・Decision Lab・Initiative の関連 Domain・MCP / Copilot / エージェントのボードツール（`listObjects` と Domain で絞る Element の読み取り）に出ない。
- **アーカイブした Object も id では開ける。** リンク、⌘K の検索（「Archived」と示す）、Element 詳細の所属から開ける。開くと上部に「アーカイブ済み」を示し、管理する人には Restore を出す。RLS（可視性）はアーカイブで変わらない。
- **アーカイブした Object にしかない Element は、実行中の一覧から外れる。** Element の所属 Object がすべてアーカイブ済みなら、その Element はアーカイブされた仕事（`alcon_internal.element_in_archived_work`）として、My Elements・Now・期日前の通知から外れる。アクティブな Object にも属する Element は残り、所属の表示はアクティブな Object だけになる。個人の Element は対象にならない。Inbox の既存の通知は記録として残す。
- **一覧の絞り込みは 1 か所ずつにまとめる。** サーバーは `get_explorer_data`・`get_now_work`・`get_my_elements` がアーカイブ済みを除く。`get_explorer_data(p_domain_id, p_object_id)` は `p_object_id` を渡すと、その 1 件をアーカイブ済みでも返す（id で開くための読み取り）。クライアントで `objects` を直接読む一覧は `onlyActiveObjects`（`Function/shared/objectArchive`）を通す。
- **アーカイブと復元ができるのは、その Object を管理する人だけ。** 主 Domain の owner・admin、Domain のない Object ならその Object の owner・admin（`alcon_internal.user_manages_object`）。BEFORE UPDATE トリガ `objects_archive_guard` が、`archived_at` を変えるすべての書き込み（ブラウザ・MCP・エージェント）でこれを確かめ、時刻と `archived_by` をサーバーで刻む。`archived_by` はアーカイブ以外では変わらない。アプリは `archive_object(id)` / `restore_object(id)`（SECURITY DEFINER）を呼ぶ。サインインしていない処理（運用の SQL）はトリガを通らない。
- **Domain の Objects 一覧の下に「Archived」をたたんで置く。** その Domain を主 Domain とするアーカイブ済みの Object を新しい順に並べ、開く・Restore（管理する人だけ）ができる。Object の「⋯」メニューの Archive は管理する人にだけ出す。
- **Object が残っている Domain は削除できない。** BEFORE DELETE トリガ `domains_delete_guard` が、アーカイブ済みを含めて `domain_id` がその Domain の Object が 1 つでもあれば、件数を添えて拒む（errcode 23503、hint `domain_has_objects`）。削除の画面は先に件数を数え、Object を別の Domain へ移すか削除するよう示す。アカウントの削除がそのアカウントの作った Domain の削除に波及するときも同じく拒むので、先に Object を移す。Space の削除は Domain の `activity_space_id` を空にするだけで Domain を消さないので、この規則に関わらない。

## 根拠

削除だけでは、終わった仕事の記録と、今の一覧の静けさのどちらかを捨てることになる。アーカイブの時刻を持てば、記録を残したまま一覧から外せ、いつ・誰が外したかも残る。状態列にしなかったのは、Object の状態はまだ他に使い道がなく、「使っていない」は真偽と時刻で足りるから。

RLS でアーカイブ済みを隠すと、リンクや検索、Element 詳細の所属表示まで見えなくなり、既存のリンクが壊れる。可視性（誰が見られるか）とアーカイブ（今の一覧に出すか）は別の問いなので、可視性は RLS のまま、一覧の読み取りで絞る。読み取りが散らばると漏れるので、サーバーの 3 つの RPC と、クライアントの直接の読み取りを 1 つのフィルタに寄せた。

権限をトリガで強制するのは、`objects` の UPDATE ポリシーが Object のメンバーなら列を問わず通すから。列の権限で塞ぐと新しい列のたびに付け直しになり、RPC だけにすると MCP の `updateObject` のような別の書き込み口が穴になる。一方で、管理する人（Domain の owner・admin）は Object のメンバーとは限らず、UPDATE ポリシーに届かない。だから書き込みの経路は RPC にし、判定はトリガ 1 つに置いて、どの経路でも同じ答えにした。

Domain の削除で Object を Domain の外に出すと、「Object は必ず Domain にある」が削除のたびに破れる。Object ごと消すと、Domain の owner の 1 回の操作で、他の人が書いた Element まで消える。残っているなら拒み、移すか削除するかを人に決めさせるのが、データを失わない形になる。アーカイブ済みも数えるのは、アーカイブはデータを残す操作であり、Domain を消せばその Object がまた Domain の外に出るから。

## 覆す条件

- アーカイブした Object が増え、Domain ごとの「Archived」の一覧では探しにくくなったら、Settings に Space 全体のアーカイブ一覧と検索を置く
- アーカイブした Object への書き込み（Element の追加・編集）を止めたいという要望が出たら、読み取り専用にする判定を Element の RLS に足す
- アーカイブした Object を一定期間後に自動で削除したいという要望が出たら、保持期間と削除の手順（誰の承認で消すか）を決める
- Domain を、中の Object をまとめて別の Domain へ移しながら削除したいという要望が出たら、移動先を指定する RPC を用意する（移動元と移動先の両方を管理する人に限る）
