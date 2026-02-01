'use client';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertCircle, LayoutList, LayoutGrid } from 'lucide-react';
import { FileIcon } from '@/shared';
import { cn } from '@/lib/utils';

interface FileHeaderProps {
  name: string;
  elementCount: number;
  progress?: number;
  blockedCount?: number;
  // View toggle
  viewType?: 'list' | 'board';
  onViewChange?: (view: 'list' | 'board') => void;
}

export function FileHeader({
  name,
  elementCount,
  progress,
  blockedCount,
  viewType = 'list',
  onViewChange,
}: FileHeaderProps) {
  return (
    <div className="border-b bg-background">
      <div className="flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-4">
          <FileIcon size="md" />
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
              {blockedCount !== undefined && blockedCount > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {blockedCount} blocked
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2">
              {progress !== undefined && (
                <div className="flex items-center gap-2">
                  <Progress value={progress} className="w-24 h-1.5" />
                  <span className="text-xs text-muted-foreground">{progress}%</span>
                </div>
              )}
              <span className="text-xs text-muted-foreground">{elementCount} elements</span>
            </div>
          </div>
        </div>
      </div>

      {/* View Tabs */}
      {onViewChange && (
        <div className="flex items-center gap-1 px-8">
          <button
            onClick={() => onViewChange('list')}
            className={cn(
              "px-3 py-2 text-sm flex items-center gap-1.5 border-b-2 -mb-px transition-colors",
              viewType === 'list'
                ? 'border-foreground text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <LayoutList className="w-4 h-4" />
            List
          </button>
          <button
            onClick={() => onViewChange('board')}
            className={cn(
              "px-3 py-2 text-sm flex items-center gap-1.5 border-b-2 -mb-px transition-colors",
              viewType === 'board'
                ? 'border-foreground text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <LayoutGrid className="w-4 h-4" />
            Board
          </button>
        </div>
      )}
    </div>
  );
}
