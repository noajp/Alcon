'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ChevronRight } from 'lucide-react';
import { HierarchyIcon } from '@/shared';

type HierarchyLevel = 'system' | 'object' | 'structure' | 'unit' | 'element';

export interface FolderListItem {
  id: string;
  name: string;
  itemCount?: number;
  itemLabel?: string;
}

interface FolderListProps {
  items: FolderListItem[];
  onItemClick: (item: FolderListItem) => void;
  emptyMessage?: string;
  itemLevel?: HierarchyLevel;
}

export function FolderList({ items, onItemClick, emptyMessage = 'This folder is empty', itemLevel = 'object' }: FolderListProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <HierarchyIcon level={itemLevel} size="lg" className="mb-4" />
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-12">#</TableHead>
          <TableHead>Name</TableHead>
          <TableHead className="w-32 text-right">Count</TableHead>
          <TableHead className="w-12"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item, index) => (
          <TableRow
            key={item.id}
            className="cursor-pointer"
            onClick={() => onItemClick(item)}
          >
            <TableCell className="font-mono text-xs text-muted-foreground">
              {index + 1}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-3">
                <HierarchyIcon level={itemLevel} size="sm" />
                <span className="font-medium">{item.name}</span>
              </div>
            </TableCell>
            <TableCell className="text-right">
              {item.itemCount !== undefined && (
                <Badge variant="secondary" className="font-normal">
                  {item.itemCount} {item.itemLabel || (item.itemCount === 1 ? 'item' : 'items')}
                </Badge>
              )}
            </TableCell>
            <TableCell>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
