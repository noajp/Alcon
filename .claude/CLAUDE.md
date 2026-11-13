# Alcon

**Alcon が完成するまで諦めない。** あなた（わたし Claude）は Alcon を世界最強の Super AI 実行基盤にするために、あらゆる努力をして能力を限界まで拡張させる。広い視野を持ち、設計者の立場で、ユーザーに何を届ける必要があるかという視点に立って開発する。

Alcon は、組織の仕事を人と AI が一緒に進める運用基盤を目指します。チームの誰かに頼むように AI に伝えるだけで、AI が計画を立て、作業を進めます。クリエイティブな作業ではなく、現実の課題を解決するために使います。製品の設計と、次に作るものは [PRODUCT.md](./PRODUCT.md)、紹介は [docs/about.md](../docs/about.md)。

## 実現すること

- **目標から計画へ**：Strategy と成功条件から、AI が会話で前提を確かめ、Object と Element の計画を作る。人が確かめてから実行する
- **人と AI の分担**：調査・下書き・集計・分析は AI、判断・承認・対外的な約束は人。誰に任せるかはハーネスの決まりで決める
- **自律的な実行**：Web で調べ、表に記録し、文書を作る。登録したマシンではブラウザの操作もする
- **閉じても続く仕事**：時刻や Webhook で自動で始まり、始めた人の権限で動き、止まっても続きから再開する
- **判断だけを人に**：承認が要る操作と AI で決められない判断は「判断待ち」に回す。仕事の流れはボードで一覧にする
- **組織の記録**：目的・成功条件・前提・意思決定・Table・Note・ファイルを残し、次の AI がそれを読んで進める
- **仕事のやり方の定義**：進め方・止める条件・成果物の形・使う連携をハーネスに書き、保存時に検査する
- **連携**：組織が使うサービスとコネクタでつながる。モデルは切り替えられる
- **安全と管理**：Space ごとに分かれたデータ（RLS）、AI に見せない認証情報、送信先の制限、実行する内容に結び付いた承認、操作の履歴、費用の上限

## あなたの目的

Alcon を、課題を解決できる道具にすること。そのために、Alcon の AI がどんな仕事でもこなせる基盤を作る。Alcon の中の仕事は Alcon の AI に指示してやらせ、DB を直接書き換えたり、人が中身を書き写して渡したりして済ませない。Alcon の AI にできないことが見つかったら、その一件のための機能を足すのではなく、なぜ基盤でできないのか（道具・権限・文脈・入口のどれが欠けているか）を直す。

## 作りの三層

| 層 | 中身 |
|---|---|
| 操作画面 | 仕事が流れていくのを見て、人は判断と評価だけをする |
| AIP | モデルは差し替え可能。ハーネス（仕事のやり方）とコネクタ（外とのつながり）を増やして使う。止める条件と承認はエンジンが守らせる |
| データ | Supabase（Postgres・RLS・Edge Functions・Vault・Realtime） |

## 概念モデル

| 分類 | 何を扱うか | 単位 |
|---|---|---|
| **Strategy** | 何を達成し、どう勝つか | Strategy（際限なく入れ子にでき、最上位が Space の目指す姿、配下がそれを勝ち取る筋道）。Phase（期間の区切り）はナビに出さない |
| **Execution** | 実際に行動する | Domain（活動の場）→ Object（Element をまとめる持ち場。プロジェクトに近い）→ Element（行動の最小単位） |
| **Sustainment** | 活動を続ける道具 | Artifacts / Team / Table / Calendar |

Strategy は目的・前提・意思決定・成功条件を持ち、担当や進捗は持たない。担当・期限・進捗・依存は Execution 側で扱う。Element は動詞（`judge` `decide` `approve` `answer` は人だけ、ほかは AI もできる）を持つ。Worker は `human | ai_agent`。外の世界のもの（顧客・候補・問い合わせ）は Object ではなく Table の行に置く。

## コマンド

```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npx tsc --noEmit   # 型チェック（変更後に必ず）
cd web && npm test           # Vitest（変更後に必ず）
cd web && npm run build      # 本番ビルド
cd web && npm run lint:changed && npm run unwired-lint && npm run design-lint
cd web && npm run sync       # ブランチ・worktree の掃除
cd web && npm run dispatch   # Element を Claude Code に渡す常駐（alcon スキル）
```

テストは `web/tests/`（Vitest / node）。対象は不具合の影響が大きい純粋ロジックに絞り、UI のレンダリングテストは持たない。

## ディレクトリ

`web/src/` の下：

- `Frame/` 外枠（ModeRail・サイドバー・CommandPalette・MainContent・`viewRegistry.ts`）
- `ActivitySpace/` 画面。サイドバーの項目ごとに1フォルダ（`strategy` `artifacts` `people` `table` `calendar` `execution` `home`）
- `AIP/` AI の部品（`harness` `connectors` `ai`）
- `Function/` 画面を支える仕組みと、画面をまたぐモデル（`widget` `property` `settings` `space` `shared` など）
- `hooks/` Supabase の読み書きはすべてここ
- `lib/` `providers/` `auth/` `types/` `ui/`、`app/` は layout / page / globals.css と、ログイン画面の `login/` だけ

root 直下は `supabase/`（migrations と functions。ここにだけ置く）、`sdk/`、`docs/`（外部向けの API・MCP の説明）、`website/`（紹介ページ。ビルド時に `web/public/homepage/` へ写し、`/homepage` で出す。ログインしていない人が `/` を開くとここへ送る）。開発にだけ使うものは `.claude/`。

## 実装ルール

1. 変更後は必ず `npx tsc --noEmit` と `npm test`
2. 依存は `ActivitySpace/` → `Function/` `AIP/` `hooks/` の一方向。`Function/` `AIP/` `hooks/` から `ActivitySpace/` を import しない（`Function/widget/widgets/` だけ例外）。画面は `supabase` を直接使わず `hooks/` を通す（`artifacts/slides` だけ例外）。ESLint が検査する
3. **新 view**：`Frame/viewRegistry.ts`（label/icon の単一情報源）→ `Frame/MainContent` の分岐 → `Frame/railApps.ts` の `MODE_META`
4. **新 Widget**：本体を `Function/widget/widgets/`、定義を `registry.tsx` に1つ、既定配置は `defaults.ts`。枠は `WidgetFrame`、ヘッダは `useWidgetMeta` / `WidgetHeaderAction`。共有の中身は `useWidgetDocument`、本人だけの下書きは `useWidgetViewerState`
5. グラフの集計軸は `Function/shared/dimensions.ts` の `Dimension` から選ばせ、`WidgetInstance.params` に保存する
6. 業界固有のデータや分析結果をコンポーネントに直書きしない。分類は Table、文章は Note、仕事のやり方はハーネスに置く
7. **Object のネスト禁止**。Element の multi-homing は `object_id` + `element_objects` の二重書き
8. 日付は `Function/shared/dateUtils.ts` を通す。Phase の期間は `end_date` 当日を含める。暦日を `new Date('yyyy-MM-dd')` で読まない
9. 色はトークン（`globals.css` / `shared/designTokens.ts`）だけ。「Task」と呼ばず「Element」。recharts を使うコンポーネントは `'use client'`
10. **AI の入口**：汎用の AI は Agent 画面（Copilot）だけに置き、画面ごとに汎用チャットを置かない。対象に結び付いた AI の仕事（Strategy の会話、Planner、Element の実行）は置ける。ただし、対象の範囲に限られ、成果が記録として残り、承認の境界を越えないものだけ。Copilot は開いている対象を文脈として受け取るが、入口は Agent 画面のまま。どの機能も AI なしで動くように作る

## Supabase

- Project ID: `rkugtcqztkkacvoylupw`。閲覧範囲は RLS で制御する
- AI は Edge Functions 経由（`run-agent` `plan-initiative` `alcon-copilot` など）
- **既存テーブルに触る migration は `to_regclass` ガード必須**（PR の preview branch は空 DB に流すため。書式は alcon スキル）

## リポジトリ直下を「旧版」として消さない

root の `vercel.json` は本番デプロイ設定、root の `package.json` はフレームワーク検出用。`web/next.config.ts` の `turbopack.root` 固定も外さない。

## 文書の改訂方針

文書には現在の考え方だけを書く。用語や方針を変えたら関連する説明を全部更新し、「以前は X」「X→Y に変更」のような履歴は残さない。ここには守るべきことだけを書き、仕組みの説明はコードのコメントに置く。

## 完了したら

確認まで済んだらコミットして Push し、PR の CI が通ってからマージする。作業と無関係な変更は含めない。Alcon の Element を取って開発するとき、架空の案件で試すとき、PR をレビューするときは [alcon スキル](./skills/alcon/SKILL.md) を読む。
