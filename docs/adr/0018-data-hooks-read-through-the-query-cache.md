# 0018. データフックは query cache を通し、identity はセッションから読む

2026-09-04 / フロントエンド高速化

## 背景

起動時に Supabase へ 150 件を超えるリクエストが飛んでいた（resource timing のバッファが溢れて正確な件数は取れないほど）。内訳の主因は3つ。

1. `supabase.auth.getUser()` が 17 回。これは JWT を GoTrue に再検証させる**ネットワーク呼び出し**で、auth-js は navigator lock で直列化する。17 回 × 55ms が、その後ろで待つデータクエリの前に積まれていた
2. `useDomains()` が 12 箇所でマウントされ、各インスタンスが `getUser → activity_space_members → domain_members → domains` の 4 段 waterfall を独立に走らせていた（`domains` 13 回、`activity_space_members` 19 回）。`useActivitySpaces` / `useStrategies` / `useWorkers` / `usePhases` も同型
3. My Elements（初期表示ビュー）が 7 段の逐次クエリで自分の Element を組み立て、それが 2 回走っていた

react-query（IndexedDB 永続化つき）は入っていたが、乗っていたのは `useObjects` の 1 クエリだけだった。

## 決定

- **ユーザー id はセッションから読む**（`getCurrentUserId()` = `auth.getSession()`）。`auth.getUser()` は使わない。RLS が全リクエストでトークンを検証するので、クライアント側で再検証しても安全性は増えない
- **共有されるデータフックは `useQuery` で書く**（`useDomains` / `useActivitySpaces` / `useStrategies` / `usePhases` / `useWorkers` / My Elements）。キーはユーザー id を含み、`enabled: !!userId`。同じキーを読む N マウントは 1 リクエストになり、IndexedDB から復元されて初回描画が待たない。module-level の `Map` / localStorage / `let cache` を新設しない
- **realtime channel は topic ごとに 1 本**（`hooks/sharedRealtime.ts` の refcount）。ハンドラは module-level で、singleton QueryClient に対して patch / invalidate する。インスタンスごとにランダム topic を切る回避策は使わない
- **画面が必要とする形は Postgres で組む**（`get_my_elements()`、`get_explorer_data` と同型、`security invoker`）。クライアントで N 段の waterfall を書かない

## 結果

同一マシン・同一データで、起動時の Supabase リクエストは **150+ → 34**、`/auth/v1/user` は **17 → 0**、最後のリクエスト完了は ~2.1s → ~1.7s（RPC 未適用のフォールバック経路で計測。RPC 適用後は My Elements 分の 7 リクエストが 1 に落ちる）。

## 覆す条件

- react-query を外す判断をしたとき（そのときは共有 store を別に用意する必要がある）
- Supabase が `getSession()` の返すセッションを信用できない形に変えたとき（現状は localStorage の JWT をそのまま返す）
