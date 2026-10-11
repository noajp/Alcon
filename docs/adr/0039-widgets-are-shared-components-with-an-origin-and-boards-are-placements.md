# 0039 — Widget は出自を持つ共有部品、ボードはその配置

## 背景

Widget は Strategy / Execution / Sustainment の三分類を補完する情報を映す掲示板（ボード）として位置付ける。Microsoft Loop のように、同じ対象を見る人が同じボードを見て、部品を別の場所に置いても1つのものとして同期する。

[0020](0020-widget-data-and-addressable-boards.md) の実装はそうなっていなかった。

- `widget_boards` は `owner_id` ごとの行で、RLS も本人のみ。同じ Object を開いても人によって別のボードが見える。
- Widget はボードの `layout` jsonb の中の1要素で、ボードの外に存在できない。2枚のボードに同じ Widget は置けない。
- 保存はボード全体の jsonb を `revision` 付きで上書きする。衝突すると「再読み込みしてやり直し」になる。

決定の時点で `widget_boards` と `widget_apps` は 0 行だった。

Loop の共有は「ワークスペースに入れた人は全員編集可」「部品はリンクで個別に渡せる」「部品の権限は置き場所に従い、貼った先の人にも開く」という割り切りで、Fluid Framework（順序付きの操作ログ＋スナップショットを Azure Fluid Relay で中継）で同期する。

## 選択肢

同期の基盤:

1. **Fluid Framework を採用する** — 中継サーバーを足し、中身を Fluid のコンテナに置く。
2. **Supabase 上に作る** — 行と RLS で持ち、Realtime で配る。
3. **個人ボードのまま、Widget の中身だけ共有する。**

Widget の権限:

- a. **Loop 方式** — 貼った先のボードを見られる人にも開く。
- b. **出自方式** — Widget は生まれた対象の権限を持ち、どこに置いても広がらない。

配置の保存:

- i. ボードごとの jsonb を、編集を再適用して衝突を解く。
- ii. 配置を行にする。

## 決定

2・b・ii。

### 3つのテーブル、規則は1つ

| 実体 | 持つもの | 見られる人 ＝ 編集できる人 |
|---|---|---|
| `widgets` | 種類（`kind`）、設定（`params`）、出自（`origin_kind` + `origin_id`） | 出自を見られる人 |
| `boards` | 面（`surface`）と対象（`subject_kind` + `subject_id`）ごとに1行。外した既定の id（`dismissed_defaults`） | 対象を見られる人 |
| `board_placements` | ボードと Widget の組、zone、順序（`position`）、幅 | ボードを見られる人 |

対象と出自は同じ種類のもの（`me` / `domain` / `object` / `element` / `initiative`）で、可視性は `user_can_see_widget_subject(kind, id)` の1関数が既存の `user_can_see_domain` / `_object` / `_element` / `_strategy` に委ねる。`me` は本人。Widget 専用の権限は作らない。

- **Object / Domain / Initiative / Element のボードは対象に1枚。** 見られる人が全員同じものを見て、並べ替えられる。
- **Home は個人のボード**（`subject_kind = 'me'`）で、Space ごとに持つ（`space_id`）。
- **Widget は生まれたボードの対象を出自にする。** 定義が `personal` の Widget だけは作成者（`me`）を出自にする — 中身をまだ人ごとに持つもの（[0024](0024-generated-apps-live-in-object-widgets.md) の生成アプリ）。
- **置けるのは見られる Widget だけ、置いても広がらない。** 配置の insert は Widget が見えることを RLS で要求する。置かれた後は、Widget を見られない人にも配置の行だけが見える。クライアントはそれを中身のない枠（「Private widget」）として描く。ボードを見られる人は誰でも zone の中で並べ替えられるが、**別の zone へ移せるのも、外せるのも、その Widget を見られる人だけ**（配置の delete は RLS で、zone の変更はトリガで、Widget が見えることを要求する）。
- **種類と出自は変えられない。** 作成後の update をトリガで拒む。

### 既定配置は最初の編集まで行にしない

面の既定配置は `defaults.ts` にあり、誰かがそのボードを編集するまで行を作らない（開かれただけの Element ごとに行が増えるのを避ける）。読むときは保存済みの配置に、まだ行のない既定を `reconcileBoard` が既定の位置へ差し込む。後のリリースで既定が増えたボードも同じ経路で受け取る。

最初の編集で `ensure_board` がボードの行と、その時点で見えていた既定を書く。既定の Widget の id は `md5(board_id:default_id)` で、**2人が同時に最初の編集をしても1組しかできない**。`dismissed_defaults` にある既定と、既に置かれている singleton は書かない。

### 編集は行単位

- 追加: `add_widget`（Widget と最初の配置を1トランザクションで）。
- 移動・幅: `board_placements` の update。順序は隣との中間値。zone を変えられるのは Widget を見られる人だけ。
- 設定: `merge_widget_params`（`params || patch`）。別々の設定を同時に変えても両方残る。
- 外す: 配置の delete。トリガが、既定なら `dismissed_defaults` に記録し、どのボードにも置かれていない Widget を消す。
- リセット: `reset_board`。呼び出した人が見られる配置をすべて外し、`dismissed_defaults` を空にする。見られない Widget の配置は残る。
- `boards` の行はクライアントから消せない。対象（Object など）が消えたときに、そのボードと、それを出自にする Widget、そのボードにしか置かれていなかった Widget を消す（definer のトリガ）。

クライアントは編集を楽観的に表示し、直列のキューで書き、最後の編集が確定して読み直すまでその表示を保つ。

### 配信

3テーブルを `supabase_realtime` に入れ、既存の `deltaStream` がボードのクエリを無効化する。Realtime は RLS を通った行だけを配るので、見えないボードの変更は届かない。

### 人と AI は同じ行に書く

Copilot の `widgetBoard` は `boards` / `board_placements` / `widgets` と上記の RPC を、呼び出した人の JWT で使う。`analyzeOperations` は Widget の id で設定を読む。

### 置き場

純粋な規則（行 → 配置、既定の差し込み、順序、楽観適用）は `Function/widget/boardModel.ts`。Supabase への読み書きは `hooks/useWidgetBoard.ts`。面と対象の対応（`SURFACE_SUBJECT`）は `boardModel.ts` と Copilot の `widgetTools.ts` の両方にあり、テストで一致を固定する。

## 根拠

**Fluid を採らない理由。** 中継サーバー（Azure Fluid Relay か自前）が増え、中身が Postgres の外に出る。RLS が効かず、Edge Functions や MCP の AI が同じ権限で読み書きできない。「人と AI が同じ永続データを操作する」原則と衝突する。配置と設定は行の単位で衝突が小さく、行と Realtime で足りる。

**個人ボードのままにしない理由。** 「同じ対象を見る人が同じ掲示板を見る」ことが目的そのもので、中身だけ共有してもボードが人ごとに違えば、同じものを指して話せない。

**配置を行にする理由。** Widget を2枚のボードに置くには、Widget がボードの外に存在する必要がある。行なら Widget の削除で配置が外部キーで消え、「消えた Widget」と「見られない Widget」が区別できる（jsonb の参照ではどちらも「読めない id」になる）。1人の並べ替えが他人の並べ替えを上書きすることもない。

**出自方式を採り、Loop 方式を捨てた理由。** Loop は貼った先の人にも開くが、Alcon では配置という軽い操作で RLS の範囲を越えることになる。出自方式は「見られるものしか置けない」「置いても広がらない」の2つで閉じ、既存の可視性関数に委ねるだけで済む。失うのは「貼れば共有できる」手軽さ。

**見られる ⇔ 編集できる、にする理由。** Loop も Alcon の Element も同じ割り切りで、閲覧専用を Widget にだけ作ると権限の粒度が他と食い違う。閲覧専用が要るなら、メンバーシップの役割として足す。

**見られない Widget を外せなくする理由。** 外せると、ほかのメンバーが枠を片付けた時点で、その Widget はどのボードにも置かれていない行として残り、持ち主が辿り着く手段がなくなる。見えないものを壊せるより、片付けられない枠が残るほうを取る。枠は持ち主か、出自を見られる人が外す。

**見られない Widget を別の zone へ移せなくする理由。** Widget は種類ごとに置ける zone が決まっているが、見られない人には種類がわからない。合わない zone へ移されると、見られる人の画面はその配置を描かず、画面から戻す手段もなくなる。zone は見られる人が選んだままにし、順序だけをボードの全員に開く。

**既定を最初の編集まで行にしない理由。** 開いただけで行を作ると、読み取りが書き込みになり、Element の数だけボードの行ができる。id を導出にしたのは、同時の最初の編集を冪等にするため。

**既存データを移さない理由。** 0 行だった。ブラウザの localStorage にだけ残る古い配置も読まない。`widget_boards` のテーブルは残す — CRM が以前の Table 設定を一度だけ取り込む経路（`useCrm`）がまだ読むため。

## 覆す条件

- **中身を自分で持つ Widget を共同編集する**（表計算、チェックリスト、生成アプリの入力）。設定のマージでは足りず、順序付きの操作ログとスナップショットが要る。そのとき `personal` を「共有する」操作（出自の変更）と合わせて別 ADR で決める。
- **Widget を別のボードに置く UI を作る**（Initiative のボードに Object の Widget）。スキーマと RLS は対応済みだが、外したときに中身のある Widget を消してよいかを決め直す。
- 閲覧専用の共有が繰り返し求められる — メンバーシップに役割を足すか、Widget 単位の閲覧リンクを決める。
- 「置いた先の人にも開く」が運用で何度も求められる — 配置時に明示の確認を挟む形で Loop 方式に寄せる。
- Table の共有が決まる — 共有ボードの `data-view` が Table を見られない人に何も出せない状態が解消され、Table を Widget の出自にできる。
- 見られない枠がボードに溜まり、持ち主が外さないまま邪魔になる — 持ち主に戻す（個人の置き場へ移す）操作を足す。
- Realtime の配信が遅延・取りこぼしを起こし、他人の編集が見えない — 配信路を見直す。
