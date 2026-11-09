// An agent's output kept as a file in the Space's Artifacts: attached to the
// Element it was made for, so it is found, previewed (Markdown reads
// formatted), downloaded and versioned like any file a person attaches.
// Saving the same title again is the file's next version. Written with the
// starter's JWT, so attachments' RLS and the bucket's policies decide.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "element-files";
/** How much of a file's text the index keeps — the same cap as the
 *  browser extraction and saveTextFile (fileTools' TEXT_CAP). */
const TEXT_CAP = 300_000;

const EXT: Record<string, { ext: string; mime: string }> = {
  markdown: { ext: "md", mime: "text/markdown" },
  text: { ext: "txt", mime: "text/plain" },
  csv: { ext: "csv", mime: "text/csv" },
  json: { ext: "json", mime: "application/json" },
  html: { ext: "html", mime: "text/html" },
};

/** Pure. The file name an output is kept under: its title, made safe for a
 *  file name, with the extension of its format. */
export function artifactFileName(title: string, format: string): string {
  const { ext } = EXT[format] ?? EXT.markdown;
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "output";
  return `${base}.${ext}`;
}

/** Writes the output as the Element's file, or the next version of it. */
export async function saveArtifactFile(db: SupabaseClient, elementId: string, title: string, content: string, format: string): Promise<{ id: string } | { error: string }> {
  const { mime } = EXT[format] ?? EXT.markdown;
  const name = artifactFileName(title, format);
  const ext = name.slice(name.lastIndexOf(".") + 1);
  const bytes = new TextEncoder().encode(content);

  // The version this one replaces: the newest live row of that name.
  const { data: rows } = await db.from("attachments").select("id, previous_id")
    .eq("element_id", elementId).eq("name", name).is("deleted_at", null);
  const list = (rows ?? []) as { id: string; previous_id: string | null }[];
  const replaced = new Set(list.map((r) => r.previous_id).filter(Boolean));
  const previous = list.find((r) => !replaced.has(r.id)) ?? null;

  const path = `element/${elementId}/${crypto.randomUUID()}.${ext}`;
  const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: `${mime}; charset=utf-8` });
  if (up.error) return { error: up.error.message };
  const { data, error } = await db.from("attachments")
    .insert({ path, name, size: bytes.byteLength, mime_type: mime, previous_id: previous?.id ?? null, element_id: elementId })
    .select("id").single();
  if (error || !data) {
    await db.storage.from(BUCKET).remove([path]);
    return { error: error?.message ?? "could not list the file" };
  }
  // Its words, for search, as a person's upload would have them.
  await db.from("attachment_texts").upsert({ attachment_id: data.id, body: content.slice(0, TEXT_CAP), status: "ok", extracted_at: new Date().toISOString() });
  return { id: data.id as string };
}
