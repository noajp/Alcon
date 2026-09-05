'use client';

import { supabase } from '@/lib/supabase';
import type { Document, DocumentInsert, DocumentUpdate, DocumentWithChildren } from '@/types/database';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';


// ============================================
// Documents CRUD (Notion-like global documents)
// ============================================

// Build document tree from flat list
function buildDocumentTree(documents: Document[], parentId: string | null = null): DocumentWithChildren[] {
  return documents
    .filter(d => d.parent_id === parentId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    .map(doc => ({
      ...doc,
      children: buildDocumentTree(documents, doc.id),
    }));
}

// Fetch all documents
export async function fetchDocuments(): Promise<Document[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .order('order_index', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Create document
export async function createDocument(doc: DocumentInsert): Promise<Document> {
  const { data, error } = await supabase
    .from('documents')
    .insert(doc)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update document
export async function updateDocument(docId: string, updates: DocumentUpdate): Promise<Document> {
  const { data, error } = await supabase
    .from('documents')
    .update(updates)
    .eq('id', docId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete document (cascades to children)
export async function deleteDocument(docId: string): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', docId);

  if (error) throw error;
}

// Move document to a new parent (drag and drop)
export async function moveDocument(docId: string, newParentId: string | null): Promise<Document> {
  const { data, error } = await supabase
    .from('documents')
    .update({ parent_id: newParentId })
    .eq('id', docId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Hook: Fetch all documents as a tree
const DOCUMENTS_QUERY_KEY = ['documents'] as const;
const EMPTY_DOCUMENTS: Document[] = [];
const EMPTY_DOCUMENT_TREE: DocumentWithChildren[] = [];

export function useDocuments() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: DOCUMENTS_QUERY_KEY, queryFn: fetchDocuments });
  const documents = query.data ?? EMPTY_DOCUMENTS;
  const documentTree = useMemo(
    () => (query.data ? buildDocumentTree(query.data) : EMPTY_DOCUMENT_TREE),
    [query.data],
  );
  const refetch = useCallback(async () => { await qc.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY }); }, [qc]);
  return {
    documents,
    documentTree,
    loading: query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch,
  };
}
