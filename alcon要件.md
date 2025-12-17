# AI Work Platform 要件定義書
## Cursor UI × Asana Work Graph × Git Version Control × AI-First Architecture

---

# 第1章: プロダクトビジョン

## 1.1 コンセプト

**「AIが頭脳として働く、バージョン管理可能なワークマネジメントプラットフォーム」**

従来のツールの問題点：
- Asana/Jira: AIはオプション機能、バージョン管理なし
- Git/GitHub: コード専用、プロジェクト管理は別ツール
- Cursor: コーディング特化、ワークマネジメント機能なし

**本プラットフォームの位置づけ:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                    AI Work Platform                                     │
│                                                                         │
│    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │
│    │   Cursor    │    │   Asana     │    │    Git      │              │
│    │   的 UI     │ +  │  Work Graph │ +  │  Version    │              │
│    │             │    │             │    │  Control    │              │
│    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘              │
│           │                  │                  │                      │
│           └──────────────────┼──────────────────┘                      │
│                              │                                         │
│                    ┌─────────▼─────────┐                               │
│                    │   AI Agent Core   │                               │
│                    │  (Claude/GPT等)   │                               │
│                    │                   │                               │
│                    │  全ての操作の     │                               │
│                    │  仲介者・頭脳     │                               │
│                    └───────────────────┘                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 1.2 根本的な設計哲学

**従来のアプローチ:**
```
User → UI → Database → (optional) AI
```

**本プラットフォームのアプローチ:**
```
User → AI Agent → Database
         ↑
        UI (AIの操作を可視化・承認する窓口)
```

**AIは「アシスタント」ではなく「オペレーター」である。**
- AIがタスクを分析し、提案し、実行する
- 人間は最終的な意思決定と承認を行う
- UIはAIの思考プロセスと提案を可視化する

---

# 第2章: Cursor UIの分析

## 2.1 Cursorとは何か

CursorはVisual Studio Codeをベースに構築されたAI搭載コードエディタで、スマートでコンテキストを理解した機能で開発者の生産性を向上させる。

### コア機能

Cursorのコンテキスト認識機能は他のAIコーディングツールと一線を画している。作業中のファイルだけでなく、コードベース全体を理解する。この深い理解が多くの機能を支え、より正確で関連性の高い支援を可能にする。

## 2.2 Cursor UIの構成要素

### 2.2.1 エディタ領域（Editor Area）

**Monaco Editor統合:**
- コード/ドキュメントの編集
- シンタックスハイライト
- インテリセンス

**インライン編集（⌘K）:**
ツールはdiffビューを生成し、承認前に提案された変更を即座に可視化できる。この機能は小さなコードセグメントの実装や特定の関数内での軽微なリファクタリングに特に有用。

### 2.2.2 サイドバー（Chat/Ask）

これは単なるサイドバーのチャットウィンドウではない。Cursorはどのファイルを開いているか、カーソルがどこにあるかを理解している。画面を見ている開発者とチャットしているようなもの。

### 2.2.3 Agent Mode（Composer）

Composerは単一ファイルだけでなく、プロジェクト全体にわたる変更を調整できる。コードだけでなく、すべてのピースがどのように組み合わさるかを理解するAIアーキテクトのような存在。

**3つのモード:**
今は1つのサイドバーに統合され、Ask、Agent、Editモードを選択できる。新しい「Ask」モードは以前の「Chat」、新しい「Agent」モードは以前の「Composer」に相当する。

### 2.2.4 @記法によるコンテキスト参照

Cursorは@記号をAIインタラクションで異なる種類のコンテキストを参照する強力な方法として使用する。⌘K、Chat、Composerのいずれを使用しても、@記号でファイル、コードスニペット、ドキュメントなどに素早くアクセスできる。

### 2.2.5 Diff View と承認フロー

チャットサイドバーはより包括的なインタラクションのための会話スペースを拡張する。Ctrl-LまたはCmd-Lで起動し、AIとのマルチターン会話のための広いスペースを提供する。サイドバーには選択したファイルにdiffを作成するApplyボタンがあり、より広範な単一ファイルのリファクタリングや既存コードに基づく新規ファイル生成に価値がある。

## 2.3 Cursor UIの本プラットフォームへの適用

| Cursor機能 | 本プラットフォームでの対応 |
|-----------|-------------------------|
| ファイルツリー | Work Graph ツリー（Projects, Tasks, Documents） |
| エディタ | タスク詳細、ドキュメントエディタ、ボードビュー |
| Chat/Ask | AI Panel（コンテキスト認識チャット） |
| Agent/Composer | AIによるタスク作成・分解・依存関係設定 |
| Diff View | タスク/ドキュメント変更の承認フロー |
| @記法 | @task, @project, @user, @document 参照 |
| Terminal | ワークフロー実行ログ、AI操作ログ |

---

# 第3章: Asana機能の分析

## 3.1 Asanaの主要機能一覧

### 3.1.1 タスク管理

開始から終了まで作業を追跡し、すべてのチームが同期を保ち、目標達成に向けてスケジュール通りに進められる。プロジェクトとタスクを一箇所で整理することでチームの責任を明確にする。

**タスクの属性:**
- 名前、説明
- 担当者（Assignee）
- 期日（Due Date）、開始日（Start Date）
- ステータス、優先度
- カスタムフィールド（17種類以上）
- サブタスク（最大5階層）
- 依存関係（Dependencies）
- フォロワー（Collaborators）
- コメント、添付ファイル

### 3.1.2 プロジェクトビュー

Asanaで利用可能なプロジェクトビューにはリスト、ボード（カンバン）、カレンダー、タイムライン（ガント）、ホーム/タスクビューがあり、異なるワークフローに対応できる。同じプロジェクトでシームレスにビューを切り替えられる。

### 3.1.3 ポートフォリオ

未完了タスクや従業員のワークロードなどの統計を可視化し、問題が発生する前に止められる。チームメイトをポートフォリオに招待し、必要な詳細を一箇所で提供できる。

### 3.1.4 ワークロード管理

ワークロード機能でポートフォリオ内のすべてのプロジェクトにわたるチーム全員の稼働状況を追跡できる。異なるプロジェクトで作業していても、チームの時間の使い方の全体像を把握できる。

### 3.1.5 ゴール

AIの助けを借りて、より効果的な目標を作成し、組織全体で標準化し、進捗を簡単に追跡できる。

### 3.1.6 オートメーション（Rules）

2024年において自動化は効率向上の鍵。Asanaのルール自動化機能では、特定のアクションのトリガーを設定できる。例えば、タスクが完了としてマークされると、次のタスクが自動的に別のチームメンバーに割り当てられる。

### 3.1.7 カスタムフィールド

すべての有料Asanaプランには無制限のカスタムフィールドが含まれる。カスタムフィールドでAsanaプロジェクトのタスクに追加データを付与できる。17種類のカスタムフィールドタイプを使用して、ステージ、優先度、コスト、その他ワークフロー、チーム、会社に重要なものを作成できる。

## 3.2 Work Graph® データモデル

### 3.2.1 従来の「コンテナモデル」の問題

コンテナデータモデルは1対1の関係でプロジェクト作業を整理する。本質的に、作業の単位が1つの場所にしか存在できないデータモデル。例えば、チームにフォルダがあり、チームの作業はそのフォルダに存在する。

### 3.2.2 Work Graph®の革新

現代の仕事のほとんどは複雑な1対多の関係で運営される。複数のチームと協力し、様々なプロジェクトをサポートし、複数のビジネス目標に貢献している可能性が高い。Asana Work Graph®データモデルは、あらゆる作業が1対多の関係を持てる柔軟なシステム。

### 3.2.3 オブジェクト階層（API仕様）

オブジェクト階層はAsana Work Graphに大きく影響を受けている。これは、あらゆる作業が1対多の関係を持てる柔軟なシステム。同様に、APIのオブジェクト（タスク、プロジェクト、ポートフォリオなど）も1つ以上の他のオブジェクトと関連付けられる。

### 3.2.4 マルチホーミング（Multi-homing）

1つのAsanaタスクを複数のプロジェクトの一部にできる。これはAsanaの最も強力な機能の1つ。

タスクはサブタスクとしてマルチホーミングできる。例えば、タスクAはプロジェクトBに存在でき、同じタスクAはタスクCのサブタスクにもなれる。

### 3.2.5 Asanaの技術スタック

Asanaはこれらの課題に対処するため、OKVStoreというMySQL上の永続化レイヤーを構築した。これはグラフデータベースとオブジェクト指向言語にインスパイアされており、エンジニアがオブジェクトリレーショナルインピーダンスミスマッチやLunaDbのリアクティビティパイプラインを気にせず、オブジェクトライクな設定ファイルでプロパティとアクセス制御ルールを宣言的に定義できる。

## 3.3 Asana データモデル図解

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Asana Work Graph®                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Workspace/Organization                                                 │
│       │                                                                 │
│       ├── Team A ─────────────────────────────────────────┐            │
│       │     │                                              │            │
│       │     ├── Project 1 ◄─────────────────┐             │            │
│       │     │     ├── Section: Backlog      │             │            │
│       │     │     │     └── Task X ─────────┼─────────────┼──┐        │
│       │     │     ├── Section: In Progress  │             │  │        │
│       │     │     │     └── Task Y          │             │  │        │
│       │     │     └── Section: Done         │             │  │        │
│       │     │                               │             │  │        │
│       │     └── Project 2 ◄─────────────────┼─────────────┼──┼──┐     │
│       │           └── Section: Q4           │             │  │  │     │
│       │                 └── Task X ─────────┘             │  │  │     │
│       │                      (同一タスク、マルチホーム)     │  │  │     │
│       │                                                   │  │  │     │
│       └── Team B ─────────────────────────────────────────┘  │  │     │
│             │                                                │  │     │
│             └── Project 3 ◄──────────────────────────────────┘  │     │
│                   └── Section: Cross-functional                 │     │
│                         └── Task X ◄────────────────────────────┘     │
│                              (3プロジェクトに同時所属！)               │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Task X の属性                                                      │ │
│  │ ─────────────────────────────────────────────────────────────────│ │
│  │ id: "task-uuid-123"                                               │ │
│  │ name: "API設計"                                                   │ │
│  │ assignee: "user-456"                                              │ │
│  │ due_date: "2024-12-15"                                            │ │
│  │ projects: ["project-1", "project-2", "project-3"] ← マルチホーム  │ │
│  │ memberships: [                                                     │ │
│  │   {project: "project-1", section: "backlog"},                     │ │
│  │   {project: "project-2", section: "q4"},                          │ │
│  │   {project: "project-3", section: "cross-functional"}             │ │
│  │ ]                                                                  │ │
│  │ custom_fields: {priority: "high", story_points: 8}                │ │
│  │ subtasks: ["subtask-1", "subtask-2"]                              │ │
│  │ dependencies: ["task-z"] ← この完了を待っている                    │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

# 第4章: Gitバージョン管理の概念

## 4.1 Gitの核心概念

### 4.1.1 バージョン管理の本質

バージョン管理システムはすべてのファイルの長期的な変更履歴を完全に保持する。これには、長年にわたる多くの個人による変更すべてが含まれる。変更にはファイルの作成と削除、およびその内容の編集が含まれる。

### 4.1.2 ブランチとマージ

VCSツールでの「ブランチ」作成は、複数の作業ストリームを互いに独立させながら、それらの作業を統合する機能も提供する。これにより開発者は各ブランチの変更が競合しないことを確認できる。多くのソフトウェアチームは機能ごとのブランチ戦略やリリースごとのブランチ戦略、またはその両方を採用している。

### 4.1.3 トレーサビリティ

ソフトウェアに対する各変更を追跡し、Jiraなどのプロジェクトマネジメントやバグトラッキングソフトウェアと接続でき、各変更に目的と意図を説明するメッセージで注釈を付けることができる。これは根本原因分析やフォレンジクスに役立つだけでなく、コードを読んで何をしているのか、なぜそのように設計されたのかを理解しようとするときに、開発者が正しく変更できるようにする。

### 4.1.4 コミットメッセージの重要性

説明的なコミットメッセージは各変更の目的を明確に説明し、バージョン履歴を理解しやすく維持しやすくする。説明的なコミットメッセージは変更自体と同じくらい重要。命令形の現在形の動詞で始まり、各コミットの目的を明確かつ簡潔に示す記述的なコミットメッセージを書くこと。

### 4.1.5 アトミックコミット

アトミックコミットは各コミットが1つの明確なタスクまたは修正を表すことを保証し、レビューを高速化し、リバートを安全にする。アトミックコミットは1つの作業単位であり、1つのタスクまたは1つの修正のみを含む（例：アップグレード、バグ修正、リファクタリング）。意図しない副作用なしに適用またはリバートできるため、コードレビューが高速化し、リバートが容易になる。

## 4.2 Gitワークフローパターン

### 4.2.1 ブランチ戦略

ブランチを使用することで、ソフトウェア開発チームはメインのコードラインに影響を与えずに変更を加えられる。変更の履歴はブランチで追跡され、コードの準備ができたらメインブランチにマージされる。

**主要なブランチ戦略:**
1. **Centralized Workflow**: 全員がmainに直接コミット
2. **Feature Branching**: 機能ごとに新しいブランチ
3. **GitFlow**: develop → release → main の流れ
4. **Personal Branching**: 開発者ごとにブランチ

### 4.2.2 マージと競合解決

マージは1つのブランチから別のブランチへの変更を統合するプロセス。

コミットが必要な理由は、マージはバージョン管理システムによって記録される操作であり、マージ中に行った選択を記録するため。このようにして、バージョン管理システムは完全な履歴を含み、あなたが編集を行ったことと同時作業をマージしたことの違いを明確に記録する。

## 4.3 ワークマネジメントへのGit概念の適用

| Git概念 | ワークマネジメントでの適用 |
|--------|-------------------------|
| Repository | プロジェクト/ワークスペース |
| File | タスク、ドキュメント、ゴール |
| Commit | 変更履歴（タスク更新、ドキュメント編集） |
| Branch | ワークフローの分岐（提案、レビュー中、承認済み） |
| Merge | 変更の適用（AI提案の承認） |
| Diff | 変更前後の比較表示 |
| Pull Request | 変更レビュー・承認フロー |
| Conflict | 同時編集の競合解決 |
| Tag | マイルストーン、リリースポイント |
| Revert | 変更の取り消し |

### 4.3.1 タスク/ドキュメントのバージョン管理

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Task Version History                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  v1 (initial) ──→ v2 (manual edit) ──→ v3 (AI suggestion)              │
│       │                                        │                        │
│       │                                   [Pending Approval]            │
│       │                                        │                        │
│       └────────────────────────────────────────┼──→ v4 (approved)       │
│                                                │                        │
│  Branch: main ─────────────────────────────────┼──────────────→        │
│                                                │                        │
│  Branch: ai-suggestion ────────────────────────┘                       │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Version Diff (v2 → v3)                                          │   │
│  │ ───────────────────────────────────────────────────────────────│   │
│  │ - description: "API設計を行う"                                   │   │
│  │ + description: "REST APIの設計を行う\n\n## エンドポイント..."     │   │
│  │ + estimated_hours: 8                                            │   │
│  │ + subtasks: [                                                    │   │
│  │ +   "エンドポイント定義",                                        │   │
│  │ +   "スキーマ設計",                                              │   │
│  │ +   "認証方式決定"                                               │   │
│  │ + ]                                                              │   │
│  │                                                                  │   │
│  │ [✅ Accept] [❌ Reject] [📝 Edit]                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

# 第5章: AI-First アーキテクチャ

## 5.1 AIは「機能」ではなく「基盤」

### 5.1.1 従来ツールのAI統合

従来のツール（Asana AI、Jira AI等）:
```
[ユーザー操作] → [UI] → [Database] → [結果表示]
                           ↓
                    [AI（オプション）]
                           ↓
                    [提案表示]
```

**問題点:**
- AIは「追加機能」として後付け
- AIの提案は文脈理解が浅い
- 承認フローが曖昧
- AIの学習・記憶が限定的

### 5.1.2 本プラットフォームのAI統合

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                          USER                                    │   │
│  │                           │                                      │   │
│  │              「このタスクを分解して」                              │   │
│  │                           │                                      │   │
│  └───────────────────────────┼─────────────────────────────────────┘   │
│                              │                                         │
│                              ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     AI AGENT CORE                                │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │  1. Context Collection                                   │    │   │
│  │  │     - Current task info                                  │    │   │
│  │  │     - Related documents                                  │    │   │
│  │  │     - Similar past tasks (vector search)                 │    │   │
│  │  │     - User preferences & patterns                        │    │   │
│  │  │     - Project constraints                                │    │   │
│  │  └─────────────────────────────────────────────────────────┘    │   │
│  │                              │                                   │   │
│  │                              ▼                                   │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │  2. LLM Processing (Claude/GPT)                          │    │   │
│  │  │     - Analyze task complexity                            │    │   │
│  │  │     - Determine subtask structure                        │    │   │
│  │  │     - Estimate effort per subtask                        │    │   │
│  │  │     - Identify dependencies                              │    │   │
│  │  └─────────────────────────────────────────────────────────┘    │   │
│  │                              │                                   │   │
│  │                              ▼                                   │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │  3. Tool Selection & Execution Plan                      │    │   │
│  │  │     - create_subtasks                                    │    │   │
│  │  │     - update_task (estimated_hours)                      │    │   │
│  │  │     - create_dependencies                                │    │   │
│  │  └─────────────────────────────────────────────────────────┘    │   │
│  │                              │                                   │   │
│  └──────────────────────────────┼──────────────────────────────────┘   │
│                                 │                                      │
│                                 ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     AI ACTIONS (Audit Log)                       │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │  action_id: "action-789"                                 │    │   │
│  │  │  status: "pending_approval"                              │    │   │
│  │  │  proposed_changes: [                                     │    │   │
│  │  │    {type: "create", entity: "subtask", data: {...}},    │    │   │
│  │  │    {type: "create", entity: "subtask", data: {...}},    │    │   │
│  │  │    {type: "update", entity: "task", changes: {...}}     │    │   │
│  │  │  ]                                                       │    │   │
│  │  │  reasoning: "8時間のタスクを3つのサブタスクに分解..."    │    │   │
│  │  └─────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                 │                                      │
│                                 ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                          UI LAYER                                │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │  Proposed Changes                              [Diff View] │   │   │
│  │  │  ─────────────────────────────────────────────────────── │   │   │
│  │  │  ➕ CREATE Subtask: "エンドポイント定義"                   │   │   │
│  │  │     Est: 3h | Complexity: Medium                          │   │   │
│  │  │                                                            │   │   │
│  │  │  ➕ CREATE Subtask: "スキーマ設計"                         │   │   │
│  │  │     Est: 3h | Complexity: Medium                          │   │   │
│  │  │                                                            │   │   │
│  │  │  ➕ CREATE Subtask: "認証方式決定"                         │   │   │
│  │  │     Est: 2h | Complexity: Low                             │   │   │
│  │  │                                                            │   │   │
│  │  │  📝 UPDATE Parent Task                                    │   │   │
│  │  │     estimated_hours: null → 8h                            │   │   │
│  │  │                                                            │   │   │
│  │  │  AI Reasoning:                                            │   │   │
│  │  │  "類似タスク3件を分析した結果、API設計タスクは通常        │   │   │
│  │  │   エンドポイント定義、スキーマ設計、認証設計の3段階で     │   │   │
│  │  │   構成されます。過去の実績から合計8時間と見積もりました。" │   │   │
│  │  │                                                            │   │   │
│  │  │  [ ✅ Apply All ] [ ☑ Select & Apply ] [ ❌ Dismiss ]    │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                 │                                      │
│                      User clicks [Apply All]                           │
│                                 │                                      │
│                                 ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        DATABASE                                  │   │
│  │                                                                  │   │
│  │  - entities: INSERT 3 subtasks                                  │   │
│  │  - entity_edges: INSERT parent-child relations                  │   │
│  │  - entity_versions: CREATE new version record                   │   │
│  │  - ai_actions: UPDATE status = 'completed'                      │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 5.2 AIエージェントの種類

| エージェント種別 | 役割 | トリガー |
|----------------|------|---------|
| Task Analyzer | タスク分析・分解・見積もり | タスク作成、大きなタスク検出 |
| Document Editor | ドキュメント生成・編集・要約 | ドキュメント操作、@doc参照 |
| Dependency Manager | 依存関係の検出・提案 | タスク間の関連性検出 |
| Scheduler | スケジュール最適化、リソース配分 | 期日変更、ワークロード超過 |
| Meeting Assistant | 議事録作成、アクションアイテム抽出 | ミーティング終了時 |
| Orchestrator | 複数エージェントの調整 | 複雑なリクエスト |

## 5.3 AI Memory System

```sql
-- 長期記憶
ai_memories (
    id UUID,
    agent_id UUID,
    memory_type VARCHAR,  -- 'fact', 'preference', 'pattern', 'context'
    content TEXT,
    embedding vector(1536),
    importance DECIMAL,
    scope_organization_id UUID,
    scope_user_id UUID,
    scope_entity_id UUID,
    access_count INTEGER,
    last_accessed TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ  -- 一時記憶用
)

-- 例: 学習した記憶
{
    memory_type: 'pattern',
    content: 'TAKANORIさんはAPI設計タスクを3段階で分解することを好む',
    importance: 0.85,
    scope_user_id: 'takanori-uuid'
}

{
    memory_type: 'fact',
    content: 'プロジェクト「銀行システム刷新」のスプリントは2週間単位',
    importance: 0.9,
    scope_entity_id: 'project-uuid'
}
```

---

# 第6章: 技術スタック実現可能性

## 6.1 TypeScript + PostgreSQL + Supabase

### 6.1.1 必要機能とSupabaseの対応

| 必要機能 | Supabase対応 | 備考 |
|---------|-------------|------|
| PostgreSQL | ✅ マネージド | JSONB、GINインデックス対応 |
| pgvector | ✅ 公式拡張 | AI埋め込み検索 |
| Realtime | ✅ 組み込み | WebSocket、Presence |
| Auth | ✅ 組み込み | OAuth、JWT、RLS連携 |
| Storage | ✅ 組み込み | S3互換、署名URL |
| Edge Functions | ✅ Deno/TS | AIエージェント実行 |
| RLS | ✅ 組み込み | 細粒度アクセス制御 |
| Claude MCP | ✅ 公式対応 | AIエージェント統合 |
| CRDT | △ 別途実装 | Yjs + Supabase Realtime |

### 6.1.2 対応不可/別途実装が必要な機能

| 機能 | 実装方法 |
|-----|---------|
| CRDT協調編集 | Yjs + Supabase Realtime + 定期Snapshot |
| Content Addressable Storage | Blobsテーブル + SHA-256ハッシュ |
| ワークフローエンジン | Temporal.io または自前実装 |
| 高度なスケジューリング | pg_cron + Edge Functions |
| 大規模ファイル | Supabase Storage + CDN |

## 6.2 実装アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Client Layer                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐   │
│  │  VSCode Extension │  │   Next.js Web     │  │   Mobile App      │   │
│  │  (Cursor-style)   │  │   Dashboard       │  │   (React Native)  │   │
│  │                   │  │                   │  │                   │   │
│  │  - TreeView       │  │  - Dashboard      │  │  - Task List      │   │
│  │  - Editor Panels  │  │  - Board View     │  │  - Quick Actions  │   │
│  │  - AI Panel       │  │  - Timeline       │  │  - Notifications  │   │
│  │  - Diff View      │  │  - Reports        │  │                   │   │
│  └─────────┬─────────┘  └─────────┬─────────┘  └─────────┬─────────┘   │
│            │                      │                      │              │
│            └──────────────────────┼──────────────────────┘              │
│                                   │                                     │
│                       ┌───────────▼───────────┐                         │
│                       │  @supabase/supabase-js │                         │
│                       │  + Custom Hooks        │                         │
│                       └───────────┬───────────┘                         │
│                                   │                                     │
└───────────────────────────────────┼─────────────────────────────────────┘
                                    │
                    REST / Realtime WebSocket / Storage
                                    │
┌───────────────────────────────────▼─────────────────────────────────────┐
│                         Supabase Platform                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      Edge Functions (Deno)                       │   │
│  │                                                                  │   │
│  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐       │   │
│  │  │ ai-orchestrator│ │generate-embed  │ │ execute-action │       │   │
│  │  │                │ │                │ │                │       │   │
│  │  │ Claude API     │ │ OpenAI/Cohere  │ │ Tool Execution │       │   │
│  │  │ Tool Selection │ │ Embedding API  │ │ DB Operations  │       │   │
│  │  │ Context Build  │ │                │ │                │       │   │
│  │  └────────────────┘ └────────────────┘ └────────────────┘       │   │
│  │                                                                  │   │
│  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐       │   │
│  │  │ webhook-handler│ │ cron-scheduler │ │ file-processor │       │   │
│  │  └────────────────┘ └────────────────┘ └────────────────┘       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                         PostgreSQL                               │   │
│  │                                                                  │   │
│  │  Extensions: pgvector, pg_cron, pgmq, pg_net                    │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │                    Core Tables                            │   │   │
│  │  │                                                           │   │   │
│  │  │  entities          entity_edges       entity_versions     │   │   │
│  │  │  ├─ id             ├─ source_id       ├─ id               │   │   │
│  │  │  ├─ entity_type    ├─ target_id       ├─ entity_id        │   │   │
│  │  │  ├─ name           ├─ edge_type       ├─ blob_hash        │   │   │
│  │  │  ├─ attributes     ├─ attributes      ├─ parent_version   │   │   │
│  │  │  ├─ embedding      └─ position        ├─ commit_message   │   │   │
│  │  │  └─ search_vector                     └─ created_by_ai    │   │   │
│  │  │                                                           │   │   │
│  │  │  blobs (CAS)       ai_agents          ai_actions          │   │   │
│  │  │  ├─ hash (PK)      ├─ id              ├─ id               │   │   │
│  │  │  ├─ content        ├─ agent_type      ├─ agent_id         │   │   │
│  │  │  └─ storage_url    ├─ llm_config      ├─ status           │   │   │
│  │  │                    ├─ system_prompt   ├─ proposed_changes │   │   │
│  │  │                    └─ permissions     └─ approved_by      │   │   │
│  │  │                                                           │   │   │
│  │  │  ai_conversations  ai_messages        ai_memories         │   │   │
│  │  │  ai_tools          activity_events    notifications       │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  │                                                                  │   │
│  │  Row Level Security Policies                                    │   │
│  │  ├─ organization-based access                                   │   │
│  │  ├─ project membership checks                                   │   │
│  │  └─ custom permission rules                                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐           │
│  │    Realtime    │  │      Auth      │  │    Storage     │           │
│  │                │  │                │  │                │           │
│  │  - Broadcast   │  │  - JWT/OAuth   │  │  - File Upload │           │
│  │  - Presence    │  │  - RLS Link    │  │  - CDN         │           │
│  │  - DB Changes  │  │  - MFA         │  │  - Signed URLs │           │
│  └────────────────┘  └────────────────┘  └────────────────┘           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ MCP (Model Context Protocol)
                                    │
┌───────────────────────────────────▼─────────────────────────────────────┐
│                           AI Provider Layer                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │                    Anthropic Claude API                         │    │
│  │                                                                 │    │
│  │  Model: claude-sonnet-4-20250514                               │    │
│  │  Features: Tool Use, Streaming, Long Context                   │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │                    OpenAI Embedding API                         │    │
│  │                                                                 │    │
│  │  Model: text-embedding-3-small (1536 dim)                      │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 6.3 結論: 実現可能性

**✅ 完全に実現可能**

TypeScript + PostgreSQL + Supabase の技術スタックで、以下のすべての要件を満たすことができる：

1. **Cursor風UI**: VSCode Extension + Webview で実現
2. **Asana Work Graph**: entities + entity_edges + マルチホーミング
3. **Gitバージョン管理**: entity_versions + blobs (CAS) + ブランチ
4. **AI-First**: Edge Functions + Claude API + Tool Use
5. **リアルタイム協調**: Supabase Realtime + Yjs
6. **スケーラビリティ**: PostgreSQL + pgvector + RLS

---

# 第7章: データモデル仕様

## 7.1 統一エンティティモデル

```sql
-- ============================================
-- Core: Unified Entity System
-- ============================================

CREATE TABLE entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    -- 'task', 'project', 'document', 'folder', 'meeting', 
    -- 'goal', 'milestone', 'section', 'team', 'ai_workflow'
    
    -- Core Attributes (Indexed, Always Columns)
    name VARCHAR(500) NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    assignee_id UUID REFERENCES auth.users(id),
    
    -- AI & Search
    embedding vector(1536),
    search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('english', name || ' ' || COALESCE(attributes->>'description', ''))
    ) STORED,
    
    -- Flexible Attributes (JSONB)
    attributes JSONB DEFAULT '{}',
    /* 
    Task: {
        description, due_date, start_date, priority, estimated_hours,
        completed_at, tags[], custom_fields: {}
    }
    Document: {
        content_type, language, word_count, last_edited_by
    }
    Project: {
        color, icon, default_view, is_template
    }
    */
    
    -- Versioning
    current_version_id UUID,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    
    -- Soft Delete
    deleted_at TIMESTAMPTZ
);

-- ============================================
-- Work Graph: Entity Relations (Edges)
-- ============================================

CREATE TABLE entity_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    edge_type VARCHAR(50) NOT NULL,
    -- 'membership': task → project (multi-homing)
    -- 'parent': subtask → parent task, folder → parent folder
    -- 'dependency': task → blocking task
    -- 'reference': task → document, task → meeting
    -- 'assignment': task → user/ai_agent
    -- 'goal_link': project → goal
    
    attributes JSONB DEFAULT '{}',
    /*
    membership: {section_id, position}
    dependency: {type: 'finish_to_start', lag_days: 0}
    assignment: {role: 'assignee', assigned_at: timestamp}
    */
    
    position INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(source_id, target_id, edge_type)
);

-- ============================================
-- Version Control: Git-like System
-- ============================================

CREATE TABLE blobs (
    hash VARCHAR(64) PRIMARY KEY,  -- SHA-256
    content BYTEA,                  -- < 1MB
    storage_url TEXT,               -- > 1MB (S3)
    storage_type VARCHAR(20) DEFAULT 'inline',
    content_type VARCHAR(100),
    size_bytes BIGINT,
    reference_count INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE entity_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES entities(id),
    version_number INTEGER NOT NULL,
    
    -- Content Addressable
    blob_hash VARCHAR(64) REFERENCES blobs(hash),
    attributes_snapshot JSONB,  -- 属性のスナップショット
    
    -- Git-like
    parent_version_id UUID REFERENCES entity_versions(id),
    merge_parent_id UUID REFERENCES entity_versions(id),
    branch VARCHAR(100) DEFAULT 'main',
    commit_message TEXT,
    commit_type VARCHAR(20) DEFAULT 'manual',
    -- 'manual', 'auto_save', 'ai_edit', 'merge', 'revert'
    
    -- AI Tracking
    created_by_ai_id UUID REFERENCES ai_agents(id),
    ai_edit_prompt TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    
    UNIQUE(entity_id, version_number)
);

CREATE TABLE entity_branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES entities(id),
    name VARCHAR(100) NOT NULL,
    head_version_id UUID REFERENCES entity_versions(id),
    is_default BOOLEAN DEFAULT false,
    is_protected BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(entity_id, name)
);

-- ============================================
-- AI System
-- ============================================

CREATE TABLE ai_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    name VARCHAR(200) NOT NULL,
    agent_type VARCHAR(50) NOT NULL,
    -- 'task_analyzer', 'document_editor', 'scheduler', 
    -- 'dependency_manager', 'orchestrator', 'custom'
    
    llm_config JSONB DEFAULT '{
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514",
        "temperature": 0.7,
        "max_tokens": 4096
    }',
    
    system_prompt TEXT,
    available_tools TEXT[],
    
    permissions JSONB DEFAULT '{
        "read": ["*"],
        "create": ["task", "subtask"],
        "update": ["task", "document"],
        "delete": [],
        "requires_approval": ["create", "update"]
    }',
    
    triggers JSONB DEFAULT '[]',
    /*
    [
        {
            "event": "entity.created",
            "conditions": {"entity_type": "task", "estimated_hours_gt": 8},
            "action": "suggest_breakdown"
        }
    ]
    */
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    parameters_schema JSONB NOT NULL,  -- OpenAI Function Calling format
    impl_type VARCHAR(20) NOT NULL,    -- 'internal', 'sql', 'http', 'agent'
    impl_config JSONB,
    required_permissions TEXT[],
    requires_approval BOOLEAN DEFAULT true,
    rate_limit_per_minute INTEGER DEFAULT 60,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES ai_agents(id),
    conversation_id UUID REFERENCES ai_conversations(id),
    
    tool_id UUID REFERENCES ai_tools(id),
    action_type VARCHAR(100) NOT NULL,
    target_entity_id UUID REFERENCES entities(id),
    target_entity_type VARCHAR(50),
    
    input_params JSONB,
    proposed_changes JSONB,  -- 提案された変更のプレビュー
    output_result JSONB,
    
    reasoning TEXT,  -- AIの推論説明
    
    status VARCHAR(20) DEFAULT 'pending',
    -- 'pending', 'approved', 'rejected', 'executing', 'completed', 'failed'
    
    requires_approval BOOLEAN DEFAULT true,
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,
    rejected_reason TEXT,
    
    -- LLM Tracking
    llm_messages JSONB,
    llm_response JSONB,
    token_usage JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    user_id UUID REFERENCES auth.users(id),
    agent_id UUID REFERENCES ai_agents(id),
    context_entity_id UUID REFERENCES entities(id),
    title VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id),
    role VARCHAR(20) NOT NULL,  -- 'user', 'assistant', 'system', 'tool'
    content TEXT,
    tool_calls JSONB,
    tool_call_id VARCHAR(100),
    attachments JSONB,  -- [{entity_id, type}]
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES ai_agents(id),
    memory_type VARCHAR(50) NOT NULL,
    -- 'fact', 'preference', 'pattern', 'context', 'summary'
    
    content TEXT NOT NULL,
    embedding vector(1536),
    importance DECIMAL(3,2) DEFAULT 0.5,
    
    -- Scope
    scope_organization_id UUID,
    scope_user_id UUID,
    scope_entity_id UUID,
    
    -- Usage Tracking
    access_count INTEGER DEFAULT 0,
    last_accessed TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ  -- 一時記憶用
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX idx_entities_org_type ON entities(organization_id, entity_type);
CREATE INDEX idx_entities_assignee ON entities(assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX idx_entities_embedding ON entities USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_entities_search ON entities USING gin(search_vector);
CREATE INDEX idx_entities_attributes ON entities USING gin(attributes);

CREATE INDEX idx_edges_source ON entity_edges(source_id, edge_type);
CREATE INDEX idx_edges_target ON entity_edges(target_id, edge_type);

CREATE INDEX idx_versions_entity ON entity_versions(entity_id, version_number DESC);
CREATE INDEX idx_versions_branch ON entity_versions(entity_id, branch, created_at DESC);

CREATE INDEX idx_ai_actions_status ON ai_actions(status, created_at);
CREATE INDEX idx_ai_actions_target ON ai_actions(target_entity_id, status);

CREATE INDEX idx_ai_memories_embedding ON ai_memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_ai_memories_scope ON ai_memories(scope_organization_id, scope_user_id);
```

## 7.2 マルチホーミング実装

```sql
-- タスクを複数プロジェクトに所属させる
INSERT INTO entity_edges (source_id, target_id, edge_type, attributes, position)
VALUES 
    ('task-123', 'project-A', 'membership', '{"section_id": "section-1"}', 0),
    ('task-123', 'project-B', 'membership', '{"section_id": "section-5"}', 3),
    ('task-123', 'project-C', 'membership', '{"section_id": null}', 0);

-- プロジェクトのタスク一覧取得
CREATE FUNCTION get_project_tasks(p_project_id UUID)
RETURNS TABLE (
    task_id UUID,
    task_name VARCHAR,
    section_id UUID,
    position INTEGER,
    attributes JSONB,
    all_projects JSONB  -- マルチホーミング情報
)
LANGUAGE sql STABLE AS $$
    SELECT 
        e.id,
        e.name,
        (ee.attributes->>'section_id')::UUID,
        ee.position,
        e.attributes,
        (
            SELECT jsonb_agg(jsonb_build_object(
                'project_id', p.id,
                'project_name', p.name,
                'section_id', ee2.attributes->>'section_id'
            ))
            FROM entity_edges ee2
            JOIN entities p ON p.id = ee2.target_id
            WHERE ee2.source_id = e.id 
              AND ee2.edge_type = 'membership'
        ) as all_projects
    FROM entities e
    JOIN entity_edges ee ON e.id = ee.source_id
    WHERE ee.target_id = p_project_id
      AND ee.edge_type = 'membership'
      AND e.entity_type = 'task'
      AND e.deleted_at IS NULL
    ORDER BY ee.position;
$$;
```

---

# 第8章: UI仕様（Cursor風）

## 8.1 画面構成

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  [≡] AI Work Platform                                    [🔍] [🔔 3] [👤]      │
├────────┬────────────────────────────────────────────────────────┬───────────────┤
│        │                                                        │               │
│ Activity│                    Editor Area                        │   AI Panel    │
│  Bar   │                                                        │               │
│        │ ┌──────────────────────────────────────────────────┐  │ ┌───────────┐ │
│ ┌────┐ │ │ [📋 Task: API設計] [📄 仕様書.md] [+]             │  │ │  Context  │ │
│ │ 📊 │ │ ├──────────────────────────────────────────────────┤  │ │ ───────── │ │
│ │Work│ │ │                                                  │  │ │ @task:    │ │
│ │Graph│ │ │  # API設計                                       │  │ │ API設計   │ │
│ └────┘ │ │                                                  │  │ │           │ │
│ ┌────┐ │ │  ## 概要                                         │  │ │ @project: │ │
│ │ ☑ │ │ │  REST APIの設計を行う                            │  │ │ Backend   │ │
│ │Tasks│ │ │                                                  │  │ └───────────┘ │
│ └────┘ │ │  ## サブタスク                                    │  │               │
│ ┌────┐ │ │  - [ ] エンドポイント定義 (3h)                   │  │ ┌───────────┐ │
│ │ 📄 │ │ │  - [ ] スキーマ設計 (3h)                         │  │ │   Chat    │ │
│ │Docs │ │ │  - [ ] 認証方式決定 (2h)                        │  │ │ ───────── │ │
│ └────┘ │ │                                                  │  │ │ 🤖: タスク │ │
│ ┌────┐ │ │  ## 依存関係                                     │  │ │ を分析しま │ │
│ │ 📅 │ │ │  ← Blocked by: 要件定義完了                      │  │ │ した。3つ  │ │
│ │Meet │ │ │  → Blocking: 実装開始                           │  │ │ のサブタス │ │
│ └────┘ │ │                                                  │  │ │ クに分解す │ │
│ ┌────┐ │ │  ─────────────────────────────────────────────── │  │ │ ることを提 │ │
│ │ 🤖 │ │ │  AI Activity                                     │  │ │ 案します   │ │
│ │Agent│ │ │  [🤖 Pending] サブタスク3件の作成を提案中        │  │ │           │ │
│ └────┘ │ │  [✅ Apply] [❌ Dismiss] [📝 Edit]               │  │ │ [________] │ │
│        │ │                                                  │  │ │ [↵ Send]  │ │
│        │ └──────────────────────────────────────────────────┘  │ └───────────┘ │
│        │                                                        │               │
│        │ ┌──────────────────────────────────────────────────┐  │ ┌───────────┐ │
│        │ │ Proposed Changes                      [Diff View] │  │ │ Proposed  │ │
│        │ │ ────────────────────────────────────────────────  │  │ │ ───────── │ │
│        │ │ ➕ CREATE Subtask: エンドポイント定義              │  │ │ ☑ Subtask │ │
│        │ │    Est: 3h | Assigned: @AI-suggest               │  │ │ ☑ Subtask │ │
│        │ │                                                  │  │ │ ☑ Subtask │ │
│        │ │ ➕ CREATE Subtask: スキーマ設計                   │  │ │ ☑ Update  │ │
│        │ │    Est: 3h | Assigned: @AI-suggest               │  │ │           │ │
│        │ │                                                  │  │ │[Apply All]│ │
│        │ │ 📝 UPDATE Task                                   │  │ │[Select...]│ │
│        │ │    estimated_hours: null → 8h                    │  │ └───────────┘ │
│        │ └──────────────────────────────────────────────────┘  │               │
├────────┴────────────────────────────────────────────────────────┴───────────────┤
│ [AI: Active ●] [Sync: ✓] [2 pending] [Branch: main] [v12]                       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 8.2 TreeView（サイドバー）

```
📊 Work Graph
├── 🎯 Goals
│   ├── Q4 売上目標達成
│   │   └── 📈 Progress: 67%
│   └── 新規顧客獲得
│
├── 📁 Projects
│   ├── 📂 Website Redesign [On Track]
│   │   ├── 📋 Design Phase
│   │   │   ├── ☑ Create wireframes [@John] [Due: 12/5]
│   │   │   │   └── 📄 wireframes.fig (v3) [🤖 edited]
│   │   │   ├── ⏳ Design review [🤖 Suggested: @Sarah]
│   │   │   └── ○ Finalize mockups
│   │   │
│   │   └── 📋 Development Phase
│   │       ├── ○ Setup React [Blocked by: Design review]
│   │       └── ○ API Integration
│   │
│   ├── 📂 Mobile App [At Risk]
│   │   └── ...
│   │
│   └── 📂 + New Project
│
├── 📄 Documents
│   ├── 📁 Specifications
│   │   ├── 📄 API仕様書.md (v5)
│   │   └── 📄 DB設計書.md (v3)
│   └── 📁 Meeting Notes
│
└── 🤖 AI Workflows
    ├── Sprint Planning Assistant
    └── Code Review Helper
```

## 8.3 インタラクションフロー

### 8.3.1 タスク作成フロー（AI支援）

```
User: [⌘N] New Task
         │
         ▼
┌─────────────────────────────┐
│ Task Name: [API設計      ]  │
│                             │
│ 💡 AI Suggestions:          │
│ • Add to "Backend" project? │
│ • Similar tasks found (3)   │
│ • Suggested estimate: 8h    │
│                             │
│ [Create] [Create with AI]   │
└─────────────────────────────┘
         │
         │ [Create with AI]
         ▼
AI Agent processes...
         │
         ▼
┌─────────────────────────────┐
│ AI Analysis Complete        │
│ ─────────────────────────── │
│ Based on similar tasks:     │
│ • 推奨見積もり: 8h          │
│ • 推奨サブタスク: 3件       │
│ • 推奨担当者: @TechLead     │
│ • 関連ドキュメント: 2件     │
│                             │
│ [Apply All] [Customize]     │
└─────────────────────────────┘
```

### 8.3.2 インラインAI編集（⌘K）

```
User selects text in document
         │
         ▼
User: [⌘K]
         │
         ▼
┌─────────────────────────────┐
│ What would you like to do?  │
│ [この部分を詳しく説明して   ]│
│                             │
│ [Generate]                  │
└─────────────────────────────┘
         │
         ▼
AI generates suggestion
         │
         ▼
┌─────────────────────────────────────────────┐
│ Current:                                    │
│ │ APIの設計を行う                           │
│ ├─────────────────────────────────────────  │
│ │ Suggested (AI):                           │
│ │ REST APIの設計を行う                      │
│ │                                           │
│ │ ## エンドポイント                         │
│ │ - GET /api/v1/tasks                       │
│ │ - POST /api/v1/tasks                      │
│ │ - PUT /api/v1/tasks/:id                   │
│ │ ...                                       │
│ │                                           │
│ │ [✅ Accept] [❌ Reject] [📝 Edit]        │
└─────────────────────────────────────────────┘
```

---

# 第9章: 機能一覧と優先順位

## 9.1 Phase 1: Core Foundation (4週間)

| # | 機能 | 説明 | 優先度 |
|---|-----|------|--------|
| 1.1 | Entity基盤 | entities, entity_edges テーブル、CRUD API | P0 |
| 1.2 | 認証/認可 | Supabase Auth + RLS | P0 |
| 1.3 | 組織/チーム | organization, team 管理 | P0 |
| 1.4 | VSCode Extension骨格 | TreeDataProvider、基本Webview | P0 |
| 1.5 | 型定義/SDK | TypeScript型自動生成 | P0 |

## 9.2 Phase 2: Work Graph (4週間)

| # | 機能 | 説明 | 優先度 |
|---|-----|------|--------|
| 2.1 | プロジェクト管理 | プロジェクトCRUD、セクション | P0 |
| 2.2 | タスク管理 | タスクCRUD、属性、フィルタ | P0 |
| 2.3 | マルチホーミング | 1タスク→複数プロジェクト | P0 |
| 2.4 | 依存関係 | タスク間の依存関係設定 | P1 |
| 2.5 | リストビュー | タスクリスト表示 | P0 |
| 2.6 | ボードビュー | カンバンボード | P1 |
| 2.7 | カスタムフィールド | 動的フィールド追加 | P1 |

## 9.3 Phase 3: Document & Versioning (4週間)

| # | 機能 | 説明 | 優先度 |
|---|-----|------|--------|
| 3.1 | Content Addressable Storage | blobs テーブル、ハッシュベース | P0 |
| 3.2 | バージョン履歴 | entity_versions、履歴表示 | P0 |
| 3.3 | Diff表示 | 変更前後の比較 | P1 |
| 3.4 | Monaco Editor統合 | ドキュメント編集 | P0 |
| 3.5 | ブランチ機能 | 作業ブランチ、マージ | P2 |
| 3.6 | 基本CRDT | Yjs統合、協調編集の基盤 | P1 |

## 9.4 Phase 4: AI Integration (6週間)

| # | 機能 | 説明 | 優先度 |
|---|-----|------|--------|
| 4.1 | AI Agent基盤 | ai_agents, ai_tools テーブル | P0 |
| 4.2 | Claude API統合 | Edge FunctionでLLM呼び出し | P0 |
| 4.3 | Tool実行基盤 | Function Calling、ツール実行 | P0 |
| 4.4 | 承認フロー | ai_actions、承認/拒否UI | P0 |
| 4.5 | AI Panel UI | チャットUI、提案表示 | P0 |
| 4.6 | コンテキスト収集 | 関連エンティティ、類似検索 | P1 |
| 4.7 | タスク分析Agent | タスク分解、見積もり | P1 |
| 4.8 | インラインAI (⌘K) | テキスト選択→AI編集 | P1 |
| 4.9 | AI Memory | 長期記憶、パターン学習 | P2 |
| 4.10 | トリガー自動実行 | イベント駆動AI起動 | P2 |

## 9.5 Phase 5: Advanced Features (4週間)

| # | 機能 | 説明 | 優先度 |
|---|-----|------|--------|
| 5.1 | タイムライン/ガント | 期間ベースビュー | P1 |
| 5.2 | ワークロード | 稼働状況可視化 | P2 |
| 5.3 | ゴール管理 | OKR/目標追跡 | P2 |
| 5.4 | ポートフォリオ | プロジェクト横断管理 | P2 |
| 5.5 | 高度な検索 | フルテキスト + セマンティック | P1 |
| 5.6 | 通知システム | リアルタイム通知 | P1 |
| 5.7 | AIワークフロー | カスタムAIフロー定義 | P3 |
| 5.8 | レポート/ダッシュボード | 集計、可視化 | P2 |

---

# 第10章: 成功指標

## 10.1 技術的成功指標

| 指標 | 目標値 |
|-----|-------|
| API応答時間 (p95) | < 200ms |
| AI提案生成時間 | < 3秒 |
| リアルタイム同期遅延 | < 500ms |
| 類似検索精度 | > 85% |
| 同時接続ユーザー | 1,000+ |
| データベースサイズ | 100GB+ 対応 |

## 10.2 ユーザー体験指標

| 指標 | 目標値 |
|-----|-------|
| AI提案の承認率 | > 70% |
| タスク作成時間短縮 | -50% |
| 手動更新の削減 | -40% |
| ドキュメント作成時間 | -60% |
| ユーザーあたりAI利用回数 | 20+/日 |

---

# 付録A: 用語集

| 用語 | 定義 |
|-----|------|
| Entity | タスク、プロジェクト、ドキュメント等の統一データ単位 |
| Edge | エンティティ間の関係（所属、依存、参照等） |
| Multi-homing | 1つのタスクが複数プロジェクトに同時所属できる機能 |
| Work Graph | エンティティとエッジで構成される作業のグラフ構造 |
| AI Action | AIエージェントが提案/実行する操作とその監査記録 |
| CAS | Content Addressable Storage、内容のハッシュをキーとする保存方式 |
| Diff View | 変更前後を比較表示するビュー |
| Tool | AIエージェントが実行できる具体的な操作（Function Calling） |

---

# 付録B: 参考資料

1. Asana Work Graph®: https://asana.com/resources/work-graph
2. Asana API Object Hierarchy: https://developers.asana.com/docs/object-hierarchy
3. Cursor Features: https://cursor.com/features
4. Supabase pgvector: https://supabase.com/docs/guides/ai
5. Git Version Control: https://git-scm.com/book
6. Anthropic Claude API: https://docs.anthropic.com

---

**文書バージョン:** 1.0
**作成日:** 2024年12月
**最終更新:** 2024年12月
