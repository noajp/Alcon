'use client';

import { useState, useEffect, useMemo } from 'react';
import { Settings, Plus, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ElementWithDetails, AlconObjectWithChildren, ElementEdge } from '@/hooks/useSupabase';
import { getIntersections, upsertIntersection } from '@/hooks/useSupabase';
import type { Json } from '@/types/database';

interface MatrixViewProps {
  // Current object's elements (rows)
  rowElements: ElementWithDetails[];
  // All objects for column source selection
  allObjects: AlconObjectWithChildren[];
  // Current object ID
  currentObjectId: string;
  // Tab content (stores configuration)
  tabContent: Json;
  // Callback to update tab content
  onTabContentUpdate: (content: Json) => void;
  // Refresh callback
  onRefresh?: () => void;
}

interface MatrixConfig {
  columnSourceObjectId?: string;
  cellAttributes?: string[]; // e.g., ['assignee', 'hours', 'status']
}

interface CellData {
  [key: string]: unknown;
}

export function MatrixView({
  rowElements,
  allObjects,
  currentObjectId,
  tabContent,
  onTabContentUpdate,
  onRefresh,
}: MatrixViewProps) {
  const [showConfig, setShowConfig] = useState(false);
  const [intersections, setIntersections] = useState<ElementEdge[]>([]);
  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [cellValue, setCellValue] = useState('');

  // Parse config from tab content
  const config: MatrixConfig = useMemo(() => {
    if (typeof tabContent === 'object' && tabContent !== null && !Array.isArray(tabContent)) {
      return tabContent as MatrixConfig;
    }
    return {};
  }, [tabContent]);

  // Get column source object
  const columnSourceObject = useMemo(() => {
    if (!config.columnSourceObjectId) return null;
    return allObjects.find(obj => obj.id === config.columnSourceObjectId) || null;
  }, [config.columnSourceObjectId, allObjects]);

  // Column elements (from the selected source object)
  const columnElements = useMemo(() => {
    return columnSourceObject?.elements || [];
  }, [columnSourceObject]);

  // Fetch intersections when row/column elements change
  useEffect(() => {
    if (rowElements.length === 0 || columnElements.length === 0) {
      setIntersections([]);
      return;
    }

    const fetchData = async () => {
      try {
        const rowIds = rowElements.map(e => e.id);
        const colIds = columnElements.map(e => e.id);
        const data = await getIntersections(rowIds, colIds);
        setIntersections(data);
      } catch (err) {
        console.error('Failed to fetch intersections:', err);
      }
    };

    fetchData();
  }, [rowElements, columnElements]);

  // Get cell data for a specific intersection
  const getCellData = (rowId: string, colId: string): CellData => {
    const edge = intersections.find(
      e => e.from_element === rowId && e.to_element === colId
    );
    if (edge && typeof edge.attributes === 'object' && edge.attributes !== null) {
      return edge.attributes as CellData;
    }
    return {};
  };

  // Handle column source selection
  const handleSelectColumnSource = (objectId: string) => {
    const newConfig: MatrixConfig = {
      ...config,
      columnSourceObjectId: objectId,
    };
    onTabContentUpdate(newConfig as Json);
    setShowConfig(false);
  };

  // Handle cell click to edit
  const handleCellClick = (rowId: string, colId: string) => {
    const data = getCellData(rowId, colId);
    setCellValue(data.value as string || '');
    setEditingCell({ rowId, colId });
  };

  // Handle cell save
  const handleCellSave = async () => {
    if (!editingCell) return;

    try {
      await upsertIntersection(editingCell.rowId, editingCell.colId, {
        value: cellValue,
        updatedAt: new Date().toISOString(),
      });

      // Refresh intersections
      const rowIds = rowElements.map(e => e.id);
      const colIds = columnElements.map(e => e.id);
      const data = await getIntersections(rowIds, colIds);
      setIntersections(data);

      setEditingCell(null);
      setCellValue('');
    } catch (err) {
      console.error('Failed to save cell:', err);
    }
  };

  // No column source configured - show setup UI
  if (!config.columnSourceObjectId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-background">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Settings size={24} className="text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Configure Matrix View</h3>
          <p className="text-sm text-muted-foreground mb-6">
            Select which Object's Elements should be used as column headers.
            Each intersection cell represents the relationship between a row and column element.
          </p>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Select Column Source</p>
            {allObjects
              .filter(obj => obj.id !== currentObjectId)
              .map(obj => (
                <button
                  key={obj.id}
                  onClick={() => handleSelectColumnSource(obj.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-muted/50 hover:bg-muted rounded-lg transition-colors text-left"
                >
                  <div
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: obj.color || '#6b7280' }}
                  />
                  <span className="font-medium">{obj.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {obj.elements?.length || 0} elements
                  </span>
                </button>
              ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Matrix:</span>
          <span className="text-sm text-muted-foreground">
            Rows = Current Object
          </span>
          <span className="text-muted-foreground">×</span>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="flex items-center gap-1.5 px-2 py-1 text-sm bg-muted rounded hover:bg-accent transition-colors"
          >
            <div
              className="w-2 h-2 rounded-sm"
              style={{ backgroundColor: columnSourceObject?.color || '#6b7280' }}
            />
            {columnSourceObject?.name || 'Select...'}
            <ChevronDown size={14} />
          </button>
        </div>
      </div>

      {/* Config dropdown */}
      {showConfig && (
        <div className="absolute top-12 left-4 z-50 bg-popover border border-border rounded-lg shadow-xl p-2 min-w-[200px]">
          <p className="text-xs text-muted-foreground px-2 py-1">Change Column Source</p>
          {allObjects
            .filter(obj => obj.id !== currentObjectId)
            .map(obj => (
              <button
                key={obj.id}
                onClick={() => handleSelectColumnSource(obj.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors text-left"
              >
                <div
                  className="w-2 h-2 rounded-sm"
                  style={{ backgroundColor: obj.color || '#6b7280' }}
                />
                {obj.name}
              </button>
            ))}
        </div>
      )}

      {/* Matrix Grid */}
      <div className="flex-1 overflow-auto p-4">
        {columnElements.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No elements in the column source object.</p>
            <p className="text-sm mt-1">Add elements to "{columnSourceObject?.name}" first.</p>
          </div>
        ) : (
          <div className="border border-border rounded-md overflow-hidden">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted/50">
                  {/* Top-left corner cell */}
                  <th className="min-w-[200px] px-3 py-2 text-left text-[11px] font-medium text-muted-foreground border-b border-r border-border bg-muted/50">
                    Row / Column
                  </th>
                  {/* Column headers */}
                  {columnElements.map(col => (
                    <th
                      key={col.id}
                      className="min-w-[150px] px-3 py-2 text-left text-[11px] font-medium border-b border-r border-border bg-muted/50"
                    >
                      <div className="flex items-center gap-1.5">
                        <div
                          className="w-2 h-2 rounded-sm flex-shrink-0"
                          style={{ backgroundColor: columnSourceObject?.color || '#6b7280' }}
                        />
                        <span className="truncate">{col.title}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowElements.map((row, rowIndex) => (
                  <tr key={row.id} className="group hover:bg-accent/50">
                    {/* Row header */}
                    <td className="px-3 py-2 text-sm border-b border-r border-border bg-muted/30 group-hover:bg-accent/50">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-4">{rowIndex + 1}</span>
                        <span className="truncate">{row.title}</span>
                      </div>
                    </td>
                    {/* Intersection cells */}
                    {columnElements.map(col => {
                      const cellData = getCellData(row.id, col.id);
                      const isEditing = editingCell?.rowId === row.id && editingCell?.colId === col.id;

                      return (
                        <td
                          key={col.id}
                          className="px-2 py-1.5 border-b border-r border-border cursor-pointer hover:bg-accent transition-colors"
                          onClick={() => !isEditing && handleCellClick(row.id, col.id)}
                        >
                          {isEditing ? (
                            <input
                              type="text"
                              value={cellValue}
                              onChange={(e) => setCellValue(e.target.value)}
                              onBlur={handleCellSave}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCellSave();
                                if (e.key === 'Escape') {
                                  setEditingCell(null);
                                  setCellValue('');
                                }
                              }}
                              className="w-full px-1 py-0.5 text-sm bg-background border border-primary rounded outline-none"
                              autoFocus
                            />
                          ) : (
                            <div className="min-h-[24px] text-sm">
                              {cellData.value as string || (
                                <span className="text-muted-foreground/50 text-xs">-</span>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
