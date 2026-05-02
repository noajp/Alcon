# Alcon UI Refactoring Plan
## Linear-Inspired Design System

> 目標: Linearのような「速くて、美しくて、キーボードファーストな」プロフェッショナルツールに仕上げる

---

## 1. デザイン哲学

### Linear から学ぶ 5 原則

| 原則 | Linear の実装 | Alcon への適用 |
|------|-------------|--------------|
| **Chrome を消す** | サイドバーは超薄く、コンテンツ最大化 | アイコンバー 40px → 32px、ボーダー極限まで薄く |
| **情報密度** | 13px・行間1.4・コンパクトな行高 | 現行13pxを維持しつつ余白を整える |
| **暗黒優先** | 深いダークモードが主役 | `#0d0e11` ベースを強化、ライトも洗練 |
| **動きは控えめ** | 80〜150ms、ease-out のみ | `--motion-fast: 100ms` に統一、跳ねアニメ禁止 |
| **色は意味だけ** | グレースケール支配、色は状態表示のみ | アクセント使用を Status/Priority に限定 |

---

## 2. カラーシステム刷新

### 現状の問題点
- `--accent-default: #163964` (Oxford Midnight) がナビ背景・ボタン・リンクに多用され「重い」
- ライトモードの `--surface-bg: #f6f5f2` (温かみあるオフホワイト) は良いが surface 間の差が薄い
- ダークモードのテキストコントラストが若干不足

### 新カラーパレット方針

```
Light Mode (Warm Neutral — 現行を引き継ぎ洗練)
─────────────────────────────────────────────
--surface-bg:       #f7f6f3   現行維持 (温かみのある紙白)
--surface-muted:    #eeece7   少し深める
--surface-raised:   #ffffff   純白で明確な差別化
--surface-strong:   #e8e5de   hover/selected 用
--surface-overlay:  #ffffff   + box-shadow 代わりに border

--border-subtle:    rgba(20,22,26, 0.06)   より透明に
--border-default:   rgba(20,22,26, 0.12)
--border-strong:    rgba(20,22,26, 0.22)

--text-primary:     #111318   少し青みを加えてLiearっぽく
--text-secondary:   #3c404a
--text-tertiary:    #6b7080
--text-placeholder: #9ca3af

Dark Mode (Deep Neutral — Linear に近づける)
────────────────────────────────────────────
--surface-bg:       #0e0f12   Linear の #0f0f10 に近い
--surface-muted:    #141519   サイドバー背景
--surface-raised:   #1c1e24   カード/モーダル
--surface-strong:   #23262e   hover 状態
--surface-overlay:  #2a2d36   ドロップダウン

--border-subtle:    rgba(255,255,255, 0.05)
--border-default:   rgba(255,255,255, 0.09)
--border-strong:    rgba(255,255,255, 0.16)

--text-primary:     #e8e9ec
--text-secondary:   #9fa3ae
--text-tertiary:    #5c6070
--text-disabled:    #3d404a

Accent (絞り込む)
─────────────────
--accent-default:   #5c7cfa   ← Oxford Midnight から Blue Violet に変更
--accent-hover:     #4c6ef5
--accent-subtle:    rgba(92, 124, 250, 0.12)
--accent-text:      #7c9dff   (dark mode でのテキスト accent)

※ Brand カラーの Oxford Midnight (#163964) は logo/splash のみに使用。
  インタラクティブ要素は Blue Violet 系に統一してクリアに。
```

### Status カラー (変更なし — すでに良い)
```
success: #3d7a4a  (Forest)   → badge bg: rgba(61,122,74,0.12)
warning: #d49a1a  (Amber)    → badge bg: rgba(212,154,26,0.12)
danger:  #a3221c  (Blood)    → badge bg: rgba(163,34,28,0.12)
```

---

## 3. タイポグラフィ

### 現状
- Inter Variable 13px ベース — 良い
- スケールが細かすぎて一部不統一

### 刷新スケール
```
--font-size-xs:   11px / lh 1.45   (メタ情報、タイムスタンプ)
--font-size-sm:   12px / lh 1.5    (バッジ、キャプション)
--font-size-base: 13px / lh 1.55   (本文 — 変更なし)
--font-size-md:   14px / lh 1.5    (ラベル、見出し小)
--font-size-lg:   16px / lh 1.4    (セクション見出し)
--font-size-xl:   20px / lh 1.3    (ページタイトル)
--font-size-2xl:  24px / lh 1.25   (大見出し)

font-weight:
  regular:  400  (本文)
  medium:   500  (UI ラベル — Linearはほぼ500に統一)
  semibold: 600  (見出し)
  bold:     700  (強調 — 最小限)

letter-spacing:
  uppercase labels: 0.04em  (ALL CAPS の場合のみ)
  normal: 0 (デフォルト)
```

---

## 4. スペーシング & レイアウト

### 4px グリッド厳守
```
--space-1:  4px
--space-2:  8px
--space-3:  12px
--space-4:  16px
--space-5:  20px   ← 24px から変更。Linearは20pxが頻出
--space-6:  28px   ← 32px から変更
--space-7:  40px
--space-8:  56px
```

### コンポーネント高さ規則
```
行高 (row height):
  compact:  28px  (密なリスト)
  default:  32px  (標準行 — Linearの基準)
  relaxed:  36px  (カード内など)
  tall:     40px  (ヘッダー内アクション)

入力フィールド:
  sm:  28px
  md:  32px  (デフォルト)
  lg:  36px

ボタン:
  xs:  24px h / px-8
  sm:  28px h / px-10
  md:  32px h / px-12  (デフォルト)
  lg:  36px h / px-16
```

---

## 5. サイドバー刷新 (AppSidebar)

### 現状の問題点
- アイコンバーの幅と余白が不統一
- ホバー/アクティブ状態が弱い
- システムスイッチャーが目立ちすぎる

### Linear スタイルへの変更

```
Layout:
  icon bar width: 48px (現40pxより少し余裕を持たせる)
  icon size: 16px (現行通り)
  icon button: 32x32px, border-radius: 6px
  icon button padding: 8px

Active State (現行を強化):
  background: var(--surface-strong)      (subtle な塗り)
  color: var(--text-primary)
  左端に 2px の accent line は使わない → Linearは塗りのみ

Inactive State:
  color: var(--text-tertiary)
  hover → color: var(--text-secondary), bg: var(--surface-strong) @ 60%

System Switcher:
  位置: 上部固定 (現行通り)
  サイズ: 28x28px アバター
  ホバー: border var(--border-strong)

Bottom Actions (Theme / Settings / Logout):
  サイズ縮小: 28x28px ボタン
  区切り: separator なし → 自然なグルーピング

Transition:
  show/hide: 150ms ease-out (現行より速く)
```

---

## 6. トップバー / ツールバー刷新

### 現状の問題点
- BreadcrumbBar と TabBar が視覚的に重なって見える
- ツールバーのボタンが大きすぎる

### 構造再設計

```
TopBar (高さ: 40px → 36px に縮小):
  左: BreadcrumbBar (13px, text-secondary)
  右: 共有・通知・アバター (28px ボタン群)
  border-bottom: 1px solid var(--border-subtle)
  background: var(--surface-bg) / backdrop-filter: blur(8px)

TabBar (高さ: 36px):
  タブ文字: 12px, font-weight: 500
  アクティブ: text-primary, border-bottom: 2px solid var(--accent-default)
  非アクティブ: text-tertiary, hover → text-secondary
  タブ間 padding: 0 12px
  背景は TopBar と同色 (分離感を出さない)

Toolbar (高さ: 32px、TopBarの下に折りたたみ):
  ボタン高さ: 26px (現行より小さく)
  gap: 4px
  セパレータ: 1px, height: 16px, var(--border-default)
```

---

## 7. カードシステム刷新

### Linear の Card 特徴
- border: 1px solid — 影なし (すでに Alcon も同方針)
- border-radius: 6px (sharp より少しだけ丸い)
- hover: border が強くなる + background が微妙に明るくなる
- 選択: left accent border (2px) OR background color

### Alcon Card 規則

```css
.card-base {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);  /* 6px */
  background: var(--surface-raised);
  transition: border-color var(--motion-fast), background var(--motion-fast);
}

.card-base:hover {
  border-color: var(--border-default);
  background: var(--surface-strong);  /* ごくわずかに暗く */
}

.card-base.selected {
  border-color: var(--accent-default);
  background: var(--accent-subtle);
}

/* Element行 (リスト内) */
.row-base {
  height: 32px;
  padding: 0 8px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background var(--motion-instant);
}

.row-base:hover {
  background: var(--surface-strong);
}
```

---

## 8. ステータス & プライオリティ インジケーター

### Linear スタイルの Status Dot

```
現行: アイコン + テキスト (重い)
新:   6px colored dot + テキスト (軽い、Linearと同様)

Status Dot サイズ:
  inline (リスト内): w-2 h-2 (8px)
  detail (詳細カード): w-2.5 h-2.5 (10px)

Priority Icon:
  現行のアイコンは維持
  サイズ: 14px → 13px に統一
  色: var(--text-tertiary) → priority color に変更

Badge スタイル:
  height: 18px
  padding: 0 6px
  font-size: 11px
  font-weight: 500
  border-radius: var(--radius-full)
  border: 1px solid (color@30%)
  background: (color@10%)
```

---

## 9. モーションシステム刷新

### 原則: Linear は「速く、控えめ」

```css
/* 削除するアニメーション */
- bounce, spring, scale-in (ポップ感のあるもの全般)
- 200ms 超のトランジション (レイアウト変化を除く)
- Framer Motion の spring physics (ページ遷移を除く)

/* 維持するアニメーション */
--motion-instant: 80ms ease-out      /* hover状態変化 */
--motion-fast:    120ms ease-out     /* show/hide, dropdown */
--motion-base:    180ms ease-in-out  /* ページ内遷移 */
--motion-layout:  220ms ease-in-out  /* レイアウト変化 */

/* 新設: fade + slide-up (Linear のページ遷移に近い) */
@keyframes enter-up {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
/* duration: 150ms, easing: ease-out */
```

---

## 10. コマンドパレット (新規追加)

### Linear の核心機能

```
Cmd+K でグローバル検索 + アクション
  - Objects / Elements / Notes を横断検索
  - ビュー切り替え (> go to projects, > go to home)
  - Element 作成 (> create element)
  - システム切り替え

UI 仕様:
  幅: 560px
  最大高さ: 400px (スクロール)
  backdrop: blur(20px) + rgba(0,0,0,0.4)
  border-radius: 10px
  border: 1px solid var(--border-default)
  shadow: 0 24px 48px rgba(0,0,0,0.24)

入力:
  height: 48px
  font-size: 16px
  placeholder: "Search or type a command..."
  icon: ⌘ (12px, text-tertiary)

結果行:
  height: 36px
  padding: 0 12px
  selected: background var(--surface-strong)
  icon: 16px, margin-right: 8px
  kbd hint: 右端 (font-mono, 10px, text-tertiary)
```

---

## 11. ビュー別リファクタリング優先度

| ビュー | 現状 | 優先度 | 変更内容 |
|--------|------|--------|---------|
| **AppSidebar** | アイコンバー | 🔴 最高 | 幅・余白・状態の整理 |
| **Elements Table** | スプレッドシート | 🔴 最高 | 行高32px、ヘッダー簡素化 |
| **TopBar + TabBar** | 重複感あり | 🔴 最高 | 統合・高さ削減 |
| **Overview Dashboard** | Widget Grid | 🟡 高 | カードスタイル刷新 |
| **Object Tree (サイドバー)** | 折りたたみツリー | 🟡 高 | indentガイド、行高28px |
| **BluePrint Cards** | Ticket可視化 | 🟡 高 | カードの角丸・border統一 |
| **Gantt** | チャート | 🟢 中 | バー色・グリッド線 |
| **Calendar** | 月/週/日 | 🟢 中 | セルの情報密度向上 |
| **Command Palette** | 未実装 | 🔴 最高 | 新規実装 |

---

## 12. 実装フェーズ計画

### Phase 1 — Foundation (1-2日)
```
[ ] globals.css: カラートークン更新
[ ] globals.css: タイポグラフィスケール更新
[ ] globals.css: モーション変数更新
[ ] designTokens.ts: 新トークンに同期
[ ] globals.css: btn / badge / input の基本スタイル刷新
```

### Phase 2 — Shell (1-2日)
```
[ ] AppSidebar: アイコンバー幅・余白・状態スタイル
[ ] TopBar: 高さ削減・背景blur
[ ] TabBar: タブスタイル Linear化
[ ] BreadcrumbBar: フォントサイズ・色
```

### Phase 3 — Content (2-3日)
```
[ ] Elements Table: 行高・ヘッダー・ステータスドット
[ ] Object Tree (MyObjectsSidebar): インデント・行高
[ ] Overview Widgets: カードスタイル刷新
[ ] BluePrint Cards: border・shadow 整理
```

### Phase 4 — Interactions (1-2日)
```
[ ] Command Palette (Cmd+K) 実装
[ ] Framer Motion アニメーション整理
[ ] Keyboard shortcut バー (底部に表示)
[ ] 空状態 (Empty State) のイラスト/テキスト統一
```

---

## 13. Linear と差別化する Alcon 固有の要素

Linearをそのままコピーするのでなく、Alconらしさを保つ点:

| 要素 | Linear | Alcon 独自 |
|------|--------|-----------|
| ブランドカラー | Purple | Oxford Midnight (ロゴ・スプラッシュのみ) |
| コンセプト | Issues/Projects | S/O/E 6概念 (業界横断) |
| Widget Grid | なし | Overview の可変グリッド |
| Gantt | なし | ガントチャートビュー |
| AI統合 | Copilot風 | AIパネル + Edge Functions |
| データ密度 | Issue中心 | Element の多軸タグ管理 |

---

## 14. 参考実装ノート

### Linear の CSS 特徴 (観察から)
```
- font-feature-settings: "cv01", "cv02", "cv03"  (Inter の文字形を最適化)
- -webkit-font-smoothing: antialiased  (必須)
- tab-size: 2  (コード表示)
- selection: bg: var(--accent-subtle)

- border の代わりに outline: 1px solid を使うケースあり
  (layout shiftを防ぐため)

- scrollbar-width: thin  (Firefox)
- ::-webkit-scrollbar: width 6px  (すでに実装済み)
```

### 実装時の注意
1. `recharts` は `'use client'` 必須 — SSR で壊れる
2. カラートークン変更後は `designTokens.ts` と `globals.css` を必ず同期
3. `npm run type-check` を各フェーズ終了時に実行
4. ダークモード切り替えは `.dark` クラス付与で動作 (ThemeProvider 経由)
5. `var(--motion-fast)` を Framer Motion の `duration` に渡す場合は `0.12` (秒単位)
