# ボタン / ソート / フィルタ — 基準と収斂案

調査日 2026-08-30。対象コード `web/src/`（worktree `ecstatic-chaplygin-e786ce`、読み取りのみ）。
外部調査は実際にブラウザで公開ページを開いて取得した。出典 URL のない主張は書かない。

---

## 1. 外部の実測値

### 1.1 shadcn/ui Button（このリポジトリの `ui/button.tsx` の元）

出典: `https://ui.shadcn.com/docs/components/button` / レジストリ実体 `https://ui.shadcn.com/r/styles/new-york-v4/button.json`（検証済）

階層は 6 つ。`default`（塗り）/ `secondary`（弱い塗り）/ `outline`（枠）/ `ghost`（透明）/ `destructive` / `link`。

サイズの実数（Tailwind クラスから換算）:

| size | 高さ | 左右 padding | 文字 | アイコン | 角丸 | gap |
|---|---|---|---|---|---|---|
| `xs` | 24px (`h-6`) | 8px (`px-2`) | 12px (`text-xs`) | 12px | 6px | 4px |
| `sm` | 32px (`h-8`) | 12px (`px-3`) | 14px | 16px | 6px | 6px |
| `default` | 36px (`h-9`) | 16px (`px-4`) | 14px | 16px | 6px | 8px |
| `lg` | 40px (`h-10`) | 24px (`px-6`) | 14px | 16px | 6px | 8px |

アイコン単独は正方形で本文サイズと同値: `icon-xs` 24 / `icon-sm` 32 / `icon` 36 / `icon-lg` 40。
アイコンを含むときは左右 padding を一段落とす（`has-[>svg]:px-3` など）。
状態: `disabled:opacity-50` + `pointer-events-none`、`transition-all`、focus は `focus-visible:ring-[3px]` + `focus-visible:border-ring`（**hover ではなく focus-visible にだけ**リングを出す）。
角丸は全サイズ 6px 固定 — サイズが変わっても角丸は変えない。

### 1.2 GitHub Primer（階層のルールと control 寸法）

出典: `https://primer.style/product/components/button/` および `https://primer.style/product/primitives/size/`（検証済）

階層は 4 つ + link。文言はほぼそのまま原則になる:
- **Primary** — 最優先の操作。*ボタン群の中に 2 つ置かない。1 画面に 2 つ以上もめったに置かない*
- **Default** — 一般操作。Primary と並べて副操作に使う
- **Invisible** — 透明。ツールバーや ActionList のような最小 UI 用
- **Danger** — 破壊的操作。控えめに使い、通常は確認ダイアログを伴う

control 寸法トークン（`--control-*-size` 実測値）:

| | xsmall | small | medium | large |
|---|---|---|---|---|
| 高さ | **24px** | **28px** | **32px** | **40px** |
| 上下 padding | 2px | 4px | 6px | 10px |
| 左右 padding (normal) | 8px | 12px | 12px | 12px |
| gap | 4px | 4px | 8px | 8px |

角丸トークン: `small` 3px / `medium`（= default）**6px** / `large` 12px / `full` 9999px。
focus: outline 幅 2px、offset -2px。

補足（Primer の Button ページ、検証済）: ドロップダウンを開くボタン（`Sort ▾` など選択 UI をトグルするもの）はラベルを**左寄せ**、実行系 CTA は**中央寄せ**と使い分ける。

### 1.3 Linear — 並び替え（Display options）

出典: `https://linear.app/docs/display-options`（検証済）

- 起動は `Shift V`。リスト/ボード切替は `Cmd/Ctrl B`
- 並び替えの対象は **厳選された固定セット**で、表示中の列とは無関係:
  Status / Manual / Priority / Last created / Last updated / Due date / Link count
- **「Manual のとき以外は昇降を反転できる」** — 方向トグルは常設。手動並びのときだけ無効
- Status で並べると「完了に近い順 → 遠い順、完了・キャンセルは末尾」という**意味順**を使う（アルファベット順ではない）
- **Grouping（グループ化）/ Ordering（並び替え）/ Display properties（どの列を出すか）は別概念**として同じパネルに並ぶ。どれを表示するかは並び替え候補に影響しない
- 設定は個人の既定として残せるほか、`Set as default` でワークスペース既定にできる。`Reset to default` で戻す

### 1.4 Linear — フィルタ

出典: `https://linear.app/docs/filters`（検証済）

- 起動は `F`。1 つのビューに複数条件を同時適用できる
- 条件は `[属性] [演算子] [値]` の 3 節。**節ごとにクリックして変更**する（属性節は変更不可、演算子節と値節は差し替え可能）
- 演算子: `is` / `is not`（単一）、`is either of` / `is not`（複数）、ラベル系は `includes any / all / neither / either / none`、**日付系は `before` / `after`**
- 値を増やすと演算子が自動で `is` → `is either of` に変わる
- **日付のクイック値: 「N days」/ Month / Quarter / Half-year / Year** — 生の日付入力を第一手段にしていない
- 属性名を打つと候補が直接出る（カテゴリを掘らずに済むクイック検索）
- 適用中のフィルタは URL に反映され、URL を渡せば同じ絞り込みが再現される
- 高度な用途向けに AND/OR とネストを組める Advanced filter が別にある

---

## 2. Alcon の実態

### 2.1 ボタン — 共有プリミティブが事実上死んでいる

`web/src/ui/button.tsx` は shadcn のまま存在する（6 variant × 7 size）。だが使われていない。

| 指標 | 数 |
|---|---|
| `.tsx` 総数 | 159 |
| `ui/button` を import しているファイル | **7**（うち 1 つは `ui/calendar.tsx` の内部利用） |
| `<Button` の出現 | **14** |
| 手書き `<button` の出現 | **544** |
| 手書き `<button` を含むファイル | **91 / 159**（57%） |

**ボタンの 97.5% が手書き。** import 元は `ui/calendar.tsx:16` / `shell/CreateView.tsx:5` / `shell/sidebar/ObjectTree.tsx:7` / `alcon/room/ChannelDialog.tsx:12` / `alcon/chat/NewConversationDialog.tsx:12` / `alcon/chat/ChatGroupDialog.tsx:6` / `alcon/object/ObjectDetailView.tsx:39` の 7 箇所だけ。

手書き `<button>` 544 個のクラス実測（開始タグ内のみ集計）:

| 軸 | 種類数 | 内訳（多い順） |
|---|---|---|
| 高さ `h-*` | **12 種** | `h-7` 21 / `h-6` 19 / `h-4` 8 / `h-8` 6 / `h-5` 5 / `h-9` 4 / `h-[26px]` 4 / `h-[22px]` 2 / `h-[18px]` 1 / `h-10` 1 / `h-11` 1 / `h-full` 1 |
| 角丸 | **5 種** | `rounded-md` 76 / `rounded` 53 / `rounded-full` 20 / `rounded-lg` 13 / `rounded-[3px]` 1 |
| 文字サイズ | **7 種** | `text-[12px]` 58 / `text-[13px]` 16 / `text-[11px]` 9 / `text-sm` 7 / `text-[12.5px]` 2 / `text-[10px]` 1 |
| 左右 padding | **7 種** | `px-3` 38 / `px-2.5` 21 / `px-2` 13 / `px-1.5` 11 / `px-4` 7 / `px-1` 4 / `px-0.5` 1 |
| 上下 padding | **7 種** | `py-1.5` 37 / `py-1` 18 / `py-2` 11 / `py-0.5` 10 / `py-2.5` 3 / `py-[3px]` 1 / `py-6` 1 |
| 一括 padding | **3 種** | `p-1` 14 / `p-1.5` 4 / `p-0.5` 3 |
| アイコン単独の箱 | **16 通り / 実寸 10 種** | 24, 28, 16, 20, 32, 26, 36, 22, 18, 40 px |
| フォント太さ | 2 種 | `font-medium` 31 / `font-semibold` 11 |

補足で効いている事実:
- **高さを宣言しているのは 544 個中 73 個だけ。** 残り 471 個は padding 依存で高さが決まる = 行の高さが揃う保証がどこにもない
- `text-[12.5px]` が 2 箇所ある（`alcon/shared/listControls/ListControls.tsx:573, 758`）。半ピクセル指定
- 「Primary」を表す背景が **4 系統併存**: `bg-foreground` 74 / `bg-primary` 48 / `bg-blue-500` 20 / `bg-[var(--accent-default)]` 5。さらに `bg-blue-400` 8
- `web/src/shared/designTokens.ts` には `FONT` / `STATUS` / `PRIORITY` / `CARD` はあるが、**ボタン・コントロールの高さ / padding / 角丸トークンが 1 つもない**。だから各所が個別に数字を決めている

### 2.2 ソート — 系統が 2 つあり、両方欠けている

**系統 A: 列ソート**
- UI: `alcon/shared/listControls/ListControls.tsx:713-802`（`SortMenu`）と、表ヘッダ `alcon/object/ListTable.tsx:1944-1964`
- 状態: `alcon/object/useListColumns.ts` の共有ストア（`sort: ColumnSort | null`）

**系統 B: Display の「Ordering」**
- 選択肢: `ListControls.tsx:127-134`（`ORDER_OPTIONS` = Manual / Priority / Due date / Created / Updated / Title の 6 つ）
- UI: `ListControls.tsx:500-505`
- 比較: `alcon/shared/listControls/group.tsx:159-185`（`compareElements`）

両者は同じリストに別々に効く。ユーザーから見て「並び替え」が 2 箇所にあり、内容が重ならない。

**ソートメニューに 3 項目しか出ない技術的原因**（4 段重ね）:

1. `ListControls.tsx:752` が `cols.visibleColumns.map(...)` を回している。`allColumns` ではない。→ **表示中の列しかソート候補にならない**
2. Element の組み込み列は `useListColumns.ts:59-63` で `type` / `due_date` / `assignee` の **3 つだけ**。既定表示も `alcon/shared/listConfig.ts:19` で同じ 3 つ。→ 初期状態でちょうど 3 項目
3. カスタム Property（`cc:*`）は既定 OFF。`useListColumns.ts:324-333` が custom を既定可視に入れず、さらに `useListColumns.ts:187-194` の一度きり移行が過去に保存された `cc:*` を可視リストから削除する。→ Property は候補に出てこない
4. Name（タイトル）列はそもそも `DataColumn` ではない。`useListColumns.ts:47-54` のコメントどおり `NAME_COL_KEY` は「トグルも並べ替えもできない」特別扱い。→ **タイトルで並べ替えられない**

加えて `useListColumns.ts:467-486` の `keyOf` は `type` / `due_date` / `assignee` / `cc:*` しか解決しない。Status・Priority・Created・Updated には列ソートのキーが存在しない。

**方向トグルが死んでいる**:
`ListDisplay.orderDir` は `types.ts:54` で定義され、`group.tsx:160` と `objectFilter.ts:31` で**読まれている**。しかし `setDisplay({ orderDir: ... })` を呼ぶ箇所がリポジトリに 1 つもない（`orderDir` の全出現は上記 5 箇所のみ）。Display パネルの `LabeledSelect` は `ListControls.tsx:504` で `orderBy` しか書かない。
→ **Ordering は永久に `asc` 固定。** Created / Updated が常に古い順で、新しい順にする手段がない。

**見出しが全大文字**:
`ListControls.tsx:744` が `text-[11px] uppercase tracking-wider` で `Sort by` を描いている。これが「SORT BY」の正体。CLAUDE.md の禁止事項に該当。同種の `uppercase` は **24 ファイル / 43 箇所**（`ListControls.tsx:518, 611` の Properties 見出しも同じ）。

**現在のソート状態が読めない**:
トリガーは 26px のアイコンボタン 1 つ（`ListControls.tsx:729-740`）。何でソートしているかは `title` 属性にしかなく、ホバーしないと分からない。表ヘッダの矢印も `ListTable.tsx:1960-1962` で未ソート時 `opacity-0`。

### 2.3 フィルタ — 生の日付入力

`ListControls.tsx:418-435`:

```
<input type="date" ... className="flex-1 px-2 py-1 text-[12px] bg-muted/40 rounded-md" />
<span>→</span>
<input type="date" ... className="flex-1 px-2 py-1 text-[12px] bg-muted/40 rounded-md" />
```

- ブラウザ既定の `yyyy/mm/dd` がそのまま出る。プリセットなし、相対日付なし、演算子なし（`dueFrom`/`dueTo` の閉区間固定）
- 生の `type="date"` はリポジトリ全体で **9 箇所**（`PhaseView.tsx:483` / `ElementTableRow.tsx:276` / `ElementPropertiesPanel.tsx:459,539,558` / `StrategyTimelineView.tsx:641` / `QuickAddObjectPopup.tsx:257` / `ListControls.tsx:422,429`）
- 適用中フィルタの提示が**オレンジの点 1 つ**だけ（`ListControls.tsx:207`、6px の丸）。何が効いているかは popover を開くまで分からない
- 条件は `ListFilter`（`types.ts:7-28`）の固定フィールド 10 個。演算子の概念がなく、`is not` に相当する否定ができない

なお入力欄の枠については実態は良好で、`border` / `focus ring` を持つ `<input>`・`<textarea>` は `ui/input.tsx:7` の 1 つだけ（shadcn 原型、4 ファイルが dialog 内で使用）。プロパティ追加メニュー側は現状クリーン。

---

## 3. 収斂案

### 3.1 ボタン — 4 階層 × 3 サイズ + アイコン

`shared/designTokens.ts` に `CONTROL` ブロックを追加し、`ui/button.tsx` の cva をこの値に差し替えて実際に使う。

**サイズ 3 種**（現状の分布 `h-6` 19 / `h-7` 21 / `h-8` 10 と、Primer の 24/28/32 が一致する点を採る）:

| size | 高さ | 左右 pad | gap | 文字 | アイコン | 角丸 | 用途 |
|---|---|---|---|---|---|---|---|
| `xs` | **24px** | 8px | 6px | 12px | 14px | 6px | 表の行内・チップ・セル内トリガー |
| `sm` | **28px** | 10px | 6px | 12px | 14px | 6px | **既定。** ツールバー / popover 内 / サイドバー |
| `md` | **32px** | 12px | 8px | 13px | 16px | 6px | ダイアログ・フォーム・画面の主 CTA |

アイコン単独は正方形で同じ高さ: 24 / 28 / 32。**現行の 10 種（16,18,20,22,26,36,40 を含む）を全部この 3 つに畳む。**
→ なぜ: 高さを 3 値に固定すると、高さ未宣言の 471 個が padding 由来でバラつく問題そのものが消えるから。

**階層 4 種**（Primer の 4 分類。`outline` は廃し、枠は使わない）:

| variant | 通常 | hover | active | 使いどころ |
|---|---|---|---|---|
| `primary` | `bg-[var(--accent-default)]` / 白文字 | `bg-[var(--accent-hover)]` | 同色 8% 暗く | **1 画面に 1 つまで** |
| `secondary` | `bg-[var(--surface-raised)]` / `--text-primary` | `bg-[var(--surface-overlay)]` | 同 | 副操作、primary と並ぶ |
| `ghost` | 透明 / `--text-secondary` | `bg-[var(--surface-raised)]` + `--text-primary` | 同 | ツールバー・アイコンボタンの既定 |
| `danger` | 透明 / `--status-danger` | `bg-[var(--status-danger-subtle)]` | 同 | 削除系。確認を伴う |

→ なぜ: いま「primary」を名乗る背景が `bg-foreground` 74 / `bg-primary` 48 / `bg-blue-500` 20 / `--accent-default` 5 の 4 系統に割れている。1 つに寄せないと画面ごとに主ボタンの色が変わる。

**状態の実数**:
- transition: `background-color, color` のみ **120ms `ease-out`**（現行の `transition-all` は width/height までアニメして重い）
- `disabled`: `opacity-0.5` + `pointer-events-none`
- `focus-visible`: 2px リング、offset 2px。**`button` / `a` / `[role=button]` のみ**（globals.css のホワイトリストどおり。`<input>` には付けない）
- `active`: 背景を 1 段暗くするだけ。`scale` や `translate` は使わない

**角丸は全サイズ 6px 固定。** `rounded-full` は円形アバターとトグルチップだけに残す。`rounded`(4px) 53 箇所と `rounded-lg`(8px) 13 箇所は 6px に寄せる。
→ なぜ: shadcn も Primer も、サイズが変わっても角丸は変えない。3 値混在は同じ列に並んだとき角の丸みが揃わず、それが「醜い」の実体。

**文字サイズは `FONT` に従わせる**: 12px = `FONT.sm`、13px = `FONT.base`。`text-[12.5px]`（2 箇所）と `text-[10px]`、ボタン内の `text-sm`(14px) は廃止。

### 3.2 ソート — 系統を 1 つにし、対象を厳選セットにする

**(a) 系統 A / B を統合し、入口は 1 つにする。**
`SortMenu` を唯一のソート面にし、`ORDER_OPTIONS` を Display パネルから外す。表ヘッダのクリックは同じ状態を書く近道として残す。
→ なぜ: 同じリストに効く「並び替え」が 2 箇所にあり中身が違うのは、どちらが効いているか誰にも分からない。

**(b) ソート対象は「表示中の列」ではなく固定セット + Property。**
`ListControls.tsx:752` の `cols.visibleColumns` を廃し、候補を次のように定義する:

```
Manual（手動）/ Status / Priority / Due date / Title / Created / Updated
＋ この Domain の全 Property（cc:*、列として非表示のものも含む）
```

併せて `useListColumns.ts:467-486` の `keyOf` に `status` / `priority` / `created` / `updated` / `title` のケースを足し、Title は `NAME_COL_KEY` ではなくソートキーとして扱えるようにする。
→ なぜ: Linear は Ordering と Display properties を別概念として扱っている。列を隠したらタイトル順に並べられなくなる、は因果が繋がっていない。

**(c) 方向トグルを常設し、Manual のときだけ無効にする。**
`setDisplay({ orderDir })` を実際に呼ぶ UI を作る（現状 writer が 0 個）。各行の右にある 24px の `↑` `↓` を、選択中の項目については必ず押せる状態にする。
→ なぜ: Linear の明文ルール（Manual 以外は反転可）。いま Created / Updated が古い順固定なのは単に writer がないだけで、比較関数は方向を受け取れる。

**(d) 現在のソートをトリガーに文字で出す。**
26px のアイコンだけ（`ListControls.tsx:729-740`）をやめ、`sm`(28px) の `ghost` ボタンに `↑ Due date` のようにラベルを出す。未ソート時のみアイコン単独 28px。ラベルは Primer に従い**左寄せ**、末尾に `▾`。
→ なぜ: 状態が `title` 属性にしかないと、ホバーするまで何順か分からない。

**(e) 見出しの全大文字をやめる。**
`ListControls.tsx:744` の `uppercase tracking-wider` を削除し `Sort by` と表示。同 `518` / `611` も同様。残り 24 ファイル 43 箇所も同じ扱い。
→ なぜ: CLAUDE.md の明文禁止。ラベルは書いたとおりに出す。

**(f) Status の並びは意味順にする。**
`STATUS_OPTIONS`（`types.ts:103`）の宣言順 `backlog → todo → in_progress → review → done → blocked → cancelled` を比較順に使い、`localeCompare` にしない。
→ なぜ: Linear は「完了に近い順、完了・キャンセルは末尾」で並べる。アルファベット順の Status は情報にならない。

### 3.3 フィルタ — 日付はプリセット優先、条件はチップで見せる

**(a) 日付はまずプリセット。** `ListControls.tsx:418-435` の生 `<input type="date">` 2 本を、1 段目にプリセット一覧を置く形へ:

```
期限切れ / 今日 / 今週 / 今後7日 / 今後30日 / 今月 / 今四半期 / 期限なし / カスタム範囲…
```

`カスタム範囲…` を選んだときだけ日付欄 2 つを開く。欄は `sm`(28px)・`px-2.5`・12px・角丸 6px・枠なし（`bg-[var(--surface-raised)]`）。
→ なぜ: Linear の日付フィルタのクイック値が「N days / Month / Quarter / Half-year / Year」で、生の日付入力を第一手段にしていない。実際に効く絞り込みのほとんどは相対日付。

**(b) 演算子を持たせる。** いまは `dueFrom`/`dueTo` の閉区間しかない。`before` / `after` / `between` / `is empty` を選べるようにする（Linear の日付演算子は `before` / `after`）。同様に選択系の条件には `is` / `is not` を付ける。
→ なぜ: 「担当が自分以外」「Done 以外」が今は表現できない。

**(c) 適用中フィルタを 6px の点ではなくチップで出す。**
ツールバー直下に `Status: In Progress ×` のような `xs`(24px) チップを並べる。`ListControls.tsx:207` のオレンジ点は廃止。
→ なぜ: Linear は適用中フィルタをビュー上に出し URL にも載せる。popover を閉じた瞬間に何が効いているか消える現状は、絞り込み結果を誤読させる。

---

## 4. 未検証・保留

- Linear の**実寸**（ボタン高さ・角丸の px）は公開ドキュメントに数値がないため取得していない。上表の 24/28/32 は shadcn と Primer の実測値、および Alcon 現行の分布から決めた
- Radix UI Themes の control 寸法は今回参照していない
