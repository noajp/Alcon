'use client';

import { useState } from 'react';
import { FileHeader } from './FileHeader';
import { ElementList, FileGroup } from '@/components/elements';

interface FileViewProps {
  name: string;
  files: FileGroup[];
  blockedCount?: number;
  onElementClick?: (elementId: string) => void;
  onElementComplete?: (elementId: string, completed: boolean) => void;
}

export function FileView({
  name,
  files,
  blockedCount,
  onElementClick,
  onElementComplete,
}: FileViewProps) {
  const [viewType, setViewType] = useState<'list' | 'board'>('list');

  // Calculate totals
  const allElements = files.flatMap(f => f.elements);
  const doneElements = allElements.filter(e => e.status === 'done').length;
  const progress = allElements.length > 0 ? Math.round((doneElements / allElements.length) * 100) : 0;

  return (
    <>
      <FileHeader
        name={name}
        elementCount={allElements.length}
        progress={progress}
        blockedCount={blockedCount}
        viewType={viewType}
        onViewChange={setViewType}
      />

      <div className="flex-1 overflow-auto bg-background p-4">
        {viewType === 'list' ? (
          <ElementList
            files={files}
            onElementClick={onElementClick}
            onElementComplete={onElementComplete}
          />
        ) : (
          <div className="text-center text-muted-foreground py-20">
            Board view coming soon
          </div>
        )}
      </div>
    </>
  );
}
