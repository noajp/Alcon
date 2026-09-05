# メニュー / ポップオーバー — 参照パターン集

対象領域：プロパティ追加メニュー、ソートメニュー、フィルタ、Display パネル、プロパティピッカー。寸法・階層・キーボード操作・入力欄の扱い。

出典の凡例は [creation-flows.md](./creation-flows.md#出典の凡例) と共通。実測環境：`https://linear.app/demo`、2026-08-30、viewport 1440×900、ダークテーマ。

---

## 0. 実測値 — Linear のポップオーバーは 1 種類しかない

【実測】 性質のまったく違う 2 つのメニューを開いて採寸した。

| 採寸対象 | 起動 | 幅 | 角丸 | 罫線 | 行高 | 行の文字 | 行 padding |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Priority ピッカー（5 択の値選択） | コンポーザの Priority pill | **207px** | **12px** | `0.5px solid lch(25.68 1.93 272)` | **32px** | **13px / w400** | `0 18px 0 14px` |
| Filter メニュー（19 項目・サブメニュー付き） | `F` | **207px** | **12px** | 同上 | **32px** | **13px / w400** | `0 18px 0 14px` |

**幅も角丸も罫線も影も行高も文字サイズも padding も、完全に同一だった。**

共通の面仕様【実測】：
```
width:        207px
border-radius:12px
background:   lch(12.72 0.85 272)
border:       0.5px solid lch(25.68 1.93 272)
box-shadow:   0 3px 8px lch(0 0 0 / .125),
              0 2px 5px lch(0 0 0 / .125),
              0 1px 1px lch(0 0 0 / .125)
padding:      0        ← 面自体には padding が無い。行が全幅を占める
```

内側のリスト領域は `overflow: hidden` の 206px（罫線 0.5px×2 を引いた内寸）で、スクロール領域として切り出されている。

---

## パターン 1 — 幅は 1 段（内容で変えない）

**何が起きるか**【実測】 5 行の値ピッカーも、19 行 + サブメニュー矢印付きのフィルタ facet 一覧も、同じ 207px。内容量に幅を合わせていない。

**なぜそうなっているか**【推測】 メニューは連続して開くもの（pill → 値 → 別の pill → 値）。開くたびに幅が変わると、視線が毎回「面の端がどこか」を測り直す。幅を固定すると、面の位置だけ追えばよくなる。「Opinionated, not Configurable」の寸法版。

**Alcon の現状との差分 — 16 種類の幅**

`web/src/` 内の `<PopoverContent>` / `<DropdownMenuContent>` は **66 インスタンス**。うち **50 箇所**が明示的な幅クラスを持つ（残り 16 箇所は幅指定なし ＝ 内容次第で伸縮する）。幅指定の全数集計：

| 幅 | 出現数 | | 幅 | 出現数 |
| :--- | :--- | :--- | :--- | :--- |
| `180px` | 7 | | `224px` (`w-56`) | 3 |
| `176px` (`w-44`) | 6 | | `140px` | 3 |
| `288px` (`w-72`) | 5 | | `256px` (`w-64`) | 2 |
| `220px` | 5 | | `144px` (`w-36`) | 2 |
| `160px` | 5 | | `200px` | 2 |
| `240px` (`w-60` / `min-w-[240px]`) | 5 | | `208px` `128px` `112px` `190px` `170px` | 各 1 |

**16 種の異なる px 幅。** 112px から 288px まで、20px 刻みにも満たない粒度で散らばっている。さらに幅指定の無い 16 箇所は内容次第で伸縮するので、実際に画面に出る幅はもっと多い。

特に近接して同時に見える 3 つが不揃い：
- `ListControls.tsx:211` Filter → `w-72`（288px）
- `ListControls.tsx:236` Display → `w-72`（288px）
- `ListControls.tsx:742` Sort → `w-60`（**240px**）

同じツールバーに並ぶ 3 ボタンから、48px 違う面が開く。

さらに `QuickAddElementPopup.tsx` の pill 行だけで 3 種類：
- `299` Type → `min-w-[180px]`
- `327` Status → `min-w-[180px]`
- `376` Assignee → `min-w-[220px]`
- `415` Object → `min-w-[240px]`
- `454` Labels → `min-w-[220px]`

隣り合う pill を順に押すと、面の右端が 180 → 220 → 240 と動く。

**Alcon にどう適用するか — 収斂案：幅は 2 段**

Linear の 1 段が理想だが、Alcon には Linear に無いものが 2 つある：Display パネルの「Grouping / Ordering というラベル + 右寄せ select」の 2 カラム行と、Filter パネルの日付レンジ入力 2 本。これらは 207px に収まらない。したがって **2 段**にする。

| 段 | 幅 | 使う場所 | 根拠 |
| :--- | :--- | :--- | :--- |
| **標準** | **208px** | 値の選択、単一列の一覧、facet 一覧、Sort、プロパティ型の選択、pill から開く全メニュー | Linear 実測 207px。Tailwind の `w-52` が 208px でちょうど一致し、既に `InlineAddRow.tsx:212` がこの値を使っている |
| **広** | **288px** | ラベル + コントロールの 2 カラム行を持つパネルのみ（Display / Filter） | 既存の `w-72` を残す。新規に第 3 の幅を作らない |

移行の指針：
1. **`min-w-[...]` を全廃する。** `min-w` は内容で幅が伸びるので「揃えたつもりで揃わない」の主因。`w-52` / `w-72` の固定幅にする
2. 上の表で「標準」に該当する 44 箇所を `w-52` に寄せる
3. `ListControls.tsx:742` の Sort を `w-60` → `w-52` に。Sort は単一列一覧なので標準段
4. `ListControls.tsx:579` の `LabeledSelect` の `min-w-[170px]` は、広パネルの**中に**開く入れ子メニュー。これも標準段（`w-52`）に揃える。親より狭い必要は無い
5. `AddPropertyButton.tsx:178` の `w-60`（240px）→ `w-52`
6. 新しいポップオーバーを書くときは **2 択から選ぶ**。第 3 の幅を作りたくなったら、それは中身の構造を直すべきというサイン

---

## パターン 2 — 面の先頭は常に「動詞のプレースホルダを持つ検索欄」

**何が起きるか**【実測】 どちらのメニューにも最上部に入力欄がある。プレースホルダは：

| メニュー | プレースホルダ |
| :--- | :--- |
| Priority ピッカー | `Set priority to…` |
| Filter メニュー | `Add Filter…` |

**「Search」ではない。** そのメニューを開いた目的を動詞で書いてある。

入力欄の実測仕様【実測】：
```
height:      36px
font:        13px / weight 400
outline:     none      ← フォーカスリング無し
box-shadow:  none      ← 枠・リング一切無し
background:  透明（面の地色のまま）
```

**なぜそうなっているか**【推測】 2 つ効いている。(a) この欄は「検索」ではなく**コマンドの続き**。`F` を押した時点でユーザーは「フィルタを足す」と宣言済みで、入力欄はその文の続きを書く場所。だからプレースホルダが動詞句になる。(b) 装飾がゼロなのは、この欄が面の中の**独立した部品ではなく面そのものの入口**だから。枠を描くと「面の中に置かれた 1 つの部品」に見えてしまう。

Alcon の `.claude/CLAUDE.md` にある「入力フィールドに枠・リング・アウトライン禁止」は、Linear の実測とまったく一致している。この規約は正しい。

**Alcon の現状との差分**

| 場所 | 現状 | 問題 |
| :--- | :--- | :--- |
| `AddPropertyButton.tsx:73-79` | `placeholder="Property name…"` / `bg-muted/40 rounded-md` / `px-2 py-1` ≒ **28px** | 地色 + 角丸で**部品として枠取りされている**。高さも 36px でない |
| `ListControls.tsx:280-288` | `placeholder="Search title…"` / 親 div が `bg-muted/50 rounded-md` `py-1.5` ≒ **30px** | 同上。さらに `Search` という名詞プレースホルダ |
| Priority / Status / Assignee / Object / Labels ピッカー（`QuickAddElementPopup.tsx`） | **検索欄が無い** | Worker や Object が増えると `max-h-[260px]` のスクロールを目視で探すことになる |
| Sort メニュー（`ListControls.tsx:742-801`） | **検索欄が無い** | 列数が増えると同じ問題 |

さらに `ListControls.tsx:286` の絞り込みは **`Enter` か `onBlur` でしか反映されない**：

```
onChange={(e) => setQuery(e.target.value)}
onBlur={() => setFilter({ query })}
onKeyDown={(e) => { if (e.key === 'Enter') setFilter({ query }); }}
```

打っている間はリストが動かない。Linear は `Cmd/Ctrl+F` のビュー内検索について「打つそばから非該当行が消える」と明記している（出典: https://linear.app/docs/search）。

**Alcon にどう適用するか**
1. **検索欄の型を 1 つに固める**：高さ `36px`、`13px / w400`、地色**透明**、角丸なし、枠なし、リングなし。下端に `1px` の区切りだけを置いて一覧と分ける
2. **プレースホルダを動詞句に**：`Property name…` → `Add property…`／`Search title…` → `Filter by title…`／Status ピッカー → `Set status to…`／Assignee → `Assign to…`／Object → `Save to…`
3. **絞り込みは打鍵ごとに反映**。`onBlur` / `Enter` 待ちをやめる（`ListControls.tsx:280-288`）
4. **6 行を超える一覧には検索欄を必須にする**。Assignee / Object / Labels / Sort が該当

---

## パターン 3 — 行は全幅・32px・13px

**何が起きるか**【実測】 行は面の内寸 206px を**そのまま占める**。`border-radius: 0`、面の左右 padding は 0。行自身が `padding: 0 18px 0 14px` を持つ。左 14px / 右 18px の非対称は、右端にチェックやショートカットヒントが入るぶんの余白【推測】。

**なぜそうなっているか**【推測】 行を全幅にすると、hover のハイライトが面の端まで届く。角丸の内側にインセットされた行だと、面と行の間に「押せない帯」ができる。206px しかない面でそれをやると、実質のヒット領域が目に見えて痩せる。

**Alcon の現状との差分 — 行高が 26 / 28 / 30 / 32 / 34px と 5 種類**

| 場所 | 実装 | 実効の行高 |
| :--- | :--- | :--- |
| `ListControls.tsx:696` `MenuCheckRow` | `pl-7 pr-3 py-1.5 text-[12.5px]` | ≒ 30px |
| `ListControls.tsx:668` `Submenu` ヘッダ | `px-3 py-1.5 text-[13px]` | ≒ 30px |
| `ListControls.tsx:758` Sort 行 | `pl-3 pr-2 py-1 text-[12.5px]` | ≒ 26px |
| `AddPropertyButton.tsx:89,109,127` | `px-2 py-1 text-[13px] rounded-md` | ≒ 26px |
| `InlineAddRow.tsx:225` `@` メニュー | `px-3 py-2 text-[13px]` | ≒ 34px |
| `QuickAddElementPopup` の各 DropdownMenuItem | `ui/dropdown-menu` の既定 | ≒ 28px |

**さらに `12.5px` という文字サイズが 3 箇所ある**（`ListControls.tsx:573`, `696`, `758` — `LabeledSelect` のトリガ、`MenuCheckRow`、Sort 行）。これは `designTokens.ts` の `FONT` スケールに存在せず、`DESIGN.md` §9 の「小数 px を書かない」にも直接違反している。

`AddPropertyButton.tsx` の行は `rounded-md` でインセットされており、パターン 3 の全幅原則から外れている。

**Alcon にどう適用するか**
1. **行の型を 1 つにする**：高さ `32px`、文字 `13px / w400`、`padding: 0 16px 0 12px`、`border-radius: 0`、幅は面の内寸いっぱい
   - Linear の 14/18 をそのまま採るのではなく、Alcon の 4pt グリッド（`DESIGN.md` §3.1「すべて 4 の倍数」）に合わせて 12/16 にする
2. `12.5px` を全廃して `13px` に
3. `AddPropertyButton.tsx` の `rounded-md` を外し、行を全幅に
4. `MenuCheckRow` の `pl-7`（28px の左インデント）は、チェック列を左に置いているため。Linear と同じく**チェックは右端**に寄せ、左 padding を 12px に統一する
5. これらを `alcon/shared/menu/` に `MenuRow` / `MenuSearchField` / `MenuSectionLabel` として切り出す。`MEMORY.md` の「Shared UI primitives — 繰り返す UI は初出時に共有部品化」に沿う

---

## パターン 4 — 行の右端にショートカットヒント

**何が起きるか**【実測】 Priority ピッカーの各行の右端に数字が出ている：

```
No priority   0
Urgent        1
High          2
Medium        3
Low           4
```

DOM のテキストは `"No priority | 0 | 0"`（値と表示の 2 つ）。メニューを開かなくても、`1` を押せば Urgent になると分かる。

**なぜそうなっているか**【推測】 メニューは**ショートカットの教材**でもある。使うたびにキーを見せることで、いずれメニューを開かずに済むようになる。メニューが自分を不要にしていく設計。Linear の「Built for Speed」が、単に速い実装ではなく「速い使い方をユーザーに憶えさせる」設計として現れている箇所。

**Alcon の現状との差分**
- **どのメニューにもショートカットヒントが無い**。`QuickAddElementPopup.tsx:329-335` の Status 行も `ElementProgressMark` + ラベル + チェックだけ
- そもそも Alcon にはプロパティ設定のショートカット自体が実装されていない
- `CommandPalette.tsx:188-197` の Navigation 行にもキーヒント無し

**Alcon にどう適用するか**
1. 行の型（パターン 3）に `hint?: string` スロットを右端に用意しておく。中身が無くてもレイアウトは変わらない
2. ショートカットを実装した順にヒントを埋める。優先は Status（`S`）/ Priority（`P`）/ Assignee（`A`）— Linear と同じ頭文字
3. ヒントの体裁：`11px`、`text-tertiary`、等幅（`DESIGN.md` §2.1 は「キーボードショートカット」を `font.mono` の用途として明記している）

---

## パターン 5 — 区切りは罫線ではなく 12px の余白

**何が起きるか**【実測】 Filter メニューは `AI filter / Advanced filter` → `Status … Subscribers` → `Auto-closed / Content / Links / Template` の 3 群に分かれているが、群の間にあるのは：

```
height:           12px
background-color: rgba(0, 0, 0, 0)   ← 透明
border:           none               ← 罫線なし
```

**罫線を 1 本も引いていない。12px の空白だけでグループを作っている。**

**なぜそうなっているか**【推測】 `DESIGN.md` §0.2-2「Borders & Luminance over Shadows」の延長。207px の狭い面に罫線を何本も引くと、面が横縞に切り刻まれて「1 枚の面」に見えなくなる。余白なら面は割れない。

**Alcon の現状との差分 — 罫線が多い**
- `AddPropertyButton.tsx:98, 118` — `border-t border-border/60` を 2 本
- `AddPropertyButton.tsx:138` — 「Save to Space library」の上にもう 1 本
- `ListControls.tsx:418, 456, 518, 547, 611, 793` — Filter / Display / Sort パネルに計 6 本
- `QuickAddElementPopup.tsx:309, 338, 394, 424, 438, 472` — `DropdownMenuSeparator` が 6 本

`AddPropertyButton` の 240px 幅・26px 行の面に罫線が 3 本入ると、面の 1/3 ごとに視覚的な切れ目が入る。

**Alcon にどう適用するか**
1. **群の区切りは `12px` の透明スペーサ**を既定にする
2. 罫線を残すのは「面の役割が変わる境界」だけ。具体的には：
   - 検索欄と一覧の間（入力と選択という別の操作モード）
   - 一覧と最下部のアクション（`Clear filters` / `Reset to defaults` — 破壊的操作）の間
3. それ以外（`AddPropertyButton.tsx:98,118` の Restore / From library / Select type の 3 群、`QuickAddElementPopup` の Clear 行の直前）は余白に置き換える
4. 罫線を使うなら `1px` かつ `--border-subtle`。`border-border/60` のような不透明度の場当たり指定をやめる

---

## パターン 6 — 深い階層はフライアウト、その場展開ではない

**何が起きるか**【実測】 Filter メニューの facet 行（`Status` `Assignee` `Priority` …）は右端に `▶` を持ち、押すと**横に別の面が開く**。親の面の中で行が下に伸びるのではない。

**なぜそうなっているか**【推測】 その場展開だと、19 個ある facet のうち 1 つを開いた瞬間に他の 18 個が画面外へ押し出される。「今どの facet の話をしているか」と「他に何があるか」を同時に見せるには、面を分けるしかない。

**Alcon の現状との差分 — 全部その場展開**

`ListControls.tsx:653-681` の `Submenu` はアコーディオン：

```
<button onClick={() => setOpen((v) => !v)}>
  ...
  <ChevronRight className={`... ${open ? 'rotate-90' : ''}`} />
</button>
{open && <div className="pb-1">{children}</div>}
```

Status / Priority / Type / Labels / Assignee / Object の 6 facet があり、Assignee を開くと Worker 全員分が親の面の中に展開される。Worker が 20 人いれば、Object facet は画面のはるか下に行く。しかも**この面には `max-height` もスクロール指定も無い**（`ListControls.tsx:211` は `w-72 p-0` のみ）。

**Alcon にどう適用するか**
1. **選択肢が 5 個以下で固定なら、その場展開のままでよい**。Status（7 個）と Priority は境界線上だが、増えないので許容
2. **件数が動的なもの（Assignee / Object / Labels / Type）はフライアウトにする**。Radix の `DropdownMenuSub` / `PopoverContent side="right"` で親の右に出す
3. フライアウトの面は**標準段 208px**（パターン 1）。親が 288px でも子は 208px
4. 移行が重いなら中間策：その場展開を残しつつ、facet ごとの領域に `max-height: 192px`（32px × 6 行）+ `overflow-y: auto` を掛け、親の面全体にも `max-height: min(70vh, 480px)` を掛ける。**これは今すぐ入れるべき。現状は面が無限に伸びる**

---

## パターン 7 — 見出しの型

**何が起きるか**【実測】 Linear の 2 つのメニューには、群の見出しテキストが**存在しない**。群は 12px の余白だけで分かれている（パターン 5）。

**なぜそうなっているか**【推測】 207px の面で、32px の見出し行を置くと 1 群あたり 1 行分の選択肢が消える。行のラベル自体が十分に説明的なら（`Status` `Assignee` `Priority`）見出しは冗長。

**Alcon の現状との差分 — 見出しが 3 つの型で混在**

| 型 | 実装 | 場所 |
| :--- | :--- | :--- |
| A. 全大文字 | `text-[11px] uppercase tracking-wider text-muted-foreground/80` | `ListControls.tsx:518, 611, 744` |
| B. 全大文字（小さめ） | `text-[10px] font-medium uppercase tracking-wider` | `InlineAddRow.tsx:216` |
| C. 先頭大文字 | `text-[11px] text-muted-foreground/60` | `AddPropertyButton.tsx:83, 103, 121` |
| D. Radix Label | `text-[10px] text-muted-foreground/70` | `QuickAddElementPopup.tsx:300, 328, 377, 416, 455` |

**A と B は `.claude/CLAUDE.md` の「ラベルを CSS で全大文字にしない — メニュー項目・セクション見出し・テーブルヘッダ等で Tailwind の `uppercase` を使わない」に違反している。** 該当は 4 箇所（`ListControls.tsx:518, 611, 744` と `InlineAddRow.tsx:216`）。

D の `10px` は `designTokens.ts` の `FONT` スケール（最小 `11px`）に無い。

**Alcon にどう適用するか**
1. **見出しの型は 1 つ**：`11px` / `weight 510` / `--text-tertiary` / **先頭大文字のまま** / `tracking` は normal / 行高 `24px`（32px の選択行より低くして、押せないことを高さで示す）
2. `uppercase tracking-wider` を 4 箇所から削除
3. `10px` を `11px` に
4. **見出しを置く条件を決める**：群が 2 つ以上あり、かつ行のラベルだけでは所属が分からないときだけ置く。`AddPropertyButton` の `Restore default property` / `From library` / `Select type` は**由来が違うものが混ざる**ので見出しが要る。一方 `QuickAddElementPopup` の各ピッカー（`Status` という見出しの下に status しか無い）は**pill を押した時点で自明**なので削る — Linear が見出しを置かない理由がこれ

---

## パターン 8 — キーボード操作

**何が起きるか**【実測 + 文書】
- メニューを開くと**検索欄にフォーカスが入る**（入力が待機状態）
- `↑ / ↓` で行のハイライト移動、`Enter` で確定、`Esc` で閉じる
- Priority の各行に `0`〜`4` の直接キーが割り当てられている【実測】
- Filter は「プロパティ値の名前を直接打つと、カテゴリを辿らずにその filter が候補に出る」【文書】。`High` と打てば Priority カテゴリを開かずに Priority=High に届く
  出典: https://linear.app/docs/filters
- メニュー起動キー：`F` = Filter、`Shift + V` = Display options、`Cmd/Ctrl + B` = list/board 切替
  出典: https://linear.app/docs/display-options, https://linear.app/docs/filters

**なぜそうなっているか**【推測】 「カテゴリを辿らずに値名で直接届く」は、階層メニューの階層をキーボードでは**無視できる**ようにする仕組み。マウスには階層が要る（一覧性）が、キーボードには要らない（憶えているから）。同じメニューが 2 つの操作モデルを同時に満たしている。

**Alcon の現状との差分**

| メニュー | 実装 | キーボード操作 |
| :--- | :--- | :--- |
| `ListControls` Filter / Display / Sort | 素の `<button>` を `PopoverContent` に並べただけ | **矢印移動なし・Enter 確定なし・ロービングフォーカスなし**。Tab で 1 個ずつ送るしかない |
| `AddPropertyButton` | 同上（`<button>` の羅列） | **同上。無し** |
| `QuickAddElementPopup` の各ピッカー | Radix `DropdownMenu` | 矢印移動と Enter は Radix が提供。ただし**型頭文字ジャンプも直接キーも無い** |
| `InlineAddRow` の `@` メニュー | 自前実装（`285-321`） | **`ArrowDown/Up` / `Enter` / `Tab` / `Escape` が完備**。Alcon 内で最も出来がよい |
| `CommandPalette` | `cmdk` | 矢印 + Enter あり |

つまり Alcon のメニューは**実装元によってキーボード対応がバラバラ**で、素の button を並べた 2 ファイルは完全に非対応。

**Alcon にどう適用するか**
1. `ListControls` の Filter / Display / Sort と `AddPropertyButton` を **Radix の `DropdownMenu` 系プリミティブに寄せる**。矢印移動とフォーカス管理をライブラリに任せる。自前で 4 実装を維持しない
2. メニュー起動キーを決める：`F` = Filter、`Shift+V` = Display（Linear と同じにする。ユーザーが両方使う前提なら合わせる利が大きい）
3. 開いたら**検索欄にフォーカス**。`↓` で一覧の先頭に移る
4. `Esc` は**1 段だけ閉じる**。フライアウトが開いていればフライアウトだけ閉じ、親は残す
5. 第 2 段階として「値名の直接入力」。Filter の検索欄に `High` と打ったら `Priority: High` を候補に出す。facet を横断して値を検索する index が要る

---

## Alcon の 12 種のポップオーバー — 収斂案まとめ

上の各パターンを 1 枚にまとめたもの。UI 実装エージェントはこの表を守る。

| 項目 | 決定値 | 現状の逸脱数 |
| :--- | :--- | :--- |
| **幅** | 標準 `208px`（`w-52`） / 広 `288px`（`w-72`）の **2 段のみ**。`min-w-*` 禁止、幅無指定も禁止 | 16 種 / 50 箇所＋無指定 16 箇所 |
| **角丸** | `12px`（`--radius-lg`） | — |
| **面の padding** | `0`。行が内寸を全幅で占める | `AddPropertyButton.tsx:178` が `p-1.5` |
| **罫線** | `1px --border-subtle` | 不透明度の場当たり指定が多数 |
| **影** | 3 層（`0 3px 8px` / `0 2px 5px` / `0 1px 1px`、すべて `rgba(0,0,0,.125)`） | — |
| **検索欄** | 高さ `36px` / `13px w400` / 地色透明 / 枠・角丸・リングなし / **動詞句プレースホルダ** / 打鍵ごとに反映 | 2 箇所が地色つき、2 箇所が名詞句、1 箇所が `Enter` 待ち |
| **行** | 高さ `32px` / `13px w400` / `padding 0 16px 0 12px` / `radius 0` / 全幅 | 5 種の行高、`12.5px` が 3 箇所 |
| **行の右端** | チェック（選択状態）とショートカットヒント用のスロット | ヒントは 0 箇所 |
| **見出し** | `11px` / `w510` / `--text-tertiary` / **先頭大文字** / 行高 `24px`。群が 2 つ以上あり所属が自明でないときだけ置く | `uppercase` が 4 箇所（`InlineAddRow.tsx:216`, `ListControls.tsx:518,611,744`）、`10px` が 6 箇所 |
| **群の区切り** | `12px` の透明スペーサ。罫線は「検索欄の下」と「破壊的アクションの上」だけ | 罫線 15 本 |
| **階層** | 動的件数はフライアウト（`side="right"`、子も `208px`）。固定 5 個以下はその場展開可 | 全部その場展開 |
| **最大高** | 面全体 `min(70vh, 480px)`、一覧領域 `192px`（32px × 6）+ `overflow-y: auto` | `ListControls` の Filter に上限なし |
| **キーボード** | 開いたら検索欄にフォーカス / `↑↓` 移動 / `Enter` 確定 / `Esc` は 1 段だけ閉じる。Radix プリミティブに統一 | 2 ファイルが完全非対応 |

### 実装順

1. **`alcon/shared/menu/` に `MenuSurface` / `MenuSearchField` / `MenuRow` / `MenuSectionLabel` / `MenuSpacer` を新設。** 上表の値をここに 1 回だけ書く（`MEMORY.md`「Shared UI primitives」）
2. **`ListControls.tsx:211` の Filter に `max-height` を入れる。** 面が無限に伸びるバグ相当の状態なので最優先
3. `uppercase` 4 箇所と `12.5px` 3 箇所と `10px` 6 箇所を潰す。既存規約への明確な違反で、判断が要らない
4. 幅を 2 段に寄せる（幅指定 50 箇所 ＋ 無指定 16 箇所）。機械的作業
5. 検索欄の型を揃え、動詞句プレースホルダにする
6. Assignee / Object / Labels / Type をフライアウト化
7. Radix プリミティブへの統一とキーボード対応

---

## 未検証・積み残し

- **`⌘K` コマンドパレットの実寸**：Chrome が `Cmd+K` を奪うためデモで開けず、標準段 208px なのか別の広い段なのか不明【未検証】
- **Display options パネルの実寸**：`Shift+V` を送ったが Filter メニューが前面に残ってしまい採寸できなかった。Linear の Display は「ラベル + 右寄せコントロール」の 2 カラム行を持つので、207px より広い**第 2 段**が存在する可能性が高い。存在するならその幅が Alcon の「広」段の根拠になる【未検証】
- **hover / selected 行の背景色**：実測時の行はすべて `rgba(0,0,0,0)` で、ハイライト状態を捉えられなかった【未検証】
- **フライアウトの開くまでの遅延 (ms)** と、対角線移動の猶予（safe triangle）の有無【未検証】
- **ライトテーマでの面の値**：実測はダークのみ【未検証】
