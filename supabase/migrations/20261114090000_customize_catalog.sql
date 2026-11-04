-- The catalog Settings › Customize discovers from: definitions Alcon offers
-- to start from, and packs that bundle definitions with the connectors their
-- work needs. A Space adds a definition by copying it into its own library
-- (definitions.source_id names where it came from); a pack adds its
-- definitions and lists its connectors to connect.
--
--   catalog_items   kind 'definition': body is the Markdown definition.
--                   kind 'pack': payload { definitions: [catalog ids],
--                   connectors: [{ preset } | { registry, title }] }.
--                   Read by every signed-in person; written only here.
--   definitions.source_id   the catalog item a Space's definition was added from.
--
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  execute $sql$
    create table if not exists public.catalog_items (
      id text primary key,
      kind text not null check (kind in ('definition', 'pack')),
      name text not null,
      description text not null default '',
      body text,
      payload jsonb not null default '{}'::jsonb,
      sort integer not null default 0,
      updated_at timestamptz not null default now()
    )
  $sql$;
  execute 'alter table public.catalog_items enable row level security';
  execute 'revoke all on public.catalog_items from anon, authenticated';
  execute 'grant select on public.catalog_items to authenticated';
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catalog_items' and policyname = 'catalog_items_read') then
    execute 'create policy catalog_items_read on public.catalog_items for select to authenticated using (true)';
  end if;
  if to_regclass('public.definitions') is not null then
    execute 'alter table public.definitions add column if not exists source_id text';
  end if;
end $$;

insert into public.catalog_items (id, kind, name, description, body, payload, sort) values
('def.web-research', 'definition', 'Web 調査（出典つき）', '問いに Web で答える。事実ごとに出典を付け、確かめられないことはそう書く。', $def$# 目的
依頼された問いに、Web で確かめた事実で答える。

# 条件
- 事実・数値・固有名詞には出典の URL を付ける
- 同じ検索語・同じページを繰り返さない。一覧ページを見つけたら中身を読む
- 確かめられなかったことは「未確認」と書き、推測で埋めない

# 進め方
1. 問いを、答えに要る小さな問いに分ける
2. 小さな問いごとに検索し、信頼できる一次情報（公式・統計・原典）を優先して読む
3. 食い違う情報があれば両方を出典つきで並べる
4. 分かったことを結論から書く

# 点検
- 結論が問いに答えている
- 事実ごとに出典がある
- 未確認の点が明示されている

# 成果物の型
```md
# 結論
# 根拠
# 未確認の点
# 出典
```
$def$, '{}', 10),
('def.collect-candidates', 'definition', '候補を集めて表にする', '条件に合う候補（物件・取引先・製品など）を探し、1 件 1 行で Strategy の表に保存する。', $def$# 目的
条件に合う候補を集め、後の仕事が比べたり絞ったりできる表にする。

# 条件
- 候補は save_records で Strategy の表に 1 件 1 行で保存する。行を見分ける列（URL か名前）を key にする
- 金額・広さ・件数は単位なしの数値で入れ、単位は列名に書く。分からない値は空にする
- 各行に出典の URL を入れる
- 条件に合わない候補は入れない。条件を満たすか分からない点は備考に書く

# 進め方
1. Strategy の前提と成功条件から、候補の条件を箇条書きにする
2. 検索と一覧ページで候補を探す。詳細ページで条件を確かめる
3. 見つけたら都度 save_records で保存する（まとめて最後に保存しない）
4. 目標の件数に届いたら、条件ごとの充足を見直して終える

# 止める条件
- 目標の件数（Element の説明に書かれた数、なければ 10 件）に届いたら止める
- 30 周まで

# 点検 (5周ごと)
- 保存した行の key が重複していない
- 数値の列に文字が入っていない
- 各行に出典がある
$def$, '{}', 20),
('def.compare-report', 'definition', '候補の比較レポート', 'Strategy の表の候補を、成功条件に照らして比べ、推薦と理由をまとめる。', $def$# 目的
集めた候補を比べ、どれを選ぶべきかを根拠つきで示す。

# 条件
- 候補は read_records で Strategy の表から読む。探し直さない
- 比べる観点は Strategy の成功条件と前提から取る
- 推薦には、選ばなかった候補との違いを書く
- 表にない情報を足したら、その出典を書き、表にも save_records で反映する

# 進め方
1. 表を読み、比べる観点を決める
2. 観点ごとに候補を並べ、条件を満たさないものを外す
3. 残りを順位づけし、上位 3 件を推薦する
4. 決めるために人が確かめるべきこと（内見・見積もり・契約条件など）を挙げる

# 成果物の型
```md
# 推薦
# 比較表
# 外した候補と理由
# 人が確かめること
```
$def$, '{}', 30),
('def.competitor-research', 'definition', '競合調査', '競合の製品・価格・強み弱みを調べ、表と要点にまとめる。', $def$# 目的
競合を把握し、自分たちの打ち手を考える材料にする。

# 条件
- 競合ごとに 1 行で、Strategy の表「競合」に save_records で保存する（key は社名か製品名）
- 価格は公開されている数値だけを入れ、出典を付ける
- 推測と事実を分けて書く

# 進め方
1. 競合の候補を挙げる（検索・比較記事・業界の一覧）
2. 競合ごとに、対象顧客・主な機能・価格・強み・弱みを調べて表に保存する
3. 表から、空いている領域と避けるべき正面衝突を書き出す

# 成果物の型
```md
# 要点
# 競合の地図
# 空いている領域
# 出典
```
$def$, '{}', 40),
('def.improve-loop', 'definition', '改善ループ（指標を上げ続ける）', '1 つの指標を決め、仮説→変更→計測を繰り返して上げる。良くならない変更は戻す。', $def$# 目的
1 つの指標を、変更を積み重ねて改善する。

# 条件
- 1 周で変えるのは 1 つだけ。何を変えたかを必ず記録する
- 計測してから残すか戻すかを決める。良くならない変更は戻す
- 壊しても困らない環境（使い捨ての仮想マシンなど）で試す

# 指標
- スコア（大きいほど良い）: Element の説明に書かれた計測方法で測る

# 進め方
1. いまの値を計測する（0 周目）
2. 一番効きそうな仮説を 1 つ選び、変更する
3. 計測し、record_round で値・変えたこと・残したか戻したかを記録する
4. 2 に戻る

# 止める条件
- 50 周まで
- $20 まで

# 点検 (10周ごと)
- 直近 10 周で値が上がっていなければ、仮説の立て方を変える
- 戻した変更が残っていない
$def$, '{}', 50),
('def.minutes-to-elements', 'definition', '議事録から次の行動を起こす', '議事録やメモから、決まったことと次の行動を取り出し、Element にする。', $def$# 目的
会議で決まったことを、実行される行動に変える。

# 条件
- 決定・宿題・未決事項を分けて取り出す
- 宿題は担当と期限が分かれば Element にして割り当てる。分からなければ未決事項に入れる
- 既にある Element と重複させない（findByText で確かめる）

# 進め方
1. 議事録（Element の説明・添付・コメント）を読む
2. 決定・宿題・未決事項に分ける
3. 宿題を createElement で Element にする
4. 未決事項は、誰が決めるべきかを添えて報告する

# 成果物の型
```md
# 決まったこと
# 次の行動
# 未決事項
```
$def$, '{}', 60),
('pack.property-search', 'pack', '拠点・物件探し', '条件に合う物件を集めて表にし、比較して推薦する。', null,
 '{"definitions": ["def.collect-candidates", "def.compare-report"], "connectors": []}', 10),
('pack.market-research', 'pack', '市場・競合調査', '市場を Web で調べ、競合を表にまとめ、打ち手を比べる。', null,
 '{"definitions": ["def.web-research", "def.competitor-research", "def.compare-report"], "connectors": [{"registry": "com.notion/mcp", "title": "Notion"}]}', 20),
('pack.software-dev', 'pack', 'ソフトウェア開発', 'GitHub で変更を作り、指標を改善するループを回す。', null,
 '{"definitions": ["def.improve-loop", "def.minutes-to-elements"], "connectors": [{"preset": "github"}, {"preset": "linear"}]}', 30)
on conflict (id) do update set kind = excluded.kind, name = excluded.name, description = excluded.description,
  body = excluded.body, payload = excluded.payload, sort = excluded.sort, updated_at = now();
