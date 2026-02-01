'use client';

import { useState, useEffect } from 'react';
import { FileText, Folder } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDocuments, updateDocument } from '@/hooks/useSupabase';
import type { Document as AlconDocument, DocumentWithChildren } from '@/hooks/useSupabase';
import type { NavigationState } from '@/components/layout/Sidebar';
import dynamic from 'next/dynamic';

const BlockEditor = dynamic(
  () => import('@/components/editor/BlockEditor').then(mod => mod.BlockEditor),
  { ssr: false, loading: () => <div className="p-4 text-muted-foreground">Loading editor...</div> }
);

interface NotesViewProps {
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
}

export function NotesView({ navigation, onNavigate }: NotesViewProps) {
  const { documents, documentTree, refetch: refetchDocs } = useDocuments();
  const [selectedDoc, setSelectedDoc] = useState<AlconDocument | null>(null);
  const [titleValue, setTitleValue] = useState('');

  // Find document by ID in the tree
  const findDocById = (docs: DocumentWithChildren[], docId: string): AlconDocument | null => {
    for (const doc of docs) {
      if (doc.id === docId) return doc;
      if (doc.children) {
        const found = findDocById(doc.children, docId);
        if (found) return found;
      }
    }
    return null;
  };

  // Update selected document when documentId or tree changes
  useEffect(() => {
    if (navigation.documentId) {
      const doc = findDocById(documentTree, navigation.documentId);
      setSelectedDoc(doc);
      if (doc) {
        setTitleValue(doc.title || '');
      }
    } else {
      setSelectedDoc(null);
      setTitleValue('');
    }
  }, [navigation.documentId, documentTree]);

  const handleContentChange = async (content: string) => {
    if (!selectedDoc || selectedDoc.type !== 'page') return;
    try {
      await updateDocument(selectedDoc.id, { content: JSON.parse(content) });
    } catch (err) {
      console.error('Failed to save document content:', err);
    }
  };

  const handleTitleChange = async () => {
    if (!selectedDoc) return;
    if (titleValue !== selectedDoc.title) {
      try {
        await updateDocument(selectedDoc.id, { title: titleValue });
        refetchDocs();
      } catch (err) {
        console.error('Failed to update title:', err);
      }
    }
  };

  // Empty state
  if (!navigation.documentId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background">
        <Card className="border-none bg-transparent shadow-none">
          <CardContent className="text-center pt-6">
            <div className="text-6xl mb-4">
              <FileText size={64} className="mx-auto text-muted-foreground" />
            </div>
            <h2 className="text-xl font-medium mb-2">Select a page</h2>
            <p className="text-sm text-muted-foreground">
              Choose a page from the sidebar or create a new one to get started.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Folder view
  if (selectedDoc && selectedDoc.type === 'folder') {
    const childDocs = documents.filter(d => d.parent_id === selectedDoc.id);
    return (
      <div className="flex-1 flex flex-col bg-background">
        <ScrollArea className="flex-1">
          <div className="max-w-3xl mx-auto w-full px-24 pt-20 pb-32">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-4xl">{selectedDoc.icon || <Folder size={48} className="text-muted-foreground" />}</span>
            </div>
            <h1 className="text-4xl font-bold mb-8">
              {selectedDoc.title || 'Untitled'}
            </h1>
            <div className="space-y-1">
              {childDocs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pages inside this folder yet.</p>
              ) : (
                childDocs.map(child => (
                  <Card
                    key={child.id}
                    className="cursor-pointer hover:bg-accent transition-colors"
                    onClick={() => onNavigate({ documentId: child.id })}
                  >
                    <CardContent className="flex items-center gap-3 p-3">
                      {child.icon ? (
                        <span className="text-lg">{child.icon}</span>
                      ) : child.type === 'folder' ? (
                        <Folder size={18} className="text-muted-foreground" />
                      ) : (
                        <FileText size={18} className="text-muted-foreground" />
                      )}
                      <span className="text-sm">{child.title || 'Untitled'}</span>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Page view
  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden">
      <div
        id="notes-toolbar-container"
        className="border-b border-border bg-card px-4 py-1 flex items-center gap-1 min-h-[44px]"
      />
      <ScrollArea className="flex-1">
        <div className="max-w-4xl w-full px-12 pt-12 pb-32">
          <div className="mb-4">
            {selectedDoc?.icon && (
              <span className="text-6xl block mb-4">{selectedDoc.icon}</span>
            )}
            <input
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleTitleChange();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Untitled"
              className="no-focus-ring text-4xl font-bold w-full bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="notion-editor">
            <BlockEditor
              key={selectedDoc?.id}
              initialContent={
                selectedDoc && Array.isArray(selectedDoc.content)
                  ? JSON.stringify(selectedDoc.content)
                  : undefined
              }
              onChange={handleContentChange}
              toolbarContainerId="notes-toolbar-container"
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
