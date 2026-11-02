import type { ElementWithDetails } from '@/hooks/useSupabase';
import type { ListSection } from '@/Function/shared/listTable/shared';

// The Elements a list's sections actually show, in section order, each once.
// Board / Calendar / Gantt take the List's filtered sections through this so
// they show exactly the Elements the List shows. An Element can sit in more
// than one band (multi-homed, or several labels / assignees), so dedupe by id.
export function sectionElements(sections: ListSection[]): ElementWithDetails[] {
  const seen = new Set<string>();
  const out: ElementWithDetails[] = [];
  for (const sec of sections) {
    for (const el of sec.elements ?? []) {
      if (seen.has(el.id)) continue;
      seen.add(el.id);
      out.push(el);
    }
  }
  return out;
}
