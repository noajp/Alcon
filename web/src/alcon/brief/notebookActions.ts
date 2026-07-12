import type { NoteNodeType, NoteNode } from './types';

type CreateNode = (type: NoteNodeType, name: string, parentId: string | null) => Promise<NoteNode>;

// Seed a brand-new notebook: a root Folder with one Section and one page, so
// it opens straight into an editable page. Every "new notebook" entry point
// (the Notebook sidebar's "+", the global Create menu) goes through here so the
// starting shape is identical. Returns the created folder + first page.
export async function seedNotebook(createNode: CreateNode): Promise<{ folder: NoteNode; page: NoteNode }> {
  const folder = await createNode('folder', 'New Notebook', null);
  const section = await createNode('section', 'New Section', folder.id);
  const page = await createNode('file', 'Untitled', section.id);
  return { folder, page };
}
