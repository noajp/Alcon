'use client';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Plus, AlertCircle } from 'lucide-react';
import { HierarchyIcon } from '@/shared';

type HierarchyLevel = 'system' | 'object' | 'structure' | 'unit' | 'element';

interface FolderHeaderProps {
  name: string;
  itemCount?: number;
  itemLabel?: string;
  level?: HierarchyLevel;
  // Progress props (optional)
  progress?: number;
  blockedCount?: number;
  // Action props (optional)
  onAddClick?: () => void;
  addLabel?: string;
}

export function FolderHeader({
  name,
  itemCount,
  itemLabel = 'items',
  level = 'object',
  progress,
  blockedCount,
  onAddClick,
  addLabel = 'Add',
}: FolderHeaderProps) {
  const showProgress = progress !== undefined;

  return (
    <div className="border-b bg-background">
      <div className="flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-4">
          <HierarchyIcon level={level} size="md" />
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
            {showProgress ? (
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-2">
                  <Progress value={progress} className="w-24 h-1.5" />
                  <span className="text-xs text-muted-foreground">{progress}%</span>
                </div>
                {itemCount !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    {itemCount} {itemLabel}
                  </span>
                )}
              </div>
            ) : (
              itemCount !== undefined && (
                <p className="text-sm text-muted-foreground">
                  {itemCount} {itemLabel}
                </p>
              )
            )}
          </div>
        </div>

        {onAddClick && (
          <Button variant="outline" size="sm" onClick={onAddClick}>
            <Plus className="w-4 h-4 mr-1.5" />
            {addLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
