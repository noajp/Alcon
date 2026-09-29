# 0026 — External AI reaches the board through MCP with the caller's RLS

## 背景

Claude や ChatGPT などの外部 AI から盤面を読み書きしたいという要望がある（ELE_PLT-003）。PRODUCT.md は「モデルや外部 AI が交代しても同じ権限と実行契約を使える」ことを目指し、「誰／どの AI が、何に基づいて変更したか」を辿れることを求めている。アプリ内 Copilot（`alcon-copilot`）は、呼び出したユーザーの JWT で RLS を効かせるボードツールをすでに持っていた。ただしそれは Copilot の中にしかなく、一部のツールは実在しない列を参照して失敗していた（`domains.prefix`、`estimate_hours`、`workers.kind`、`element_comments.body`、および display_id で Element を引けない不具合）。

## 選択肢

- Next.js の `app/api/mcp` にサーバーを置き、`hooks/` のロジックを使う
- Supabase Edge Function `alcon-mcp` に置き、Copilot のボードツールを `_shared/` に切り出して共有する
- MCP 用にテーブル単位の汎用 CRUD を公開する

## 決定

Edge Function `alcon-mcp` を、状態を持たない Streamable HTTP の MCP サーバーとして置く。ボードツールは `supabase/functions/_shared/boardTools.ts` に切り出し、Copilot と共有する。Initiative の読み取りは `_shared/strategyTools.ts` に置く。

- 認証は `Authorization: Bearer <Supabase のアクセストークン>`。関数の側で `auth.getUser` を使って検証し、そのトークンで作った Supabase クライアントでツールを実行する。service role は使わない
- MCP から公開するのは、読み取りと、日常的に委ねる書き込み（Element の作成・更新、コメント、アサイン、ラベル、Subelement）だけにする。削除・一括変更・Object 間の移動・Object の編集は、共有モジュールにあっても MCP からは呼べない（`tools.ts` の許可リストで判定し、テストで固定する）
- 書き込むたびに、Element の Activity に「… — via <クライアント名> (MCP)」を 1 行記録する。actor_id は DB トリガが本人で上書きし、author も本人の表示名があればそれで上書きされるので、「誰が」は本人、「どの AI 経由か」は detail に残る。コメントは `author_kind='ai_agent'`、`author_name=<クライアント名>`、`author_id=本人` で書く

## 根拠

Next.js の API ルートに置くと、`app/` にはページだけを置くという構成が崩れるうえ、Copilot と同じ仕事をするロジックが二重になる。Edge Function なら、Copilot が採用している「呼び出したユーザーの JWT で RLS に任せる」形をそのまま使える。1 か所を直せば両方が直り、今回見つかった不具合も共有モジュールの修正だけで Copilot 側まで直った。

汎用 CRUD を出すと、概念上の不変条件（主 Object と junction の整合、status と progress の正規化、UUID で指定された Element の可視性確認）を外部 AI に任せることになる。`element_comments` と `subelements` の RLS は認証済みユーザー全員に開いていて `elements` より広いため、UUID をそのまま通すと、見えない Element にもコメントでき、Subelement も書き換えられてしまう。ツール層で、親 Element の可視性を確かめる必要がある。

## 覆す条件

- OAuth（ELE_PLT-004）を入れたら、トークンの発行元と失効の経路をこの ADR の認証の節に合わせて見直す
- 外部 AI に削除や一括変更を委ねたいという実際の要求が、確認付きで出てきたら、公開範囲を広げる別の判断を書く
- `element_comments` と `subelements` の RLS が `user_can_see_element` に揃ったら、UUID の可視性確認は防御の重ね掛けとして残すか外すかを決め直す
- Copilot と MCP で必要なツールの形が分かれてきたら、共有をやめてそれぞれに持たせる
