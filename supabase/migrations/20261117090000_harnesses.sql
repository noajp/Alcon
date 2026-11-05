-- Harnesses: how a kind of work is carried out by AI. A harness is a row of
-- `definitions` (Markdown the engine reads, see _shared/definition.ts); it
-- names the connectors it uses under "# 使うコネクタ", so packs, which only
-- bundled definitions with connectors, are gone from the catalog.
--
--   activity_spaces.default_definition_id   the harness a Strategy is worked
--                   by when it names none of its own: the Planner breaks the
--                   Strategy down by its "# 分け方". Null: Alcon's built-in way.
--   catalog_items   'def.strategy-default' is that built-in way, written out
--                   so a Space can copy it and change how it breaks work down.
--
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  if to_regclass('public.activity_spaces') is not null and to_regclass('public.definitions') is not null then
    execute 'alter table public.activity_spaces add column if not exists default_definition_id uuid references public.definitions(id) on delete set null';
  else
    raise notice 'activity_spaces.default_definition_id skipped: base tables not present';
  end if;

  if to_regclass('public.catalog_items') is not null then
    execute $sql$delete from public.catalog_items where kind = 'pack'$sql$;

    execute $sql$
      update public.catalog_items set body = body || E'\n\n# 使うコネクタ\n- GitHub\n', updated_at = now()
      where id = 'def.improve-loop' and body not like '%# 使うコネクタ%'
    $sql$;
    execute $sql$
      update public.catalog_items set body = body || E'\n\n# 使うコネクタ\n- Notion\n', updated_at = now()
      where id = 'def.competitor-research' and body not like '%# 使うコネクタ%'
    $sql$;

    execute $sql$
      insert into public.catalog_items (id, kind, name, description, body, payload, sort) values
      ('def.strategy-default', 'definition', 'Strategy の進め方（Alcon の既定）',
       'Strategy を成果物（Object）ごとに分け、AI と人の仕事に分解する。分け方を変えたいときは、これを追加して書き換える。',
       $def$# 目的
Strategy の目的と成功条件から逆算して、達成までの仕事を分解し、実行する。

# 分け方
- 成果物ごとに Object を分ける。一つの Object には、同じ成果物に向かう Element をまとめる
- Element は、一人または一つの AI が一度の作業で終えられる大きさにする。全体で 3〜12 個が目安
- 調査・下書き・集計・分析・文書化・コードは AI に、判断・合意・対外的な約束・現物の作業は人に割り当てる
- 人の判断・決定・確認は AI の Element に埋め込まず、問いそのものを題名にした判断の Element として分ける
- 前提が崩れていないかを確かめる Element が要るなら入れる
- 順序があるものだけ依存を付け、並べられるものは並べる

# 止める条件
- 前提が崩れたら、推測で進めず人に聞く
- 権限を超える判断が要るときは、人に聞く

# 点検
- どの Element も、どの成功条件に効くかが分かる
- 人が判断する所が、判断の Element として出ている
$def$, '{}'::jsonb, 0)
      on conflict (id) do update set name = excluded.name, description = excluded.description, body = excluded.body, sort = excluded.sort, updated_at = now()
    $sql$;
  end if;
end $$;
