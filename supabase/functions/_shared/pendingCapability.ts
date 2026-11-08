// Pending-capability rules: a standing instruction a person gave that
// Athena cannot honour yet, because the connector's definition has no
// command for it ("after every merge, delete the branch" — when GitHub's
// manifest had no delete_branch). The rule is recorded, not refused: a
// durable procedure memory whose topic key names the missing capability,
//   pending-capability:<preset>:<command>
// and when the command lands — a connection test rebuilding the
// manifest, a G4 activation, a preset update — the deterministic match
// here surfaces it: an Inbox notification at connection-test completion,
// and a heartbeat signal (fingerprint-deduped, so it is told once).
// The memory stays active either way; honouring it is a conversation,
// and making it standing machinery is the promotion path's job (its
// source A already takes durable procedure memories).
//
// Pure: the key's shape, its parsing, and the match. Writers and
// surfacers bring their own rows.

export const PENDING_CAPABILITY_PREFIX = "pending-capability:";

/** One recorded rule, as the surfacers read it from memories. */
export interface PendingCapabilityRule {
  id: string;
  preset: string;
  command: string;
  title: string;
  created_at: string;
}

type RuleRow = { id: string; topic_key: string | null; title: string; created_at: string };

const foldId = (s: string): string => s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");

/**
 * Pure. The topic key a pending rule for (preset, command) is stored
 * under — folded the way memoryStore's topicKeyOf folds, with ids'
 * spaces removed, so the key the writer writes is the key the matchers
 * parse. Null when either half is empty.
 */
export function pendingCapabilityTopicKey(preset: string, command: string): string | null {
  const p = foldId(preset ?? "");
  const c = foldId(command ?? "");
  if (!p || !c) return null;
  return `${PENDING_CAPABILITY_PREFIX}${p}:${c}`;
}

/** Pure. What a topic key names, when it is a pending-capability key. */
export function parsePendingCapabilityTopicKey(topicKey: string | null | undefined): { preset: string; command: string } | null {
  if (!topicKey || !topicKey.startsWith(PENDING_CAPABILITY_PREFIX)) return null;
  const rest = topicKey.slice(PENDING_CAPABILITY_PREFIX.length);
  const at = rest.indexOf(":");
  if (at <= 0 || at === rest.length - 1) return null;
  return { preset: rest.slice(0, at), command: rest.slice(at + 1) };
}

/**
 * Pure. The recorded rules for one preset whose command has landed:
 * the manifest's command names are the ground truth of what the
 * connection can do now, and a rule matches when its command is among
 * them (folded — manifest names and topic keys are both lowercase ids).
 */
export function matchPendingCapabilities(
  rows: readonly RuleRow[],
  preset: string | null | undefined,
  commandNames: readonly string[],
): PendingCapabilityRule[] {
  if (!preset) return [];
  const wanted = foldId(preset);
  const landed = new Set(commandNames.map(foldId).filter(Boolean));
  if (!landed.size) return [];
  const out: PendingCapabilityRule[] = [];
  for (const row of rows) {
    const parsed = parsePendingCapabilityTopicKey(row.topic_key);
    if (!parsed || parsed.preset !== wanted) continue;
    if (!landed.has(parsed.command)) continue;
    out.push({ id: row.id, preset: parsed.preset, command: parsed.command, title: row.title, created_at: row.created_at });
  }
  return out;
}
