# Alcon — AI-driven Strategy Execution Manager

Next.js 16 + Supabase + Tailwind CSS + recharts。あらゆる業務を「**大中小+メタ+思考+表現**」の6概念で抽象化するワークマネジメントSaaS。

## Commands
```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npm run build      # 本番ビルド
cd web && npx tsc --noEmit   # 型チェック（変更後に必ず実行）
cd web && npm run lint       # ESLint
npx vercel --prod            # 本番デプロイ
```

## 中核概念モデル（6つだけ覚える）

| 概念 | 役割 | 例 |
|------|------|---|
| **Domain** | 最上位の入れ物（テナント、旧称 System） | 病院 / 会社 / 作戦 |
| **Object** | 中間の構造単位（Domain 直下のフラット + multi-homing） | 病棟 / 科 / 部門 / プロジェクト |
| **Element** | 最小の実行/記録単位（multi-homing） | 患者 / タスク / 案件 / 仕訳 |
| **Tag** | D/O/Eに付与するメタデータ（ドッグタグ） | 血液型 / 期限 / 位置 / 担当 |
| **Brief** | Note から抽出された構造化スナップショット（旧 Ticket） | overview / decisions / action_items / questions |
| **Widget** | データを表現する最小単位 | KPI / Gantt / Map / Chart |

業界横断のため業界語彙（タスク・患者）は中核に持ち込まない。
- Object のネストは廃止済。Domain → Object のフラット 2 階層 + multi-homing で表現する。
- Subelement (チェックリスト) が Element より下に存在するが、AI による自動生成は Element 止まり。

## Architecture（哲学整列）
```
web/src/
├── app/                # App Router (単一ページSPA)。Copilot は page.tsx で MainContent の横に常駐
├── alcon/              # 6概念 + 周辺サブシステムごとのドメインモジュール
│   ├── domain/         # Domain — DomainsView / DomainAgentSettings / domainsStore
│   ├── object/         # Object — Detail / Picker / ListTable / overview/ / summary/
│   ├── element/        # Element — List / Detail + board/ gantt/ calendar/ custom/
│   │                   #           actions/(Inbox/Actions/MyElements/Strategy/Notes)
│   │                   #           agent/(Workpad) craft/(Craft Studio)
│   ├── tag/            # Tag — 列定義 / カスタム列セル / 編集モーダル / useCustomColumns
│   ├── brief/          # Brief + Note (editor/ = AppleNoteEditor / documents/ / NotesSidebar)
│   ├── widget/         # Widget基盤 + 各 widget + home/ (全体Dashboard)
│   ├── room/           # Room — Text/Voice channels + ビデオ会議 / 字幕 / 議事録
│   ├── chat/           # Chat — DM / グループ会話 (Room とは別系統)
│   ├── copilot/        # Alcon Copilot — 横断 AI パネル
│   ├── reference/      # Reference ビュー
│   ├── settings/       # Settings (Account / Appearance / Profile / Team / Invite)
│   └── shared/         # alcon横断UI + listControls/ (filter/group/sort)
├── shell/              # 外殻 (AppSidebar / MainContent / ModeRail / TabBar / WindowTabBar
│                       #       CommandPalette / DiscoverModal / IslandCard / CreateView
│                       #       viewRegistry.ts(活動ビューの単一ソース) / sidebar/ / icons/)
├── ui/                 # shadcn/ui
├── hooks/              # useSupabase / useDashboardData / useRoom / useConversations
│                       #   useNotesDb / useChannelMessages / useVoiceMeeting / useAuth
├── lib/                # supabase client, utils
├── providers/          # AuthProvider, ThemeProvider
├── shared/             # designTokens.ts (CARD/STATUS/PRIORITY/FONT)
└── types/              # database.ts (全DB型) / navigation.ts / notes.ts
```

## 周辺サブシステム
中核 6 概念の上に乗る実装群。すべて D/O/E + Tag + Brief + Widget + Worker に紐付く。

- **Worker** — `human | ai_agent | robot`。`workers` + `element_assignees` で Element にアサイン。
- **Strategy** — `strategies` / `strategy_objects` / `strategy_children`。サイドバー「Action Space」の Strategy ビュー (`StrategyShell` / `StrategyTimelineView`)。
- **Agent (Workpad)** — `agent_runs` + `agent_run_steps`。AI エージェントが Element を実行し、人間が承認するフロー (`element/agent/`、`run-agent` Edge Function)。
- **Craft Studio** — `element/craft/`。AI が canvas / doc 形式の成果物を生成（localStorage 永続、`generateCraft`）。
- **Room** — `rooms` / `channels` / `messages` / `voice_meeting_minutes` / `voice_transcript_lines`。Discord 風 Text/Voice チャンネル + ビデオ会議・ライブ字幕・議事録。
- **Chat** — `conversations` / `conversation_members` / `messages`。1:1・グループの DM（Room とは別系統）。
- **Copilot** — `alcon/copilot/`。`alcon-copilot` Edge Function を呼ぶ横断 AI パネル。

## Data Model
```
Domain (localStorage 永続)
  └── Object (Domain 直下のフラット。object_domains で複数 Domain に multi-homing)
        └── Element (object_id(primary FK) + element_objects で multi-homing)
              ├── Subelement (チェックリスト、AIは触らない)
              └── element_edges (Element 間の依存関係)

Note   ← notes (folder/file ツリー) + note_contents.html (Apple Notes 風 HTML)
Brief  ← briefs + brief_comments (Note から抽出した構造化スナップショット)
Tag    ← custom_columns + custom_column_values
Widget ← alcon/widget/ + localStorage layout
```

## Supabase
- Project ID: `rkugtcqztkkacvoylupw`
- RLS有効（全テーブル）。CRUD は `hooks/useSupabase.ts` ほか hooks に集約
- AI: Claude API は Edge Functions 経由
  (`alcon-copilot` / `analyze-change` / `draft-object` / `generate-object-report`
   `run-agent` / `summarize-note` / `validate-task` / `voice-summarize`)

## Workflow
- IMPORTANT: 変更後は必ず `npx tsc --noEmit` を実行
- デザイントークンは `shared/designTokens.ts` を参照。色をハードコードしない
- 新活動ビュー追加: `shell/viewRegistry.ts` に追加 → `AppSidebar` の nav 配列 + `MainContent` の `activeActivity ===` 分岐
- 新Widget追加: `alcon/widget/widgets/` に追加 + `registry.ts` + `renderWidget.tsx`
- 新規ファイルは概念ごとに `alcon/<concept>/` 配下に置く。横断UIは `alcon/shared/`、外殻は `shell/`

## Gotchas
- **入力フィールドに枠・リング・アウトラインを付けることは厳禁**（`<input>` / `<textarea>` / `[contenteditable]` にはfocus ring不要。globals.css は「デフォルト無し、`button`/`a`/`role=button` 等のみ ring 付与」のホワイトリスト方式。Tailwind の `focus:ring-*` `focus:border-*` `focus-visible:outline-*` `focus-visible:ring-*` を新規コードで付けてはならない）
- 「Task」ではなく「Element」。業界横断で使える抽象名
- Object はフラット (Domain 直下のみ)。`parent_object_id` 列も `object_parents` junction も廃止済。Object の multi-homing は `object_domains` で表現
- Element の multi-homing は `object_id` (primary FK) + `element_objects` junction の二重書き
- Note エディタは独自の `AppleNoteEditor`（HTML + `htmlSanitizer`）。BlockNote は廃止
- **Room と Chat は別系統**。Room = チャンネル制（`channels`）、Chat = DM/グループ（`conversations`）。どちらも `messages` を使うが用途が違う
- Object内タブの `tab_type='summary'` は UI上「Dashboard」と表示される
- Calendar Day/Week ビューは `due_time` カラムを参照（'HH:MM:SS'）
- recharts は SSR 非対応。chart コンポーネントは 'use client' 必須

## Vision
将来はSAPモジュール型の独立アプリ群に展開:
Alcon SEM (現在) / Kanjo-kei (会計) / HR / Sales ...
各モジュールは別リポ・別デプロイ。共通基盤(D/O/E + Tag + Brief + Widget + Worker + AI)を共有。
