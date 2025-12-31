# Alcon

> AI駆動型組織ワークマネジメントプラットフォーム

**重要な視点**: このツールは「開発者が組織を作る」のではなく、「ユーザーが自分の組織構造を自由に構築し、プロジェクトを管理する」ためのもの。設計時は常に俯瞰して抽象化し、特定のユースケースに縛られない柔軟性を持たせること。

---

## 哲学的背景：ハンナ・アーレント「人間の条件」

アーレントは人間の活動を3つに分類した：

| 概念 | 原語 | 内容 |
|------|------|------|
| **労働 (Labor)** | Labor | 生命維持のための反復的活動。消費されて何も残らない |
| **仕事 (Work)** | Work | 耐久的な人工物を作る。世界に「モノ」を残す創造的営み |
| **活動 (Action)** | Action | 他者と共に公共空間で何かを始める。政治的・人間的営み |

### 問題の本質

現代ホワイトカラーの多くは「仕事に見える労働」をしている：

```
労働（本来は標準化可能）
  ↓ 道具がバラバラ（Slack, Excel, Notion...）
  ↓ 解釈の余地が発生（属人化）
  ↓ 労働なのに「仕事的コスト」が発生
  ↓ 生産性の低下
```

### Alconの解決策

**労働の最小単位を統一する。**

> 「労働を標準化し、人間を創造と活動に解放する」

---

## 技術スタック

- **Frontend**: Next.js 16 (App Router, Turbopack)
- **Backend**: Supabase (PostgreSQL, Auth, Edge Functions, Realtime)
- **Deployment**: Vercel
- **AI**: Claude API via Supabase Edge Functions
- **Supabase Project ID**: `rkugtcqztkkacvoylupw`

# Project Context
- Stack: TypeScript, Next.js (App Router), Tailwind CSS, Zod, React Query
- Style: Functional Components, Hooks-based state management
- Testing: Vitest, React Testing Library

# Commands
- Dev Server: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Test: `npm test`
- Type Check: `npm run type-check`

# Code Style Guidelines
## TypeScript
- **Strict Typing**: Never use `any`. Use `unknown` if necessary and narrow types.
- **Interfaces vs Types**: Use `type` for unions/primitives, `interface` for object definitions and extendability.
- **Null Handling**: Use Optional Chaining (`?.`) and Nullish Coalescing (`??`) over explicit null checks.
- **Async**: Always use `async/await` over raw `.then()`.

## React / Components
- **Naming**: PascalCase for components/files (e.g., `UserProfile.tsx`). camelCase for hooks/utils.
- **Props**: Destructure props in the function signature.
- **Composition**: Avoid large monolithic components. Extract sub-components to the same file if small, or separate files if reusable.
- **Hooks**: Use custom hooks to separate logic from view.

## Styling (Tailwind)
- Use utility classes over inline styles.
- Use `clsx` or `tailwind-merge` for conditional class names.

# Architecture & Directories
- `/app`: App Router pages and layouts.
- `/components/ui`: Generic UI components (buttons, inputs).
- `/components/features`: Domain-specific components.
- `/lib`: Utility functions and shared logic.
- `/hooks`: Custom React hooks.
- `/types`: Shared type definitions (if not co-located).

# Output Rules
- Be concise. Explain only complex logic.
- When modifying code, always show the context or the full file if it's small.
- Prioritize readability and maintainability over clever one-liners.

---

## 6層構造

| 層 | アイコン | 説明 | DBテーブル |
|---|---|---|---|
| **System** | 立方体3つ | 最上位ワークスペース | `systems` |
| **Object** | 立方体1つ | 実体・個体（自己生成可能） | `hierarchy_nodes` (level: 'object') |
| **Structure** | ∴ 点3つ | グループ・構造（自己生成不可） | `hierarchy_nodes` (level: 'structure') |
| **Unit** | ○○ 点2つ | Elementsのまとまり | `hierarchy_nodes` (level: 'unit') |
| **Elements** | — | 最小作業単位 | `elements` |
| **Subelements** | ○ | Elementsの構成要素 | `subelements` |

### 階層ルール

```typescript
export const HIERARCHY_RULES = {
  system: ['object', 'structure', 'unit'],
  object: ['object', 'structure', 'unit'],  // 自己生成可能
  structure: ['unit'],  // 自己生成不可
  unit: [],
} as const
```

### なぜ「Task」ではなく「Elements」か？

業界によって扱う単位が異なる：
- IT企業 → タスク
- 病院 → 患者
- 営業 → 案件

抽象的な「Elements」なら、どの業界でも違和感なく使える。


## データベーススキーマ

```sql
systems (id, name, description, created_at, updated_at)

hierarchy_nodes (
  id, system_id, parent_id,
  level,  -- 'object' | 'structure' | 'unit'
  name, description, color, order_index,
  created_at, updated_at
)

elements (
  id, unit_id, title, description,
  status,  -- 'todo' | 'in_progress' | 'review' | 'done' | 'blocked'
  priority,  -- 'low' | 'medium' | 'high' | 'urgent'
  due_date, estimated_hours, actual_hours, order_index,
  created_at, updated_at
)

subelements (id, element_id, title, is_completed, order_index, created_at, updated_at)

workers (
  id, node_id,
  type,  -- 'human' | 'ai_agent'
  name, role, email, avatar_url, ai_model, ai_config, status,
  created_at, updated_at
)

element_assignees (id, element_id, worker_id, role, assigned_at)
```

---

---

## 開発コマンド

```bash
npm run dev       # 開発サーバー起動
npm run build     # 本番ビルド
npx vercel --prod # 本番デプロイ
```
