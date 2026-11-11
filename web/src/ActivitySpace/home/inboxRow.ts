// What one Inbox row says, in reading order. A notification's own title is
// often a stock phrase ("Claude: 完了報告", "エージェントがエラーで一時停止
// しました"), so the row leads with the Element it is about, when there is
// one its title does not already name; the title follows as what happened,
// and the body is the detail.

export interface InboxRowText {
  /** What it is about — the first line. */
  subject: string;
  /** What happened, when the subject is the Element. */
  event: string | null;
  detail: string | null;
}

/** Pure. */
export function inboxRowText(n: { title: string; body: string | null; element?: { title: string } | null }): InboxRowText {
  const about = n.element?.title?.trim() || null;
  const detail = n.body?.trim() || null;
  if (about && !n.title.includes(about)) return { subject: about, event: n.title, detail };
  return { subject: n.title, event: null, detail };
}
