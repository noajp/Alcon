# Alcon Design System

> 全文脈統合型ビジネスOS。Domain / Object / Element の入れ子構造を、高密度かつ静謐な暗色UIで操作する。

---

## 0. 設計原則 (Design Principles)

**個別トークンはここから演繹される。判断に迷ったら原則に戻る。**

1. **Surface Hierarchy by Opacity, not Saturation**
   階層は彩度ではなく明度のみで表現する。色はアクセントと意味記号のためにだけ温存される。
2. **Borders over Shadows**
   要素分離は1pxの罫線で行う。影は使わない（モーダル/ポップオーバー以外）。
3. **Density with Whitespace, not Compression**
   情報密度は「文字を詰める」のではなく「無駄な装飾を削る」ことで生まれる。タップターゲットは最低32pxを保つ。
4. **One Accent, Many Greys**
   アクセント色は1色のみ。状態色（success/warning/danger）も明度ベースで弱く効かせる。
5. **Type before Color**
   ヒエラルキーはフォントウェイトと明度で表現する。色を使うのはインタラクションと意味通知のときだけ。

---

## 1. Color

Alconはブランドカラーとして **007 Daniel Craig 映画** のビジュアルから抽出した4色を採用する。
LCHは明度が知覚的に均一なため、L値だけ動かせば自動で良い階層になる。

### 1.1 Brand Palette (固定・テーマ非依存)

| 名前 | 役割 | LCH | Hex |
| :--- | :--- | :--- | :--- |
| **Oxford Midnight** | Accent — primary action, selection, links | `lch(26 38 270)` | `#163964` |
| **Forest** | Status / Success — Current, Done | `lch(45 38 142)` | `#3d7a4a` |
| **Amber** | Status / Warning — 期限間近, 注意 | `lch(67 70 82)` | `#d49a1a` |
| **Blood** | Status / Danger — 失敗, Destructive | `lch(38 58 30)` | `#a3221c` |

> Oxford Midnight は Casino Royale タキシード裏地。マットなまま発色を強化した深い知的な青。
> Forest は針葉樹の濃緑。Amber は Skyfall の琥珀。Blood はオレンジ味を抜いた血の赤。

### 1.2 Accent Variants

| Token | 値 | 用途 |
| :--- | :--- | :--- |
| `accent.default` | `lch(26 38 270)` / `#163964` | ボタン塗り / 選択バー / リンク（ライト） |
| `accent.hover` | `lch(40 38 270)` / `#1e4d8a` | hover 状態 / ダーク時のアイコン・テキストリンク |
| `accent.subtle` | `lch(26 38 270 / 0.12)` | 選択行背景 / バッジ背景 |

> `accent.default` は L26 と暗め。ダークモードでテキスト/アイコン単体に使う場合は `accent.hover` (L40) を使う。

### 1.3 Status Variants

各ステータスには `.subtle` バリアント（同色 / opacity 0.12）を必ず用意する。
バッジ背景は subtle、ドット/アイコンは default を使う。

| Token | Hex | subtle |
| :--- | :--- | :--- |
| `status.success` | `#3d7a4a` | `rgba(61, 122, 74, 0.12)` |
| `status.warning` | `#d49a1a` | `rgba(212, 154, 26, 0.12)` |
| `status.danger` | `#a3221c` | `rgba(163, 34, 28, 0.12)` |
| `status.info` | `#163964` (= accent) | `rgba(22, 57, 100, 0.12)` |

### 1.4 Surface — Light Theme

| Token | Hex | 用途 |
| :--- | :--- | :--- |
| `surface.bg` | `#f6f5f2` | ページ背景（温かみのあるクリーム） |
| `surface.muted` | `#efede8` | サイドバー / 非アクティブ領域 |
| `surface.raised` | `#ffffff` | カード / リスト行 hover |
| `surface.strong` | `#f0eee9` | モーダル背景 |
| `surface.overlay` | `#ffffff` | ポップオーバー / メニュー |

### 1.5 Surface — Dark Theme (default)

| Token | Hex | 用途 |
| :--- | :--- | :--- |
| `surface.bg` | `#0d0e11` | ページ背景 |
| `surface.muted` | `#15171b` | サイドバー / 非アクティブ領域 |
| `surface.raised` | `#1d1f24` | カード / リスト行 hover |
| `surface.strong` | `#252830` | モーダル / コマンドパレット |
| `surface.overlay` | `#2d3038` | ポップオーバー / メニュー |

### 1.6 Border

| Token | Light | Dark |
| :--- | :--- | :--- |
| `border.subtle` | `rgba(20, 22, 26, 0.10)` | `rgba(255, 255, 255, 0.08)` |
| `border.default` | `#d0cdc8` | `#2e3038` |
| `border.strong` | `#b8b4ae` | `#3d4048` |

### 1.7 Text

| Token | Light | Dark |
| :--- | :--- | :--- |
| `text.primary` | `#14161a` | `#ececea` |
| `text.secondary` | `#3a3d44` | `#a8aab0` |
| `text.tertiary` | `#6c707a` | `#6e7178` |
| `text.disabled` | `#a8aab0` | `#4a4d54` |

---

## 2. Typography

### 2.1 Family

```
font.sans = "Inter Variable", -apple-system, "SF Pro Display", system-ui, sans-serif
font.mono = "JetBrains Mono", "Berkeley Mono", ui-monospace, monospace
```

`font.mono` は コード片 / Object ID (`obj_AP` 等) / キーボードショートカット表示にのみ使う。

### 2.2 Scale

| Token | Size | Line Height | Weight | 用途 |
| :--- | :--- | :--- | :--- | :--- |
| `text.xs` | `11px` | `16px` | `500` | uppercase ラベル / メタ |
| `text.sm` | `12px` | `16px` | `400` | サブテキスト / アイコン横テキスト |
| `text.base` | `13px` | `20px` | `400` | **本文 / リスト行 (default)** |
| `text.md` | `14px` | `20px` | `400` | フォーム入力 / ボタン |
| `text.lg` | `15px` | `22px` | `500` | セクション見出し |
| `text.xl` | `18px` | `26px` | `600` | サブページタイトル |
| `text.2xl` | `22px` | `30px` | `600` | ページタイトル |
| `text.3xl` | `28px` | `36px` | `600` | 主要ランディング（Domains画面等） |

> 情報密度の高さを優先して **13px をデフォルト**とする。

### 2.3 Letter Spacing

- `tracking.tight` = `-0.01em`：見出し（lg以上）
- `tracking.normal` = `0`：本文
- `tracking.wide` = `0.08em`：uppercase ラベル（`KEY DECISIONS` 等）

### 2.4 Weight Map

| Weight | 値 | 用途 |
| :--- | :--- | :--- |
| `regular` | `400` | 本文 |
| `medium` | `500` | ラベル / アクティブな項目 |
| `semibold` | `600` | 見出し / 強調 |

`700` 以上は使わない。

---

## 3. Spacing & Layout

### 3.1 Spacing Scale (4pt グリッド)

| Token | Value |
| :--- | :--- |
| `space.1` | `4px` |
| `space.2` | `8px` |
| `space.3` | `12px` |
| `space.4` | `16px` |
| `space.5` | `24px` |
| `space.6` | `32px` |
| `space.7` | `48px` |
| `space.8` | `64px` |

> すべて4の倍数。`15px` `10px` 等の例外を作らない。

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
| `size.tap` | `32px` (min) | クリック可能領域の最小値 |

### 3.3 Radius

| Token | Value | 用途 |
| :--- | :--- | :--- |
| `radius.xs` | `4px` | バッジ / 小タグ |
| `radius.sm` | `6px` | ボタン / 入力 / リスト行 |
| `radius.md` | `8px` | カード |
| `radius.lg` | `12px` | モーダル / コマンドパレット |
| `radius.full` | `9999px` | アバター / ピル |

### 3.4 Layout Skeleton

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
- **Sidebar**: `240px` デフォルト、リサイズ可（`200px`〜`360px`）。
- **Main**: 残り全幅。Content 領域は `max-width: 1200px`、両側 padding `24px`。

---

## 4. Iconography

Lucide React を採用。

### 4.1 Rules

- **Stroke width**: `1.5px` 固定（Lucide のデフォルト 2 から細める）
- **Size**: `14 / 16 / 20px` のみ
- **Color**: 単独使用時は `text.tertiary`、選択中は `text.primary`、accent 要素は `accent.default`
- **Filled 状態は使わない**

### 4.2 標準アイコンマップ

| 用途 | Lucide Icon |
| :--- | :--- |
| Home | `Home` |
| Note / Brief | `FileText` |
| Comment | `MessageSquare` |
| Domain | `Globe` |
| Object | `Box` |
| Element | `Atom` |
| Settings | `Settings` |
| New / Add | `Plus` |
| Search | `Search` |
| Command Palette | `Command` |
| Logout | `LogOut` |

> 同じ概念には必ず同じアイコンを使う。`Object` が場所によって `Box` / `Cube` / `Package` にバラつくのは禁止。

---

## 5. Components

### 5.1 Interaction States (必須7状態)

| State | Visual Spec |
| :--- | :--- |
| `default` | セマンティックトークン通り |
| `hover` | 背景を `surface.raised` に / 1ステップ明るく |
| `focus-visible` | `outline: 2px solid accent.hover` + `outline-offset: 2px` |
| `active` | `transform: scale(0.98)` + `transition: 80ms` |
| `selected` | 背景 `accent.subtle` + 左 border 2px `accent.default` |
| `disabled` | `opacity: 0.4` + `pointer-events: none` |
| `loading` | スピナー or skeleton |

### 5.2 Button

| Variant | 背景 | テキスト | Border |
| :--- | :--- | :--- | :--- |
| `primary` | `accent.default` | `#ffffff` | none |
| `secondary` | `surface.raised` | `text.primary` | `1px border.default` |
| `ghost` | transparent | `text.secondary` | none |
| `destructive` | `status.danger` | `#ffffff` | none |

- 高さ: `32px` / 大きいボックス `36px`
- パディング: 横 `12px`、small `8px`
- Radius: `6px`
- フォント: `14px` / weight `500`
- アイコン+テキスト時は gap `8px`

### 5.3 List Row (Elements / Objects)

```
┌────────────────────────────────────────────────────────┐
│  [::]  [☐]  🔷 嘘でしょ           @user  Amber  Current  obj_AP
└────────────────────────────────────────────────────────┘
```

- 高さ: `32px` (default) / `28px` (dense)
- 行間 border: `1px solid border.subtle`
- 内部 gap: `12px`
- hover 全行背景: `surface.raised`
- ドラッグハンドル / チェックボックスは hover 時のみ完全表示（default は `opacity: 0.4`）

### 5.4 Sidebar Item

- 高さ: `28px`
- 横 padding: `8px`
- アイコン+テキスト gap: `8px`
- インデント: 階層1段あたり `12px`
- 選択時: 背景 `surface.raised` + テキスト `text.primary`
- 折りたたみアイコン: `14px`

### 5.5 Card

- 背景: `surface.raised`
- Border: `1px solid border.default`
- Radius: `8px`
- Padding: `16px`
- hover: `border.strong` に変化、背景は変えない
- **影は使わない**（モーダル・ポップオーバーは除く）

### 5.6 Section Header

- フォント: `11px` / weight `500` / uppercase
- 文字色: `text.tertiary`
- letter-spacing: `0.08em`
- 上下マージン: 上 `24px` / 下 `12px`

---

## 6. Motion

| Token | Duration | Easing | 用途 |
| :--- | :--- | :--- | :--- |
| `motion.instant` | `80ms` | `ease-out` | active 押下 / トグル |
| `motion.fast` | `120ms` | `ease-out` | hover / focus |
| `motion.base` | `180ms` | `cubic-bezier(0.4, 0, 0.2, 1)` | パネル開閉 |
| `motion.slow` | `280ms` | `cubic-bezier(0.4, 0, 0.2, 1)` | モーダル / コマンドパレット |

- Reduced Motion 時: すべて `80ms linear` に短縮

---

## 7. Accessibility (WCAG 2.2 AA)

- **コントラスト比**: `text.primary` on `surface.bg` で 7:1 以上を維持
- **タップターゲット**: 最小 `32×32px`
- **Focus ring**: `accent.hover` の 2px アウトライン必須。`outline: none` の一括無効化は禁止
- **Keyboard-First**:
  - `Cmd+K` / `Ctrl+K` でコマンドパレット
  - `Tab` 順: 左上→右下、ナビ→サイド→メイン
  - すべての行は `↑ ↓` で移動、`Enter` で開く、`Esc` で閉じる
- **ARIA**: Domain/Object/Element 階層は `role="tree"` + `aria-expanded` + `aria-level`

---

## 8. Anti-Patterns (禁止事項)

1. **Raw Hex 直書き** — `color: #163964` ではなく `color: var(--accent-default)`
2. **One-off spacing** — `padding: 15px` は禁止。必ず4の倍数から選ぶ
3. **小数px サイズ** — `13.33px` `2.5px` 等は使わない
4. **複数アクセント色** — Oxford Midnight 以外をアクセントに使わない
5. **影で階層** — `box-shadow` は禁止。階層は明度と border で
6. **`#000000` 背景** — `surface.bg` (`#0d0e11`) を使う
7. **fontWeight 700+** — `600` まで
8. **`em` 単位** — フォントは全て `px`（`letter-spacing` のみ `em` 可）
9. **意味のない曲線アニメ** — motion tokens 以外の `cubic-bezier` は使わない
10. **アイコンの filled 版** — Lucide の outline 版のみ
11. **`outline: none !important` の一括無効化** — アクセシビリティ違反

---

## 9. Naming & Terminology

| 概念 | 表記 | 禁止表記 |
| :--- | :--- | :--- |
| Domain | "Domain" / "ドメイン" | "System" "Workspace" "Project" |
| Object | "Object" / "オブジェクト" | "Folder" "Group" |
| Element | "Element" / "エレメント" | "Item" "Task" "Issue" |
| 確定保存 | "Element を更新" | "保存" "Save" |
| 削除 | "Element を削除" | "Delete" "Remove" |
| 新規作成 | "Object 化" / "Element 化" | "Create" "Add" |

---

## 10. QA Checklist

- [ ] すべての色が `var(--*)` 参照になっているか（Raw Hex なし）
- [ ] すべての余白が 4px の倍数か
- [ ] すべてのフォントサイズがスケール内か（小数なし）
- [ ] interactive 要素に7状態すべて実装されているか
- [ ] focus-visible が `accent.hover` の 2px アウトラインか
- [ ] タップターゲットが `32px` 以上か
- [ ] アイコンが Lucide で stroke-width 1.5px か
- [ ] Surface 階層が `bg < muted < raised < strong < overlay` の順か
- [ ] 影を使っていないか（モーダル除く）
- [ ] アクセント色が Oxford Midnight 1色だけか
- [ ] `Cmd+K` でコマンドパレットが開くか
- [ ] Reduced Motion 設定が反映されるか

---

## Appendix: CSS Variables

```css
:root {
  /* Brand */
  --accent-default: #163964;
  --accent-hover: #1e4d8a;
  --accent-subtle: rgba(22, 57, 100, 0.12);

  --status-success: #3d7a4a;
  --status-success-subtle: rgba(61, 122, 74, 0.12);
  --status-warning: #d49a1a;
  --status-warning-subtle: rgba(212, 154, 26, 0.12);
  --status-danger: #a3221c;
  --status-danger-subtle: rgba(163, 34, 28, 0.12);

  /* Surface — Light */
  --surface-bg: #f6f5f2;
  --surface-muted: #efede8;
  --surface-raised: #ffffff;
  --surface-strong: #f0eee9;
  --surface-overlay: #ffffff;

  /* Border — Light */
  --border-subtle: rgba(20, 22, 26, 0.10);
  --border-default: #d0cdc8;
  --border-strong: #b8b4ae;

  /* Text — Light */
  --text-primary: #14161a;
  --text-secondary: #3a3d44;
  --text-tertiary: #6c707a;
  --text-disabled: #a8aab0;

  /* Spacing */
  --space-1: 4px;   --space-2: 8px;   --space-3: 12px;
  --space-4: 16px;  --space-5: 24px;  --space-6: 32px;
  --space-7: 48px;  --space-8: 64px;

  /* Radius */
  --radius-xs: 4px;  --radius-sm: 6px;
  --radius-md: 8px;  --radius-lg: 12px;

  /* Motion */
  --motion-instant: 80ms ease-out;
  --motion-fast: 120ms ease-out;
  --motion-base: 180ms cubic-bezier(0.4, 0, 0.2, 1);
  --motion-slow: 280ms cubic-bezier(0.4, 0, 0.2, 1);
}

.dark {
  /* Surface — Dark */
  --surface-bg: #0d0e11;
  --surface-muted: #15171b;
  --surface-raised: #1d1f24;
  --surface-strong: #252830;
  --surface-overlay: #2d3038;

  /* Border — Dark */
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-default: #2e3038;
  --border-strong: #3d4048;

  /* Text — Dark */
  --text-primary: #ececea;
  --text-secondary: #a8aab0;
  --text-tertiary: #6e7178;
  --text-disabled: #4a4d54;
}
```
