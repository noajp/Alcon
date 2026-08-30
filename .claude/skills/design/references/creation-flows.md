# 作成フロー — 参照パターン集

対象領域：キーボードから即座に項目を作る体験。グローバル作成キー / 連続作成 / リスト内インライン追加 / ⌘K からの作成 / 一括作成 / 下書き。

## 出典の凡例

各パターンに必ず出典ラベルを付ける。ラベルの無い記述を書かない。

| ラベル | 意味 |
| :--- | :--- |
| 【実測】 | 2026-08-30 に `https://linear.app/demo`（ログイン不要の公開デモワークスペース）をブラウザで開き、DOM の `getBoundingClientRect()` / `getComputedStyle()` で数値を採取した。px 値はこの実測値 |
| 【文書】 | Linear 公開ドキュメントの該当ページ。URL を併記 |
| 【推測】 | 実測・文書のどちらでも裏が取れておらず、観測結果からの推論 |
| 【未検証】 | 調査者の既存知識。裏取りできていない。後続の調査で検証すること |

実測環境：viewport 1440×900、ダークテーマ、Chrome。

---

## 0. 実測した Linear コンポーザの寸法

【実測】`C` で開く issue 作成モーダルの採寸値。Friction の作成ポップアップを合わせる際の基準。

| 部位 | 実測値 |
| :--- | :--- |
| パネル幅 | `750px`（固定。viewport 1440 に対して可変ではない） |
| パネル角丸 | `22px` |
| パネル上端 Y | `117px`（900px viewport の上から約 13%。**中央でも下端でもなく上寄り**） |
| パネル地色 | `lch(9.232 0.85 272)` — canvas より暗い、ほぼ黒に近い面 |
| パネル罫線 | `0.5px solid lch(22.193 1.93 272)` |
| パネル影 | 5 層：`0 4px 40px /.10`, `0 3px 20px /.125`, `0 3px 12px /.125`, `0 2px 8px /.125`, `0 1px 1px /.125` |
| タイトル入力 | `18px / 28.8px / weight 600`、枠なし・地色なし・**フォーカスリング無し** |
| 説明入力 | `15px / 24px / weight 450`、同じく無装飾 |
| プロパティ pill | 高さ `24px`、`radius 9999px`、`12px / 12px / weight 500`、padding `0 8px 0 6px` |
| 主ボタン | 高さ `28px`、`radius 9999px`、padding `0 10px`、`12px / weight 500`、地色 `lch(47.918 59.303 288.421)` |
| 「Create more」 | 主ボタンの**左隣**に置かれた checkbox。既定 **off** |

読み取れる設計意図【推測】：タイトル 18px / 説明 15px と、リスト行（13px）より**大きい**文字を使っている。作成中はその 1 件だけが主題なので、周囲の密度から意図的に切り離している。pill が 24px と小さいのは、pill が主役ではなくタイトル入力が主役だという序列の表明。

---

## パターン 1 — グローバル作成キー `C`

**何が起きるか**【文書】 どの画面からでも `C` を押すと作成モーダルが開く。`V` は同じものをフルスクリーンで開く。`Option/Alt + C` はテンプレートから開く。画面上でテキストを選択した状態で作成を起動すると、**選択テキストがタイトルに自動で入る**。
出典: https://linear.app/docs/creating-issues

**なぜそうなっているか**【推測】 単一キーを作成に割り当てられるのは、リスト画面で入力欄にフォーカスが無いことが常態だから。裏返すと、常時フォーカスされた検索欄をリスト上部に置く設計とは両立しない。Linear は検索を `/` に、作成を `C` に逃がすことで、リスト画面全体を「キーが効く面」として確保している。

**キーボード仕様**
- 起動：`C`（モーダル） / `V`（フルスクリーン） / `Option+C`（テンプレート）
- 起動直後のフォーカス：タイトル入力
- 送信：主ボタン、または送信ショートカット
- 取り消し：`Esc` →（内容があれば）下書き保存の確認を出す【文書】

**Friction の現状との差分**
- `web/src/shell/` に **グローバル作成キーが存在しない**。`QuickAddElementPopup` は常にホスト側の onClick から開かれる
- `CommandPalette.tsx:55-64` が `⌘K` を握っているだけで、単一キーのグローバルショートカットは 1 つも登録されていない
- 選択テキストのプリフィルは `initialText` prop（`QuickAddElementPopup.tsx:75`）として口が開いているが、`window.getSelection()` から自動で流し込む呼び出し元は無い

**Friction にどう適用するか**
1. `shell/` に `useGlobalHotkeys` を新設し、`C` を「Element 作成」に割り当てる。発火条件は「`document.activeElement` が `input` / `textarea` / `[contenteditable]` **でない**」かつ「開いているモーダルが無い」
2. 起動時に `window.getSelection().toString().trim()` を読み、非空なら `initialText` に渡す（口は既にある）
3. `C` は Execution モードのリスト系 view でのみ有効にする。Strategy モードでは同じキーを Campaign 作成に割り当てられるが、**同一キーが文脈で別物を作る**のは混乱源なので、初手では Execution 限定にするのが安全【推測】

---

## パターン 2 — 連続作成（Create more）

**何が起きるか**【実測】 コンポーザ下部、主ボタンの左に「Create more」checkbox がある。既定は off。DOM 上は `<input type=checkbox>` で `checked=false`。on にすると、作成後もモーダルが閉じず次の入力に移る。

**なぜそうなっているか**【推測】 作成には 2 つのモードがある。「思いついた 1 件を書き留める」（作成後は元の作業に戻りたい＝閉じてほしい）と「頭の中のリストを流し込む」（閉じられると毎回開き直しになる）。Linear はこれを**モーダルの外に出さず、1 個の checkbox で切り替えられる**ようにした。既定を off にしているのは、前者のほうが頻度が高いという判断。

**キーボード仕様**
- トグルはマウス操作が前提（実測でショートカットのラベルは見つからず）【実測】
- 関連する強い挙動がサブ Element 側にある → パターン 3

**Friction の現状との差分 — ここが最大のギャップ**
- `web/src/alcon/element/QuickAddElementPopup.tsx:214` で `handleSubmit` が **無条件に `onClose()` を呼ぶ**

```
      await onSubmit(inputs);
      setText('');
      setDescription('');
      onClose();          // ← 214行目。連続作成が構造的に不可能
```

- つまり Friction では 10 件作るのに 10 回ポップアップを開き直す。しかも `useEffect`（同ファイル `147-160`）が open のたびに Status / Priority / Assignee / Object / Labels を**全部 null にリセット**するので、共通プロパティも毎回入れ直しになる

**Friction にどう適用するか**
1. `QuickAddElementPopup` に `createMore` state を足し、`handleSubmit` の末尾を `if (!createMore) onClose();` にする
2. `createMore` が true のときは `setText('')` / `setDescription('')` **だけ**を行い、pill 行（type / status / priority / assignees / objectId / labels）は**保持する**。これが連続作成の値。毎回リセットしたら意味が無い
3. 送信後に `taRef.current?.focus()` を明示的に呼ぶ。既存の `requestAnimationFrame` フォーカス処理（`157`）は `open` の変化にしか反応しないので、開きっぱなしの連続作成では発火しない
4. checkbox の置き場所は Linear と同じく主ボタンの左。既定 off
5. 連続作成中は、直前に作った件数をヘッダのチップに出す（`245-247` の `{titles.length} Elements` 表示を流用できる）

---

## パターン 3 — 保存すると次のエディタが自動で開く（サブ項目）

**何が起きるか**【文書】 サブ issue エディタ（`Cmd/Ctrl + Shift + O` で起動）では、**1 件保存すると自動的に次の新規エディタが開く**。さらに `Cmd/Ctrl + Shift + Enter`（または保存ボタンを Shift クリック）で保存すると、**ラベル・担当者などの値を引き継いだまま**次に進む。`Esc` でエディタを抜けて親の編集に戻る。
出典: https://linear.app/docs/parent-and-sub-issues

**なぜそうなっているか**【推測】 パターン 2 が「チェックボックスで宣言する連続作成」なのに対し、これは「文脈が連続作成だと分かっているので既定でそうする」。親の下に子を並べる作業は本質的に反復なので、モードを聞かずに反復側へ倒している。Linear は同じ機能を、文脈に応じて**既定値だけ変えて**出している。

**キーボード仕様**
- 起動：`Cmd/Ctrl + Shift + O`
- 保存 → 次のエディタが自動で開く（値は引き継がない）
- `Cmd/Ctrl + Shift + Enter` → 保存し、**値を引き継いで**次のエディタを開く
- `Esc` → エディタを抜ける
- 選択したコメント本文 / チェックリストに対して `Cmd/Ctrl + Shift + O` → その行たちをサブ項目に変換

**Friction の現状との差分**
- Subelement（チェックリスト）は別概念で AI が触らない領域だが、**Object 配下の Element 追加**がこの「文脈が反復だと分かっている場所」に相当する
- そこに置くべき `InlineAddRow.tsx` が孤児（パターン 4）
- 修飾キー付き送信（値を引き継ぐ/引き継がない の出し分け）は Friction のどこにも無い

**Friction にどう適用するか**
- `QuickAddElementPopup` の送信を 2 系統にする：`Enter` = 作成して pill をリセット、`⌘/Ctrl + Shift + Enter` = 作成して pill を保持。`createMore` が on のときのみ差が出る
- `Object 詳細 > Elements` タブから開いた作成は `createMore` を **既定 on** にする。そこは反復が既定の文脈だから

---

## パターン 4 — リスト内インライン追加（グループヘッダの `+`）

**何が起きるか**【実測】 issue リストの各グループヘッダの**右端**に `24×24px` / `radius 9999px` の作成ボタンがある（`aria-label="Create new issue"`）。実測では viewport 1440 に対して x=1377、つまり右端固定。グループが 3 つあれば 3 個存在する。

【推測】 グループヘッダから作ると、そのグループの分類値（status など）が新規項目に適用される。これは Display options のドキュメントにあるドラッグ＆ドロップの記述「グループ間にドラッグすると自動的にそのグループのプロパティを引き継ぐ」と同じ思想。
出典（ドラッグ側の記述）: https://linear.app/docs/display-options

**なぜそうなっているか**【推測】 グループ化されたリストにおいて、「どこに作るか」はカーソル位置が既に答えている。フォームでもう一度 Status を選ばせるのは、ユーザーが既に示した情報を捨てて聞き直す行為。

**Friction の現状との差分 — 完成品が描画されていない**
- `web/src/alcon/element/InlineAddRow.tsx` は 331 行の**完成したコンポーネント**で、どこからも描画されていない
- しかも中身は既に良い：
  - `174-196` `flushAndClear()` が **await して行を開いたまま text だけ空にする** — パターン 2 の連続作成が既に実装済み
  - `195` `if (textRef.current === snapshot) setText('')` — 送信中に次を打ち始めていたら消さない、という細かい配慮まで入っている
  - `271-284` 複数行ペーストで一括送信（パターン 5）
  - `285-321` `@` メニューの `ArrowDown/Up` / `Enter` / `Tab` / `Escape` 完備
- 一方で **`212` のメニュー幅が `w-52`（208px）** で、偶然 Linear の実測 207px とほぼ一致している
- **`216` が `uppercase tracking-wider`** を使っており、`.claude/CLAUDE.md` の「ラベルを CSS で全大文字にしない」に違反している

**Friction にどう適用するか**
1. **新規に書かない。`InlineAddRow` を描画するだけ**。共有リスト（`alcon/shared/` の ElementsList 系）の各グループ末尾に 1 行、`lockedType="element"` で挿す
2. グループ化が有効なとき、その行の送信はグループの分類値（status / priority / assignee）を**新規 Element に自動適用**する。これがインライン追加の存在意義
3. `216` の `uppercase tracking-wider` を外し、`Add as` をそのまま先頭大文字で出す
4. 非アクティブ時の行（`143-171`）は既に「Add @」のゴースト行になっている。Linear のようにヘッダ右端の `+` も置くなら 24×24 / radius full で右端に固定する

---

## パターン 5 — 複数行ペーストで一括作成

**何が起きるか**【文書】 サブ issue エディタにタイトルのリストを貼ると、**1 行 1 件**で複数作成される。コマンドメニューの「Create multiple issues」でも同じ。箇条書き / 番号付き / チェックリストを選択して `Cmd/Ctrl + Shift + O` を押すと、その各行がサブ項目に変換される。
出典: https://linear.app/docs/parent-and-sub-issues

**なぜそうなっているか**【推測】 作成前の項目リストはほぼ必ず「どこか別の場所のテキスト」として既に存在している（メモ、議事録、Slack）。貼る操作をそのまま一括作成にすることで、転記という工程自体を消している。

**Friction の現状との差分**
- **既に両方に実装済み**。`QuickAddElementPopup.tsx:185-188` が `text.split('\n')` で行ごとに `NewElementInput` を作り、`InlineAddRow.tsx:271-284` が貼り付けを検知して一括送信する
- 差があるのは**発見性**：`QuickAddElementPopup.tsx:107` のヒント文はフッタの小さいグレー文字（`483-486`、11px / `text-muted-foreground/80`）にしか出ない
- Friction 側の優位点もある：Linear と違い、貼った全行に pill 行の共通プロパティ（status / priority / assignee / labels）が一括適用される（`200-210`）。これは Linear の一括作成より強い

**Friction にどう適用するか**
- ヒント文は消さないが、**2 行以上になった瞬間**にヘッダのチップを `3 Elements` に変える挙動（`245-247`）は既にある。これが実質の発見装置なので、チップをもう少し目立たせる（現状 11px `text-muted-foreground`）
- 主ボタンのラベルが `Create 3` に変わる挙動（`493`）も既にある。ここは維持

---

## パターン 6 — ⌘K コマンドメニューからの作成

**何が起きるか**【文書】 `Cmd/Ctrl + K` でコマンドメニューが開き、作成系の動詞がそこに並ぶ。ドキュメントで名前が確認できるコマンド：
- `Create sub-issue`
- `Create multiple issues`
- `Create new sub-issue from template`
- `Convert into recurring issue`
- `Copy pre-filled create issue URL to clipboard`
- `Remove parent`
出典: https://linear.app/docs/parent-and-sub-issues, https://linear.app/docs/creating-issues

**型の絞り込みプレフィックス**【文書】 検索欄で頭文字＋スペースを打つと結果をその型に絞れる：`I `=issue, `P `=project, `U `=user, `T `=team, `L `=label, `F `=favorite, `D `=document。
出典: https://linear.app/docs/search

**検索とコマンドが別キー**【文書】 `/` = ワークスペース全体検索、`Cmd/Ctrl + F` = 現在のビュー内の絞り込み（打つそばから非該当行が消える。`Esc` でクリア）、`O` → `I` = 最近の issue / ID 検索、`Cmd/Ctrl + K` = コマンド。**探すことと実行することを別キーに分けている**。
出典: https://linear.app/docs/search

**なぜそうなっているか**【推測】 コマンドメニューを「検索結果 + 動詞」の合流点にすると、打った文字列が名詞なのか動詞なのか毎回曖昧になる。Linear は `/` と `⌘K` を分け、`⌘K` 側では選択中の項目に対する動詞を出す（選択してから `⌘K`、というのが Select issues のドキュメントの前提）。

**Friction の現状との差分**
- `web/src/shell/CommandPalette.tsx:28-36` の `NAV_COMMANDS` は **7 件すべてが遷移**。`Go to Home` / `My Elements` / `Open Inbox` / `Domain Elements` / `Objects` / `Notes` / `Settings`
- **作成アクションが 1 つも無い**。「新しい Element を作る」を ⌘K から実行できない
- 型プレフィックスも無い。`globalSearch(query, 6)`（`73`）を投げて `element` / `object` / `note` に後段で振り分けるだけ（`93-97`）
- `⌘K` が検索とナビの両方を兼ねていて、動詞の居場所が無い

**Friction にどう適用するか**
1. `NAV_COMMANDS` の隣に `CREATE_COMMANDS` を作り、`CommandGroup heading="Create"` として**検索結果より上**に置く。最低限：`Element を作成` / `Object を作成` / `Note を作成`
   - `.claude/CLAUDE.md` の用語規約では新規作成は「Element 化 / Object 化」。ラベルはその規約に従う
2. 各行の右端にショートカットヒントを出す（パターン 7 で述べる Linear の行内ヒント）。`C` を実装したら `Element 化 … C`
3. 型プレフィックスは第 2 段階。`e ` / `o ` / `n ` で結果を絞る。`query` を parse して `globalSearch` に kind を渡す形になる
4. 検索とコマンドの分離は Friction では**まだ不要**【推測】。Friction の ⌘K は結果件数が 6 件固定で、まだ混雑していない。動詞を足して混み始めたら分離を検討する

---

## パターン 7 — 作成直後の猶予と下書き

**3 分の猶予**【文書】 作成から 3 分以内のプロパティ変更は「作成作業の一部」とみなされ、変更履歴（activity log）に記録されない。
出典: https://linear.app/docs/creating-issues

**下書き 2 種**【文書】
- アプリ内で別の場所に移動した場合：モーダルは隠れるが内容は**ローカルに**保持され、次に作成を開くとそのまま復元。ログアウト / 再起動で消える
- `Esc` または閉じるボタン：下書きとして保存するか**確認モーダルが出る**。こちらはクライアント間で同期し、ログアウトでも消えない。サイドバーの Drafts から辿れる。6 か月で自動削除
出典: https://linear.app/docs/creating-issues

**なぜそうなっているか**【推測】 3 分の猶予は「作成直後の手直しをノイズとして履歴に残さない」ための実装で、UI ではなくデータモデル側の配慮。下書きの二層は「事故で失うこと」と「意図して中断すること」を別物として扱った結果。

**Friction の現状との差分**
- `QuickAddElementPopup.tsx:164-169` の `Esc` は**即座に `onClose()`**。確認も下書き保存も無い。タイトルと説明を書いた状態で `Esc` を押すと**全部消える**
- しかも `147-160` の open effect が `setText(initialText)` で毎回リセットするので、閉じて開き直すと内容は戻らない
- 3 分猶予に相当するものは無い（Friction の activity log 実装は本調査の範囲外）

**Friction にどう適用するか**
1. `Esc` の扱いを内容の有無で分ける。`text.trim() || description.trim()` が空なら即閉じ、非空なら確認を出す
2. 確認モーダルまで作るのが重いなら、**最小実装として「閉じても内容を保持する」だけを先にやる**。`147-160` の effect でリセットするのをやめ、`onSubmit` 成功時にだけクリアする。これだけで「うっかり Esc で全消し」が消える
3. Drafts 一覧のような永続下書きは、Friction には Note 概念があるので優先度は低い【推測】

---

## パターン 8 — URL によるプリフィル作成

**何が起きるか**【文書】 `https://linear.new?title=...&priority=Urgent&assignee=me&label=bug,android` のように、クエリパラメータで作成フォームを事前に埋めた状態で開ける。対応パラメータ：`title` `description` `status` `team` `priority` `assignee` `estimate` `cycle` `label` `project` `milestone` `links` `template`。`assignee=me` のような擬似値もある。
出典: https://linear.app/docs/creating-issues

**なぜそうなっているか**【推測】 作成の入口を URL にすると、あらゆる外部ツール（ブックマークレット、Slack、社内 wiki、CI の失敗通知）が統合コードを書かずに作成フローへ接続できる。API より敷居が低い統合レイヤ。

**Friction の現状との差分**
- Friction は単一ページ SPA（`web/src/app/`）で、作成用の URL 入口は無い
- ただし `NewElementInput`（`QuickAddElementPopup.tsx:38-50`）は既に `title` / `description` / `type` / `status` / `priority` / `assigneeWorkerIds` / `objectId` / `labels` を受け取れる形になっており、**パラメータ→ペイロードの写像はほぼ 1 対 1**

**Friction にどう適用するか**
- 優先度は低いが、実装コストも低い。`?new=element&title=...&objectId=...` を読んで初期状態でポップアップを開くだけ。AI エージェント（`run-agent` 等）が人間に作成を引き継ぐ導線としては価値がある【推測】

---

## パターン 9 — 作成の周辺：選択とキーボード移動

作成そのものではないが、「作ったあとすぐ触れる」ために必要な前提。【文書】 出典: https://linear.app/docs/select-issues

- `↑ / ↓` または `J / K` で行のハイライト移動。**既定では何も選択されていない**
- `X` でハイライト行を選択（トグル）。`Shift + ↑/↓` で範囲拡張。`Cmd/Ctrl + A` で全選択
- `Esc` で選択解除
- 選択後に `Cmd/Ctrl + K` またはコンテキストメニュー（右クリック）で一括操作
- `Option + ↑/↓` で 1 段ずつ並べ替え、`Option + Shift + ↑/↓` で先頭 / 末尾へ。ただし **Grouping=なし かつ Ordering=Manual のときだけ**有効

**Friction の現状との差分**
- 行のキーボード移動（`J/K`、`↑↓`）が実装されていない。`DESIGN.md` §8 は「すべての行は `↑ ↓` 移動、`Enter` で開く」と宣言しているが、リスト実装側にその処理が無い
- インライン追加行を入れる（パターン 4）と、`↓` でリスト末尾まで来て**そのまま追加行に入る**という連続動作が成立する。行移動の実装はインライン追加とセットで価値が出る【推測】

---

## Friction への適用 — 優先順位

差分の大きさと実装コストで並べたもの。

| # | やること | 対象ファイル | 効果 |
| :--- | :--- | :--- | :--- |
| 1 | `createMore` を足し、`onClose()` を条件化。pill は保持 | `QuickAddElementPopup.tsx:193-220` | 連続作成が成立する。現状は構造的に不可能 |
| 2 | `InlineAddRow` を共有リストのグループ末尾に描画 | `InlineAddRow.tsx`（331 行の完成品）＋ リスト側 | 新規実装ゼロで最速の作成経路が開く |
| 3 | ⌘K に `Create` グループを追加 | `CommandPalette.tsx:28-36` | 作成が動詞として存在するようになる |
| 4 | `Esc` で内容を消さない | `QuickAddElementPopup.tsx:147-169` | データ損失の解消 |
| 5 | グローバル `C` キー ＋ 選択テキストのプリフィル | `shell/` に新規 | キーボード先行の入口 |
| 6 | 行の `J/K` `↑↓` 移動 | 共有リスト | 2 と組んで初めて効く |
| 7 | `⌘+Shift+Enter` で値を引き継いで連続作成 | `QuickAddElementPopup.tsx:264-269` | 1 の上位互換 |

---

## 未検証・積み残し

以下は今回の調査で**裏が取れなかった**。後続の調査者はここから始めるとよい。

- **Linear のコンポーザの送信ショートカット**：`⌘+Enter` か `Enter` か。実測時にキーヒントの DOM を見つけられなかった【未検証】
- **⌘K コマンドメニューの実寸**：Chrome が `Cmd+K` をアドレスバー検索に奪うため、デモ上で開けなかった。プロパティピッカーとフィルタメニューが同一寸法だったことから、コマンドメニューは**別の広い段**を使っている可能性が高いが未確認【未検証】
- **グループヘッダ `+` を押した後の挙動**：インライン行が開くのかモーダルが開くのか。デモでクリックしたが可視の変化を捉えられなかった（ボタンが hover 依存で、クリックが実際に届いたか不明）【未検証】
- **「Create more」on のときフォーカスがどこへ戻るか**：デモ環境で実際に作成する操作は行っていない【未検証】
- Linear 以外のベンチマーク（Height, Notion, Asana）は未着手【未検証】
