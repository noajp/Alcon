'use client';

import { FolderHeader } from './FolderHeader';
import { FolderList, FolderListItem } from './FolderList';

type HierarchyLevel = 'system' | 'object' | 'structure' | 'unit' | 'element';

// Define hierarchy order for computing child level
const HIERARCHY_ORDER: HierarchyLevel[] = ['system', 'object', 'structure', 'unit', 'element'];

interface FolderViewProps {
  name: string;
  items: FolderListItem[];
  level?: HierarchyLevel;
  onItemClick: (item: FolderListItem) => void;
  emptyMessage?: string;
}

export function FolderView({
  name,
  items,
  level = 'object',
  onItemClick,
  emptyMessage,
}: FolderViewProps) {
  // Items in the list are one level deeper than the current view
  const currentIndex = HIERARCHY_ORDER.indexOf(level);
  const itemLevel = HIERARCHY_ORDER[Math.min(currentIndex + 1, HIERARCHY_ORDER.length - 1)];

  return (
    <div className="flex-1 overflow-auto bg-background">
      <FolderHeader
        name={name}
        itemCount={items.length}
        itemLabel="items"
        level={level}
      />
      <div className="p-4">
        <FolderList
          items={items}
          onItemClick={onItemClick}
          emptyMessage={emptyMessage}
          itemLevel={itemLevel}
        />
      </div>
    </div>
  );
}
