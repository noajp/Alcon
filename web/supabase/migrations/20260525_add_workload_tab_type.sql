-- Add 'workload' to the object_tabs.tab_type CHECK constraint so the
-- new per-Worker capacity view can be added as a tab inside Object detail
-- (and Domain detail via the same Object tab rendering pipeline).

ALTER TABLE object_tabs DROP CONSTRAINT IF EXISTS object_tabs_tab_type_check;

ALTER TABLE object_tabs ADD CONSTRAINT object_tabs_tab_type_check
  CHECK (tab_type = ANY (ARRAY[
    'summary'::text,
    'elements'::text,
    'overview'::text,
    'gantt'::text,
    'calendar'::text,
    'workers'::text,
    'custom_view'::text,
    'board'::text,
    'note'::text,
    'workload'::text
  ]));
