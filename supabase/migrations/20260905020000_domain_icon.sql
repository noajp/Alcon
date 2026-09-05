-- Domain settings only ever let you tint the built-in silhouette
-- (DomainMark falls back to <DomainIcon/> whenever there's nothing else to
-- show). ELE_QLT-045 lets a Domain carry its own icon — an emoji or an
-- uploaded image, same idea as an ActivitySpace's Logo (`activity_spaces.logo`)
-- — instead of always wearing the shared glyph. `color` stays a separate axis:
-- it's the chip background behind an emoji/silhouette, ignored once an image
-- is set (DomainMark shows the image as-is, same as ActivitySpaceSettings'
-- logoPreview does for Space logos).
-- Guarded with to_regclass for preview/shadow-DB replay.
do $$
begin
  if to_regclass('public.domains') is null then
    raise notice 'domain icon migration skipped: domains not present';
    return;
  end if;
  execute 'alter table public.domains add column if not exists icon text';
end
$$;
