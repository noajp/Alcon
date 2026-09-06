# Alcon — 世界最高の組織活動支援ツールを目指す

Next.js 16 + Supabase + Tailwind CSS + recharts。**Alcon は世界最高の組織活動支援ツールを目指す。** 企業・軍事作戦・病院を問わず、あらゆる組織活動を業界非依存の少数概念で扱う。
詳細な設計思想・拡張計画は [PRODUCT.md](./PRODUCT.md) を参照。

## 開発の回し方

**バックログの単一情報源は盤面**（Supabase の `elements`）。外部の TODO リストを作らない。進捗・判断・失敗の訂正はすべて盤面に書き戻す —— **状態をセッションの記憶に置かない。どのセッションが落ちても、盤面から拾えば続きが回る。**

セッションを始めたら、まず盤面を見る。

| 盤面の状態 | 何をするか | 規約 |
|---|---|---|
| 着手できる Element がある | 取って実装し、PR を出し、レビューゲートを通してマージし、盤面へ書き戻す | friction スキル（[`.claude/skills/friction/SKILL.md`](./skills/friction/SKILL.md)） |
| 空いている | **仕事を探さない。架空の作戦を Alcon で実際に運用して摩擦を採る** | exercise スキル（[`.claude/skills/exercise/SKILL.md`](./skills/exercise/SKILL.md)） |

次に何を作るかは、機能一覧を眺めても要望を聞いても出ない。**使えば必ず出る。** 演習は目的を供給し、目的があって初めて隙間が見える。走っている演習の見つけ方と再開手順は exercise スキルにある。目的のもう1つの供給源は Initiative「Friction GTM — 市場投入」の Ends で、市場投入に直接効く仕事は Object「Go-to-Market」に置く。

ユーザーの判断が要るもの（課金 / 不可逆 / 割れた設計判断 / 停滞）は Object「Decisions — 判断」に Element として起票し、ユーザーにアサインして、止まらずに次へ行く（friction スキル）。

UI を作る・変えるときは design スキル（[`.claude/skills/design/SKILL.md`](./skills/design/SKILL.md)）。

## 概念モデル

機能は **Strategy / Execution / Sustainment** の三つに分類される。全体の体系はクラウゼヴィッツ『戦争論』の **戦略・戦闘・兵站** の三分に着想を得ている。

| 分類 | 戦争論 | 何を扱うか | 単位 |
|---|---|---|---|
| **Strategy** | 戦略 | 何を達成し、どう勝つか | Initiative（束ねると戦略になる） |
| **Execution** | 戦闘 | 実際に行動する | Element → Object → Domain |
| **Sustainment** | 兵站 | 仕事道具 | Workload / Notebook / Table / Team / Calendar |

### Strategy — 戦略
**Initiative** が Strategy の単位。複数の Initiative が束ねられることで戦略となる（`strategy_children` で Initiative は Initiative を内包し、ポートフォリオのルートには最上位の Initiative だけが並ぶ）。Initiative は目的・前提・意思決定・成功条件（`intents`：decision / assumption / measure）を持ち、担当や進捗は持たない。
- **Initiative**：Object を束ねて目的単位で計画と進捗を俯瞰（`strategies` + `strategy_objects`、view id は `strategy`）
- **Phase**：努力をどの段階に配分するかの時間箱（`phases`、Domain スコープ）
- **Timeline**：Initiative の期間・シーケンスを Gantt で俯瞰

### Execution — 戦闘
実際に行動する層。担当・期限・進捗・依存関係・成果物を扱う。三層はアーレント『人間の条件』の **労働・仕事・活動** の三分に着想を得ている。
- **Element**：行動の最小単位。日々こなされる労働（患者 / タスク / 仕訳）。multi-homing 可
- **Object**：Element を束ねる単位。成果物として世界に残る仕事（病棟 / プロジェクト）。Domain 直下のフラット構造
- **Domain**：Object の集合。複数の人が集い関わり合う活動の場（病院 / 会社 / 作戦）

### Sustainment — 兵站
行動を支える**仕事道具**。Worker（human | ai_agent）は Execution で行動する主体であり、その Worker が働き続けられるよう支える道具が Sustainment に属する。
- **Workload**：Worker 別の日次負荷・不在予定。Execution と同じ Element を参照し、詳細を開いて調整できる
- **Notebook**：ドキュメント（議事録 / メモ）
- **Table**：任意の表
- **Team**：Space・Domain の所属と実行上の担当に基づく Worker 名簿。通常稼働時間の編集と Workload への導線
- **Calendar**：Element の期日を時間軸で管理

### Strategy と Execution の分離
UI では Strategy と Execution を明確に分ける（ModeRail の別モード）。混ぜて一覧化すると「意図」と「行動」の区別が崩れる。ただし遮断もしない —— Initiative は配下 Object と実行上のリスク・負荷を、Object は貢献先 Initiative と戦略上の意図を常に見せる。この一クリックの往復可能性が Alcon の核。

### Home — 横断サーフェス
分類に属さない個人ビュー。
- **My Elements**：自分が所有・アサインされた Element
- **Inbox**：通知フィード
- **Calendar**：自分の Element の期日

### Property — 実行単位のメタデータ
Execution の標準フィールド（期限・担当・ステータス等）と、Object ごとに定義して Element に値を持たせるカスタムフィールド。

Property は**データ**であり、その既定の見せ方が Properties ウィジェット（`object-properties`）。詳細ページの右レールに最初から置かれているのは既定の配置であって固定の造作ではなく、動かせるし外せるし、他のサーフェスにも置ける。「メタデータをどう持つか」は Property が、「どこにどう出すか」は Widget が決める。

## UI レイアウト

```
┌─────┬──────────┬────────────────────────────┐
│Mode │AppSide   │ TopBar + TabBar            │
│Rail │bar       ├────────────────────────────┤
│46px │          │      MainContent           │
└─────┴──────────┴────────────────────────────┘
```

- **ModeRail** (`shell/ModeRail.tsx`, 46px)：常時表示のモードセレクタ。折りたたまれない外殻の背骨。上段は固定の Home / Strategy / Execution、区切り線の下がユーザーが Apps ランチャーから追加した App と、追加用の Apps ボタン。`railModeOf(view)` が view→モードの単一情報源で、レールのハイライトと AppSidebar の中身分岐を同時に駆動する。Initiative→Object / Object→Initiative のリンクを辿ると `activeView` が変わり、レールのモードも自動で切り替わる
- **Apps ランチャー**：カタログ・モードのメタ・追加状態は `shell/railApps.ts` の単一情報源（`CORE_MODES` / `APP_GROUPS` / `MODE_META` / `useRailApps`）。カタログは Tools（Notebook / Table / Team）と Sustainment（Workload / Calendar）の2グループに分けて表示するが、概念上はどちらも Sustainment（仕事道具）。タイルを押すとレールに追加してそのまま開く。追加済みタイルの右上に出るチェックを外すとレールから外れ、カタログに戻る。追加状態は `alcon:railApps` に localStorage 永続。追加していない App も、開いている間だけレールに現れる
- **AppSidebar**（折りたたみ可）：最上部に Space 名（`SpaceSwitcher`）＋ Discover(検索) ＋ Create(+)。本体は現在のモードに応じて切替：
  - **Home**：Inbox / Calendar / My Elements
  - **Strategy**：Initiative / Phase / Timeline
  - **Execution**：Domain ツリー（各 Domain を開くと Objects／Elements）
  - **Workload / Notebook / Table / Team / Calendar**：Apps から追加する独立モード。それぞれ単一サーフェスをメインに開き、サイドバーはモード名ラベルのみ
- **TabBar**：Object 内 view 切替。`rightSlot` に view 固有コントロール（Widget の「+ Add widget」もここに入る）
- **Widget / Board** (`alcon/widget/`)：サーフェスに乗る枠付きブロックと、その配置。サーフェスは固定の背骨（タイトル・説明など、そのものの同一性）を持ち、その周りに **Zone**（`band` 上部の帯 / `main` 本文カラム / `rail` 右レール）を置く。ウィジェットは「どの画面か」ではなく **Subject**（`object` / `initiative` / `phase` / `me` …）と Zone を宣言し、定義が自分の `import()` を持つ（`registry.tsx`）。枠は Zone が決める — `rail` は島（`RailCard`）、`main` は section、`band` は帯。どの枠もヘッダは `bg-muted/40` + `--border-subtle` の帯で、名前は枠の中にある。長押し（450ms）で arrange モードに入り、破線の輪郭・`−` バッジ・ゾーンをまたぐドラッグが有効になる（Esc / Done で抜ける）。配置は `widget_boards` にユーザー・対象・サーフェス別で永続し、バージョン検証と revision による競合検出を持つ。汎用 `data-view` は Table の列・行・値を参照し、表・カード・棒グラフとして表示する。データと構造は人間の編集UIとAIの `tableData`、配置は `widgetBoard` が同じ保存先をCRUDする
- **CommandPalette**：⌘K でグローバル検索 + ナビ
- **viewRegistry** (`shell/viewRegistry.ts`)：view id→label/icon の単一情報源

## ディレクトリ構成

```
web/src/
├── app/          # Next.js App Router (単一ページSPA)
├── alcon/        # 中核概念ごとのドメインモジュール
│   ├── domain/   # Domain
│   ├── object/   # Object
│   ├── element/  # Element + actions/ (Initiative shell / Inbox / My Elements 等)
│   ├── property/ # Property（型付きメタデータ列）
│   ├── phase/    # Phase
│   ├── brief/    # Notebook（Note 編集）
│   ├── table/    # Table
│   ├── team/     # Team
│   ├── widget/   # Widget基盤 + home/
│   ├── space/    # Activity Space の切替・オンボーディング
│   ├── settings/ # 設定画面群
│   ├── sync/     # サーバー確定変更の差分ストリーム
│   ├── copilot/  # AI Copilot
│   └── shared/   # alcon横断UI
├── shell/        # 外殻 (ModeRail/AppSidebar/TabBar/CommandPalette等)
├── ui/           # shadcn/ui プリミティブ
├── hooks/        # useSupabase, useAuth, useNotesDb 等
├── shared/       # designTokens.ts / colors / icons
└── types/        # database.ts (全DB型)
```

## データモデル要点

- Object はフラット（Domain 直下のみ、ネスト無し）。multi-homing は `object_domains`
- Element の multi-homing は `object_id` (primary FK) + `element_objects` junction 二重書き
- Property = Objectに帰属するカスタムフィールド。定義・配置・値は `custom_columns` / `custom_column_placements` / `custom_column_values`。作成の「＋」はObject内Elements一覧のみ。横断一覧は標準フィールドの表示設定を使う。TagはElement自身の属性として全ビューに引き継ぐ。標準フィールドの表示／非表示、順序、幅はビューごとに保存。既存の他スコープのデータは保持する。
- Note = `notes` (folder/file ツリー) + `note_contents.html`
- Phase = `phases`（Domain スコープの期間ボックス、Linear の Cycle 相当）。Object / Element は自身の `phase_id` FK で高々1つの Phase に所属（junction なし、削除時は SET NULL）。`end_date` は含む — 最終日はその Phase の稼働日で、境界の翌日ではない（`start_date === end_date` は1日の Phase であって長さ0ではない）。日付を扱う処理は `alcon/shared/phaseWindow.ts` を通す
- Worker = human | ai_agent。`element_assignees` でアサイン
- Subelement = チェックリスト（AI は触らない）
- 境界 = 二層メンバーシップ。Space=`activity_space_members`、Domain=`domain_members`、Object=`object_members`（owner/member）。Space 非メンバーの domain_member は Guest（招かれた Domain のみ可視）
- 可視性は RLS で強制。`domains.privacy` は `workspace`（Space メンバー全員）/`private`（domain_members のみ）。SECURITY DEFINER ヘルパー `user_can_see_domain/_object/_element` が単一情報源（`get_explorer_data` も同じ判定）

## Commands
```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npm run build      # 本番ビルド（型検査込み）
cd web && npx tsc --noEmit   # 型チェック（変更後に必ず実行）
cd web && npm test           # Vitest（純ロジックのユニットテスト。変更後に必ず実行）
cd web && npm run test:watch # Vitest watch
cd web && npm run lint       # ESLint
npx vercel --prod            # 本番デプロイ
```

テストは `web/tests/`。ランナーは Vitest（`web/vitest.config.mts`、environment は node）。
対象は「壊れると痛い純粋ロジック」— DB jsonb の正規化、リストのソート、design-lint の
規則とラチェット。UI のレンダリングテストは持たない。テストが `src/` ではなく `tests/`
に住むのは、design-lint のフィクスチャ（`className="uppercase"` や `#ff0000` を含む文字列）
を design-lint 自身が本物の違反として拾ってしまうため。

## Supabase
- Project ID: `rkugtcqztkkacvoylupw`
- RLS有効。CRUD は `hooks/` に集約
- AI は Edge Functions 経由 (`alcon-copilot` / `run-agent` / `summarize-note` 等)
- **`supabase/` は root にのみ存在する**（migrations・functions とも）。`web/supabase/` は作らない
- **基底スキーマは migrations フォルダの外**（ダッシュボード / MCP `apply_migration` で作られた）。フォルダは部分的な履歴でしかないので、既存テーブルに触る migration は `to_regclass` ガード必須 — PR の preview branch は空 DB に replay する

## 開発ルール

1. **変更後は必ず `cd web && npx tsc --noEmit` と `cd web && npm test`**
2. デザイントークンは `shared/designTokens.ts`。色ハードコード禁止
3. 新 view 追加: `viewRegistry.ts` → `MainContent` 分岐 → ModeRail のモードに属させるなら `railApps.ts` の `MODE_META`（`views` / `defaultView`）＋ `AppSidebar` のモード分岐。新モードを App にするなら `railApps.ts`（`RailMode` / `MODE_META` / `APP_GROUPS`）
4. 新 Widget: 本体を `alcon/widget/widgets/` に置き、`registry.tsx` に定義を1つ足す（`accepts` に対応する Subject、`zones`、`load()` の動的 import）。既定の配置に入れるなら `defaults.ts` も。枠・並べ替え・削除・追加は基盤が持つので、ウィジェット側は中身だけ書く。既存ウィジェットを別の Subject に開放するのは `accepts` に1語足すだけ
5. **図の軸を焼き込まない** — 「何を数えるか」は配置の設定であって部品の性質ではない。集計軸は `alcon/shared/dimensions.ts` の `Dimension`（リストの Grouping と同じ語彙）から選ばせ、`WidgetInstance.params` に持たせる。定義側は `normalizeParams` で既定と検証を書く。軸違いで2つ目のウィジェットを作らない
6. 新規ファイルは `alcon/<concept>/` 配下。横断UI は `alcon/shared/`、外殻は `shell/`

## 禁止事項・アンチパターン

- **入力フィールドに枠・リング・アウトライン禁止** — `<input>` / `<textarea>` / `[contenteditable]` に focus ring 不要。globals.css は `*:focus, *:focus-visible { outline: none }` で自動リングを一切出さない。フォーカスの可視化は部品側の義務（背景トーンの変化などで示す）。Tailwind の `focus:ring-*` `focus:border-*` `focus-visible:outline-*` `focus-visible:ring-*` を新規コードで付けてはならない
- **「Task」と呼ばない** — 必ず「Element」。業界横断の抽象名
- **ウィジェットの枠を自作しない** — 詳細ページに「1枚のカード」を足したくなったら `WIDGET_REGISTRY` に登録する。専用の型・専用の localStorage・専用のカード UI を別経路で作らない。枠は `WidgetFrame`、ヘッダに何か出したいなら `useWidgetMeta`（短い文字列）か `WidgetHeaderAction`（ボタン等）
- **フレームワークは永続データの見せ方にする** — OKR / Gap は `intents` の measure を読み替える。任意の分類・項目を持つ分析は Table の列・行・値としてCRUDし、`data-view` の表示列・分類・軸で可視化する。散文は Note に置く。業界固有のデータや分析結果をコンポーネントや配置パラメータへ直書きしない
- **リポジトリ直下を「旧版」として消さない** — root の `vercel.json` は**本番デプロイ設定そのもの**（`buildCommand: cd web && …` / `outputDirectory: web/.next`）、root の `package.json` はフレームワーク検出用。`web/next.config.ts` の `turbopack.root` 固定も外さない（root で `npm install` すると lockfile が復活し、Next が workspace root を誤認して dev の `globals.css` が stale になる）
- **Object のネスト禁止** — `parent_object_id` も `object_parents` junction も廃止済
- **BlockNote 使用禁止** — Note エディタは独自 `AppleNoteEditor`（HTML + `htmlSanitizer`）
- **recharts コンポーネントに 'use client' 必須** — SSR 非対応
- **ラベルを CSS で全大文字にしない** — メニュー項目・セクション見出し・テーブルヘッダ等で Tailwind の `uppercase` を使わない。ラベルは書いた通り（先頭大文字）で表示する

## 改訂の作法 — 差分注釈ではなくモデル更新

知識・方針・用語の修正を依頼されたら、その意図を汲んで**思考（モデル）自体を上書き**する。新しい理解が最初からそうだったかのように書き直し、残骸を残さない。

- 置き換えた旧概念を「禁止」「廃止」「旧称」等のラベルに降格させて残さない。消すなら本当に消す
- 「X→Y に変更」「以前は X」のような差分・履歴を成果物（ファイル）に書かない。変更点の説明は会話の応答で述べ、ファイルには最終状態だけを残す
- 言及された一箇所だけでなく、意図が波及する全箇所（用語・例・図・付随説明・命名表）を一貫して更新する
- 仕上げに旧概念を grep し、参照が 0 件であることを確認する
- 例外：移行手順や後方互換の deprecation など、ユーザーが履歴の保持を明示した場合のみ記録する
