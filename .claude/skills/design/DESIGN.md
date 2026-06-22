# Alcon Design System

> 全文脈統合型ビジネス OS。Domain / Object / Element の入れ子構造を、高密度かつ静謐な暗色 UI で操作する。
> 本デザインシステムは **Linear の公開デザイン言語と Linear Method を土台**にしている。判断に迷ったら「Linear ならどうするか」に立ち返る。

---

## 0. 設計原則 (Design Principles)

**個別トークンはここから演繹される。原則 → トークン → 実装の順で考える。**

### 0.1 Linear に学ぶプロダクト哲学

Linear Method から、UI/UX 判断に直結する原則を採用する。

1. **Quality / Craft First** — 品質が第一原則。他の全指標はそこから派生する。"taste-driven development"：確信と職人性で判断し、ピクセル単位まで磨く。妥協した UI を出さない。
2. **Opinionated, not Configurable** — Apple 的に「変えられる部分」を絞る。無限にカスタマイズできるツールは何にも最適化できない。良いデフォルトを強く提示する。
3. **Built for Speed** — 速度は機能。楽観的更新・即応・キーボード先行。体感速度を損なう装飾・アニメ・遷移を入れない。
4. **Purpose-Built & Clarity** — 目的に対して設計する。用語を発明しすぎない／一貫させる。視線の流れは一方向、1 画面 1 主題。
5. **Simple First, Then Powerful** — 最初は単純に始められ、スケールに従って強くなる。初見の認知負荷を最小化する。

### 0.2 ビジュアル原則

1. **Surface Hierarchy by Luminance, not Saturation**
   階層は彩度ではなく明度（luminance stacking）で表現する。暗色面ほど「上に乗るほど明るく」する。色はアクセントと意味記号のためにだけ温存する。
2. **Borders & Luminance over Shadows**
   面内の要素分離は 1px の半透明白罫線と明度差で行う。ドロップシャドウはポップオーバー/モーダルのみ（§6）。
3. **Density with Whitespace, not Compression**
   情報密度は「文字を詰める」のではなく「無駄な装飾を削る」ことで生む。クリック可能領域は最低 32px（粗ポインタ時 44px）。
4. **One Accent, Many Greys**
   アクセントは Indigo 1 色のみ。1 画面のプライマリアクションは原則 1 つ。状態色は意味記号としてのみ、弱く効かせる。
5. **Type before Color**
   ヒエラルキーはフォントウェイト（510/590）と明度で表現する。色を使うのはインタラクションと意味通知のときだけ。

---

## 1. Color

Linear の **LCH ベースのテーマ生成思想**を採用する。LCH は知覚的に均一（L 値が同じなら人間の目に同じ明るさに見える）なため、L 値だけ動かせば自動で良い階層になる。

> **3 変数テーマ**：理想は `base color` / `accent color` / `contrast` の 3 つだけを定義し、border・elevation・surface はそこから算出すること。アクセントを 1 変数差し替えるだけで全体がリブランドできる（将来カスタムブランド色を入れる場合もこの 1 点だけ変える）。

### 1.1 Accent (Indigo — 唯一のブランド/インタラクション色)

| Token | Hex | 用途 |
| :--- | :--- | :--- |
| `accent.default` | `#5e6ad2` | ボタン塗り / 選択 / リンク / フォーカス基色 |
| `accent.hover` | `#828fff` | hover 状態のみ（depth-of-interaction シグナル） |
| `accent.active` | `#a8b1ff` | 押下/アクティブの最明部・ダーク上のテキストリンク |
| `accent.subtle` | `rgba(94, 106, 210, 0.15)` | 選択行背景 / バッジ背景 |

> Indigo `#5e6ad2` 以外をアクセントに使わない。`#828fff` は **hover 専用**。プライマリボタンの地色に `#828fff` を使わない。

### 1.2 Status (意味記号のみ — 一般 UI の装飾に使わない)

各ステータスに `.subtle` バリアント（同色 / opacity 0.15）を必ず用意する。バッジ背景は subtle、ドット/アイコンは default。

| Token | Hex | subtle | Alcon 対応 |
| :--- | :--- | :--- | :--- |
| `status.success` | `#27a644` | `rgba(39, 166, 68, 0.15)` | Current / Done |
| `status.warning` | `#f59e0b` | `rgba(245, 158, 11, 0.15)` | 期限間近 / 注意 |
| `status.danger` | `#e53935` | `rgba(229, 57, 53, 0.15)` | 失敗 / Destructive |
| `status.info` | `#5e6ad2` | `rgba(94, 106, 210, 0.15)` | = accent |

### 1.3 Surface — Dark Theme (default · luminance stacking)

暗色面は **下が暗く、上に乗るほど明るく**。canvas → chrome → island → 強調面 → overlay の順に明度を上げる。

| Token | Hex | 用途 |
| :--- | :--- | :--- |
| `surface.bg` | `#08090a` | ページ最背面（canvas） |
| `surface.muted` | `#0f1011` | サイドバー / アプリ chrome / 非アクティブ領域 |
| `surface.raised` | `#191a1b` | カード / リスト行 hover / ポップオーバー地 |
| `surface.strong` | `#1f2023` | 入力 / モーダル地 / 強調面 |
| `surface.overlay` | `#232427` | メニュー最前面 |

> カードは solid 値の代わりに **`rgba(255,255,255,0.05)` のルミナンス積層**でもよい。ポップオーバー/モーダルだけは solid `#191a1b` + シャドウ（§6）。
> **`#000000` 背景は禁止** — canvas は `#08090a`。

### 1.4 Surface — Light Theme

クールなオフホワイト基調（Linear のライトは暖色クリームではない）。

| Token | Hex | 用途 |
| :--- | :--- | :--- |
| `surface.bg` | `#f7f8f8` | ページ背景 |
| `surface.muted` | `#ebeced` | サイドバー / 非アクティブ領域 |
| `surface.raised` | `#ffffff` | カード / リスト行 hover |
| `surface.strong` | `#ffffff` | モーダル背景（border で分離） |
| `surface.overlay` | `#ffffff` | ポップオーバー / メニュー |

### 1.5 Border (半透明 — dark は白、light は黒の alpha 階調)

| Token | Dark | Light |
| :--- | :--- | :--- |
| `border.micro` | `rgba(255, 255, 255, 0.02)` | `rgba(8, 9, 10, 0.04)` |
| `border.subtle` | `rgba(255, 255, 255, 0.05)` | `rgba(8, 9, 10, 0.06)` |
| `border.default` | `rgba(255, 255, 255, 0.08)` | `rgba(8, 9, 10, 0.10)` |
| `border.strong` | `rgba(255, 255, 255, 0.12)` | `rgba(8, 9, 10, 0.16)` |

> **ダークモードで罫線を solid hex 直書きしない** — 必ず `rgba(255,255,255,…)`。背景明度が変わっても破綻しない。

### 1.6 Text

| Token | Dark | Light | コントラスト(dark) |
| :--- | :--- | :--- | :--- |
| `text.primary` | `#f7f8f8` | `#08090a` | 18.9:1 |
| `text.secondary` | `#d0d6e0` | `#2c2e33` | 12.4:1 |
| `text.tertiary` | `#8a8f98` | `#6b7280` | 5.4:1 |
| `text.disabled` | `#62666d` | `#a0a3a8` | 3.1:1（装飾/無効のみ） |

> `text.disabled` (`#62666d`) は AA を満たさない。**情報テキストに使わない**（装飾/disabled 専用）。

---

## 2. Typography

### 2.1 Family

```
font.sans    = "Inter Variable", -apple-system, system-ui, sans-serif
font.display = "Inter Display", "Inter Variable", system-ui, sans-serif   /* 見出し */
font.mono    = "Berkeley Mono", "JetBrains Mono", ui-monospace, monospace
```

- **`font-feature-settings: "cv01", "ss03"` をグローバルに必須適用**（cv01 = single-story 'a'、ss03 = geometric alternates）。これが Linear の字面の核。Inter から feature を外さない。
- 見出しは **Inter Display**（表情を足しつつ可読性維持）、本文は Inter。
- `font.mono` は コード片 / Object ID (`obj_AP` 等) / キーボードショートカット / 技術メタにのみ使う。Berkeley Mono はライセンス必要 → 無い環境は JetBrains Mono にフォールバック。

### 2.2 Weight Map (510 がシグネチャ)

| Weight | 値 | 用途 |
| :--- | :--- | :--- |
| `regular` | `400` | 本文 / 読み物 |
| `ui` | **`510`** | **ボタン / ラベル / ナビ / UI 全般（シグネチャ。500・600 で代用しない）** |
| `strong` | `590` | カードタイトル / 強調 / display |

> `510` は Regular と Medium の間の「精密だが太くない」声。**Inter *Variable* 必須**（static Inter では出ない）。
> `700` 以上は使わない。大きな display はむしろ `400`〔=抑制した権威〕も可。

### 2.3 Scale (13px base · 高密度)

| Token | Size | Line Height | Weight | 用途 |
| :--- | :--- | :--- | :--- | :--- |
| `text.xs` | `11px` | `16px` | `510` | uppercase ラベル / メタ |
| `text.sm` | `12px` | `16px` | `400` | サブテキスト / アイコン横テキスト |
| `text.base` | `13px` | `20px` | `400` | **本文 / リスト行 (default)** |
| `text.md` | `14px` | `20px` | `510` | フォーム入力 / ボタン / ナビ |
| `text.lg` | `15px` | `22px` | `510` | セクション見出し |
| `text.xl` | `18px` | `26px` | `590` | サブページタイトル |
| `text.2xl` | `22px` | `30px` | `590` | ページタイトル |
| `text.3xl` | `28px` | `36px` | `590` | 主要ランディング（Domains 画面等） |

> 情報密度を優先して **13px をデフォルト**とする。

### 2.4 Progressive Letter-Spacing (大きいほど詰める)

サイズに応じて負のトラッキングを段階適用する。

| Size | Tracking |
| :--- | :--- |
| `28px+` | `-0.704px`（≈ `-0.025em`） |
| `20–22px` | `-0.24px` |
| `16–18px` | `-0.165px` |
| `14px 以下` | `0`（normal） |
| uppercase ラベル | `+0.08em`（wide） |

---

## 3. Spacing & Layout

### 3.1 Spacing Scale (4pt グリッド)

| Token | Value |    | Token | Value |
| :--- | :--- | :--- | :--- | :--- |
| `space.1` | `4px` |  | `space.5` | `24px` |
| `space.2` | `8px` |  | `space.6` | `32px` |
| `space.3` | `12px` |  | `space.7` | `40px` |
| `space.4` | `16px` |  | `space.8` | `48px` |
| `space.4b` | `20px` |  | `space.9` | `64px` |

> すべて 4 の倍数。`15px` `10px` 等の例外を作らない。

### 3.2 Component Sizing

| Token | Value | 用途 |
| :--- | :--- | :--- |
| `size.row` | `32px` | リスト行高さ |
| `size.row-dense` | `28px` | 高密度ビュー |
| `size.input` | `32px` | 入力フィールド / ボタン高さ |
| `size.input-lg` | `36px` | コマンドパレット入力 |
| `size.icon-sm` | `14px` | インラインアイコン |
| `size.icon` | `16px` | デフォルトアイコン |
| `size.icon-lg` | `20px` | サイドバーアイコン |
| `size.tap` | `32px` (min) | クリック可能領域の最小値（粗ポインタ 44px） |

### 3.3 Radius

| Token | Value | 用途 |
| :--- | :--- | :--- |
| `radius.micro` | `2px` | タグ内ドット / 極小要素 |
| `radius.xs` | `4px` | バッジ / 小タグ |
| `radius.sm` | `6px` | ボタン / 入力 / リスト行 |
| `radius.md` | `8px` | カード |
| `radius.lg` | `12px` | モーダル / コマンドパレット / ポップオーバー |
| `radius.full` | `9999px` | アバター / ピル（バッジ・トグルのみ。ボタンに使わない） |

### 3.4 Layout Skeleton

Linear の "inverted L-shape"（グローバル chrome がメインコンテンツを囲う）に倣う。

```
┌────┬─────────────┬─────────────────────────────────────────┐
│ N  │  Sidebar    │  Main View                              │
│ a  │  240px      │                                         │
│ v  │             │  ┌─ Header (48px) ──────────────────┐  │
│ 4  │  - Section  │  └──────────────────────────────────┘  │
│ 8  │  - Trees    │  ┌─ Content (max-width 1200, p:24) ─┐  │
│ p  │  - Items    │  │                                  │  │
│ x  │             │  └──────────────────────────────────┘  │
└────┴─────────────┴─────────────────────────────────────────┘
```

- **Nav Rail**: `48px` 固定。アイコンのみ。
- **Sidebar**: `240px` デフォルト、リサイズ可（`200px`〜`360px`）。背景は `surface.muted`。
- **Main**: 残り全幅。Content 領域は `max-width: 1200px`、両側 padding `24px`。
- サイドバー/タブ内の label・icon・button は縦横とも整列させる（視覚ノイズ削減）。

---

## 4. Iconography

Lucide React を採用。

### 4.1 Rules

- **Stroke width**: `1.5px` 固定（Lucide デフォルト 2 から細める）
- **Size**: `14 / 16 / 20px` のみ
- **Color**: 単独使用時は `text.tertiary`、選択中は `text.primary`、accent 要素は `accent.default`
- **Filled 状態は使わない**（outline 版のみ）

### 4.2 標準アイコンマップ

| 用途 | Lucide Icon |  | 用途 | Lucide Icon |
| :--- | :--- | :--- | :--- | :--- |
| Home | `Home` |  | New / Add | `Plus` |
| Note / Brief | `FileText` |  | Search | `Search` |
| Comment | `MessageSquare` |  | Command Palette | `Command` |
| Domain | `Globe` |  | Settings | `Settings` |
| Object | `Box` |  | Logout | `LogOut` |
| Element | `Atom` |  | | |

> 同じ概念には必ず同じアイコン。`Object` が場所によって `Box` / `Cube` / `Package` にバラつくのは禁止。

---

## 5. Components

### 5.1 Interaction States (必須)

| State | Visual Spec |
| :--- | :--- |
| `default` | セマンティックトークン通り |
| `hover` | 背景を 1 段明るく（dark: `rgba(255,255,255,+0.02)`／`surface.raised`） |
| `focus-visible` | accent multi-layer ring（§5.8、**ただし input は除外** §5.3） |
| `active` | `transform: scale(0.98)` + `transition: 80ms` |
| `selected` | 背景 `accent.subtle` + 左 border 2px `accent.default` |
| `disabled` | `opacity: 0.4` + `pointer-events: none` |
| `loading` | スピナー or skeleton |

### 5.2 Button

| Variant | 背景 | テキスト | Border |
| :--- | :--- | :--- | :--- |
| `primary` | `accent.default` → hover `accent.hover` | `#f7f8f8` (510) | none |
| `secondary` | `surface.raised` | `text.primary` | `1px border.default` |
| `ghost` | transparent | `text.secondary` | none |
| `destructive` | `status.danger` | `#f7f8f8` | none |

- 高さ `32px`（大 `36px`）/ パディング 横 `16px`（small `8px`）/ Radius `6px`
- フォント `14px` / weight `510` / アイコン+テキスト gap `8px`
- Transition: `150ms background-color`

### 5.3 Input / Textarea / Contenteditable

入力系のフォーカスは無装飾。`<input>` / `<textarea>` / `[contenteditable]` に focus ring・枠・アウトラインを付けず、フォーカス時に border 色も変えない（明度のごく弱い変化のみ可）。`focus:ring-*` `focus:border-*` `focus-visible:outline-*` `focus-visible:ring-*` を新規コードで付けない。

- 背景: dark `rgba(255,255,255,0.02)` / `surface.strong`、padding `8px 12px`、radius `6px`、高さ `32px`

### 5.4 List Row (Elements / Objects)

```
┌────────────────────────────────────────────────────────┐
│  [::]  [☐]  🔷 嘘でしょ           @user  warn  Current  obj_AP
└────────────────────────────────────────────────────────┘
```

- 高さ `32px` (default) / `28px` (dense)、行間 border `1px solid border.subtle`、内部 gap `12px`
- hover 全行背景: `surface.raised`（dark は `rgba(255,255,255,0.03〜0.05)`）
- ドラッグハンドル / チェックボックスは hover 時のみ完全表示（default `opacity: 0.4`）

### 5.5 Sidebar Item

- 高さ `28px`、横 padding `8px`、アイコン+テキスト gap `8px`、インデント 階層 1 段 `12px`
- 選択時: 背景 `surface.raised` + テキスト `text.primary`、ラベル weight `510`
- 折りたたみアイコン `14px`

### 5.6 Card / Section Header

**Card** — 背景 `surface.raised`（or `rgba(255,255,255,0.05)`）/ border `1px border.subtle` / radius `8px` / padding `16〜24px`。hover で背景を `rgba(255,255,255,0.07)` に（150ms）、**影は使わない**。

**Section Header** — `11px` / weight `510` / uppercase / `text.tertiary` / letter-spacing `0.08em` / 上 `24px` 下 `12px`。

### 5.7 Status Pill / Badge

- Radius `9999px`、padding `4px 10px`（min-height `24px`）、font `12px` weight `510`
- 例: success → bg `status.success.subtle` / text `status.success`、neutral → bg `border.subtle` / text `text.secondary`

### 5.8 Focus Ring (button / link / role=button / キーボード行ナビ のみ)

```
box-shadow: 0 0 0 2px rgba(94,106,210,0.4), 0 0 0 4px rgba(94,106,210,0.2);
```

> input 系には適用しない（§5.3）。単層 `outline` ではなく上記 composite を使う。

---

## 6. Elevation & Shadows (Luminance Stacking)

**面内の階層はシャドウではなく明度で表す。ドロップシャドウはポップオーバー/モーダルだけ**（そこでは暗いシャドウ + inset 白罫線を併用）。

| Level | 背景 | Shadow |
| :--- | :--- | :--- |
| Card (面内) | `rgba(255,255,255,0.05)` | none |
| Popover | `#191a1b` | `0 4px 12px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255,255,255,0.08)` |
| Modal | `#191a1b` | `0 16px 48px rgba(0,0,0,0.2), 0 32px 72px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(255,255,255,0.1)` |

- Modal: radius `12px`、max-width `560px`、enter は opacity 0→1 + scale 0.96→1.0 / `300ms` easeOutQuart。

---

## 7. Motion

速度は機能。モーションは機能的に・短く。**bounce / spring は使わない。entrance は 300ms を超えない。**

| Token | Duration | Easing | 用途 |
| :--- | :--- | :--- | :--- |
| `motion.micro` | `100ms` | easeOutQuad | トグル / 微細変化 |
| `motion.fast` | `150ms` | easeOutQuad | hover / focus / ボタン |
| `motion.base` | `200ms` | easeOutQuad | 状態変化 / パネル開閉 |
| `motion.enter` | `300ms` | easeOutQuart | モーダル / ポップオーバー出現 |

```
easeOutQuad  = cubic-bezier(0.25, 0.46, 0.45, 0.94)   /* primary */
easeOutQuart = cubic-bezier(0.165, 0.84, 0.44, 1)     /* enter   */
```

- Reduced Motion 時: すべて `80ms linear` 相当に短縮。

---

## 8. Accessibility (WCAG 2.2 AA)

- **コントラスト**: `text.primary` on `surface.bg` ≈ 18.9:1。情報テキストは 4.5:1 以上（`text.disabled` は装飾/無効のみ）。
- **タップターゲット**: 最小 `32×32px`（粗ポインタ `44×44px`）。
- **Focus ring**: button/link/role=button は §5.8 の indigo composite。**input 系は付けない**（§5.3）。`outline:none` の一括無効化は禁止。
- **Keyboard-First**（Linear の核）:
  - `Cmd+K` / `Ctrl+K` でコマンドパレット
  - すべての行は `↑ ↓` 移動、`Enter` で開く、`Esc` で閉じる
  - Tab 順: ナビ → サイド → メイン、フォーカストラップ（モーダル）、skip-to-content
- **ARIA**: Domain/Object/Element 階層は `role="tree"` + `aria-expanded` + `aria-level`

---

## 9. Anti-Patterns (禁止事項)

1. **Raw Hex 直書き** — `var(--accent-default)` を使う。`color:#5e6ad2` は禁止
2. **ダークの罫線を solid hex で** — 必ず `rgba(255,255,255,…)`
3. **影で面内階層** — `box-shadow` は popover/modal のみ。階層は明度（luminance stacking）で
4. **`#000000` 背景** — canvas は `#08090a`
5. **複数アクセント色** — Indigo `#5e6ad2` 以外をアクセントにしない。`#828fff` は hover 専用
6. **weight 500/600 で代用** — UI は `510`、強調は `590`。`700+` 禁止
7. **Inter から OpenType feature を外す** — `cv01`/`ss03` 必須
8. **One-off spacing / 小数 px** — `15px` `13.33px` 等は禁止。4 の倍数のみ
9. **bounce / spring イージング** — 指定の easeOutQuad/Quart 以外を使わない。entrance >300ms 禁止
10. **アイコンの filled 版** — Lucide outline のみ、stroke 1.5px
11. **input/textarea/contenteditable に focus ring/枠/outline** — §5.3。`outline:none !important` の一括無効化も禁止
12. **ボタンに `radius.full`** — ピルはバッジ/トグルのみ
13. **3 行超の本文を中央揃え** — 左揃え

---

## 10. Naming & Terminology

| 概念 | 表記 | 禁止表記 |
| :--- | :--- | :--- |
| Domain | "Domain" / "ドメイン" | "Workspace" "Organization" |
| Object | "Object" / "オブジェクト" | "Folder" "Group" |
| Element | "Element" / "エレメント" | "Item" "Task" "Issue" |
| 確定保存 | "Element を更新" | "保存" "Save" |
| 削除 | "Element を削除" | "Delete" "Remove" |
| 新規作成 | "Object 化" / "Element 化" | "Create" "Add" |

---

## 11. QA Checklist

- [ ] すべての色が `var(--*)` 参照か（Raw Hex なし）
- [ ] ダークの罫線が `rgba(255,255,255,…)` か（solid hex なし）
- [ ] 面内の階層が明度（luminance）で表現され、影は popover/modal だけか
- [ ] アクセントが Indigo `#5e6ad2` 1 色か（hover のみ `#828fff`）
- [ ] UI テキストが weight `510`、強調 `590`、`700+` なしか
- [ ] Inter に `cv01`/`ss03` が効いているか
- [ ] すべての余白が 4px の倍数・フォントサイズがスケール内（小数なし）か
- [ ] interactive 要素に必須 state が実装されているか
- [ ] focus ring が button/link 系のみで、input には付いていないか
- [ ] タップターゲットが `32px` 以上か
- [ ] アイコンが Lucide stroke 1.5px / outline か
- [ ] Surface 階層が `bg < muted < raised < strong < overlay` の順か
- [ ] motion が 100–300ms / easeOutQuad・Quart で bounce なしか
- [ ] `Cmd+K` でコマンドパレットが開くか / Reduced Motion が反映されるか

---

## Appendix: CSS Variables

> Dark がデフォルト。理想は `--base` / `--accent` / `--contrast` の 3 変数から下記を算出すること（Linear の 3 変数テーマ）。当面は下記を直接定義する。

```css
:root {
  /* Accent (唯一のブランド/インタラクション色) */
  --accent-default: #5e6ad2;
  --accent-hover:   #828fff;   /* hover 専用 */
  --accent-active:  #a8b1ff;
  --accent-subtle:  rgba(94, 106, 210, 0.15);

  /* Status (意味記号のみ) */
  --status-success: #27a644;  --status-success-subtle: rgba(39, 166, 68, 0.15);
  --status-warning: #f59e0b;  --status-warning-subtle: rgba(245, 158, 11, 0.15);
  --status-danger:  #e53935;  --status-danger-subtle:  rgba(229, 57, 53, 0.15);
  --status-info:    #5e6ad2;  --status-info-subtle:    rgba(94, 106, 210, 0.15);

  /* Surface — Dark (default · luminance stacking) */
  --surface-bg:      #08090a;
  --surface-muted:   #0f1011;
  --surface-raised:  #191a1b;
  --surface-strong:  #1f2023;
  --surface-overlay: #232427;

  /* Border — Dark (白の alpha 階調) */
  --border-micro:   rgba(255, 255, 255, 0.02);
  --border-subtle:  rgba(255, 255, 255, 0.05);
  --border-default: rgba(255, 255, 255, 0.08);
  --border-strong:  rgba(255, 255, 255, 0.12);

  /* Text — Dark */
  --text-primary:   #f7f8f8;
  --text-secondary: #d0d6e0;
  --text-tertiary:  #8a8f98;
  --text-disabled:  #62666d;  /* 装飾/無効のみ — AA 非適合 */

  /* Spacing */
  --space-1: 4px;  --space-2: 8px;   --space-3: 12px; --space-4: 16px;
  --space-4b: 20px; --space-5: 24px; --space-6: 32px; --space-7: 40px;
  --space-8: 48px; --space-9: 64px;

  /* Radius */
  --radius-micro: 2px; --radius-xs: 4px; --radius-sm: 6px;
  --radius-md: 8px;    --radius-lg: 12px;

  /* Motion */
  --ease-out-quad:  cubic-bezier(0.25, 0.46, 0.45, 0.94);
  --ease-out-quart: cubic-bezier(0.165, 0.84, 0.44, 1);
  --motion-micro: 100ms var(--ease-out-quad);
  --motion-fast:  150ms var(--ease-out-quad);
  --motion-base:  200ms var(--ease-out-quad);
  --motion-enter: 300ms var(--ease-out-quart);

  /* Focus ring (button/link 系のみ — input は付けない) */
  --focus-ring: 0 0 0 2px rgba(94, 106, 210, 0.4), 0 0 0 4px rgba(94, 106, 210, 0.2);

  /* Typography */
  --font-sans:    "Inter Variable", -apple-system, system-ui, sans-serif;
  --font-display: "Inter Display", "Inter Variable", system-ui, sans-serif;
  --font-mono:    "Berkeley Mono", "JetBrains Mono", ui-monospace, monospace;
  --font-features: "cv01", "ss03";  /* Inter に常時適用 */
}

.light {
  /* Surface — Light (クールなオフホワイト) */
  --surface-bg:      #f7f8f8;
  --surface-muted:   #ebeced;
  --surface-raised:  #ffffff;
  --surface-strong:  #ffffff;
  --surface-overlay: #ffffff;

  /* Border — Light (黒の alpha 階調) */
  --border-micro:   rgba(8, 9, 10, 0.04);
  --border-subtle:  rgba(8, 9, 10, 0.06);
  --border-default: rgba(8, 9, 10, 0.10);
  --border-strong:  rgba(8, 9, 10, 0.16);

  /* Text — Light */
  --text-primary:   #08090a;
  --text-secondary: #2c2e33;
  --text-tertiary:  #6b7280;
  --text-disabled:  #a0a3a8;
}
```
