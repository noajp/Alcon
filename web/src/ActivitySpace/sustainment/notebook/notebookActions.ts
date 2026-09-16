import type { NoteNodeType, NoteNode } from './types';

type CreateNode = (type: NoteNodeType, name: string, parentId: string | null) => Promise<NoteNode>;
type DeleteNode = (id: string) => Promise<void>;

// Seed a brand-new notebook: a root Folder with one Section and one page, so
// it opens straight into an editable page. Every "new notebook" entry point
// (the Notebook sidebar's "+", the global Create menu) goes through here so the
// starting shape is identical. Returns the created folder + first page.
//
// Cleanup lives here (not in callers): if the section or page insert fails,
// the folder id never reaches the caller's catch, so only this function can
// avoid leaving a half-built notebook behind. Deleting the folder cascades to
// any section already created under it.
export async function seedNotebook(
  createNode: CreateNode,
  deleteNode: DeleteNode,
  name = 'New Notebook',
): Promise<{ folder: NoteNode; page: NoteNode }> {
  const folder = await createNode('folder', name, null);
  try {
    const section = await createNode('section', 'New Section', folder.id);
    const page = await createNode('file', 'Untitled', section.id);
    return { folder, page };
  } catch (e) {
    try { await deleteNode(folder.id); } catch { /* best-effort */ }
    throw e;
  }
}
