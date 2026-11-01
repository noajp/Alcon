// A stored file's versions: each version names the one it replaces
// (previous_id), so the versions of one file form a chain from the first
// upload to the latest edit.

/** Pure. The rows no other row replaces — each file's latest version. */
export function latestVersions<T extends { id: string; previous_id: string | null }>(rows: T[]): T[] {
  const replaced = new Set(rows.map((r) => r.previous_id).filter(Boolean));
  return rows.filter((r) => !replaced.has(r.id));
}

/** Pure. A file's versions, newest first, from any one of them. */
export function versionChain<T extends { id: string; previous_id: string | null }>(rows: T[], id: string): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const next = new Map(rows.filter((r) => r.previous_id).map((r) => [r.previous_id!, r]));
  let latest = byId.get(id);
  // Walk forward to the newest (bounded, so a broken chain cannot loop).
  for (let steps = 0; latest && next.has(latest.id) && steps < rows.length; steps++) latest = next.get(latest.id);
  const out: T[] = [];
  for (let v = latest; v && !out.includes(v); v = v.previous_id ? byId.get(v.previous_id) : undefined) out.push(v);
  return out;
}
