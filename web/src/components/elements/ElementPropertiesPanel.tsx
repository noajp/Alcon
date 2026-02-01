'use client';

import { useState } from 'react';
import { X, ChevronDown, Plus, Calendar, User, Users, Flag, Tag, Target } from 'lucide-react';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { updateElement } from '@/hooks/useSupabase';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Circle, Clock, CheckCircle2, XCircle, Ban, Send } from 'lucide-react';

interface ElementPropertiesPanelProps {
  element: ElementWithDetails;
  onClose: () => void;
  onRefresh?: () => void;
}

const statusOptions = [
  { status: 'backlog', label: 'Backlog', icon: Circle, color: 'text-muted-foreground' },
  { status: 'todo', label: 'Todo', icon: Circle, color: 'text-muted-foreground' },
  { status: 'in_progress', label: 'In Progress', icon: Clock, color: 'text-yellow-500' },
  { status: 'review', label: 'In Review', icon: Send, color: 'text-cyan-400' },
  { status: 'done', label: 'Done', icon: CheckCircle2, color: 'text-green-500' },
  { status: 'blocked', label: 'Blocked', icon: XCircle, color: 'text-red-500' },
  { status: 'cancelled', label: 'Cancelled', icon: Ban, color: 'text-muted-foreground' },
];

const priorityOptions = [
  { priority: 'urgent', label: 'Urgent', color: 'text-red-500', bars: 4 },
  { priority: 'high', label: 'High', color: 'text-orange-500', bars: 3 },
  { priority: 'medium', label: 'Medium', color: 'text-yellow-500', bars: 2 },
  { priority: 'low', label: 'Low', color: 'text-muted-foreground', bars: 1 },
];

function PriorityBars({ bars, color }: { bars: number; color: string }) {
  return (
    <div className="flex items-end gap-0.5 h-3">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`w-1 rounded-sm ${i <= bars ? color.replace('text-', 'bg-') : 'bg-muted'}`}
          style={{ height: `${i * 3}px` }}
        />
      ))}
    </div>
  );
}

function PropertyRow({
  label,
  icon: Icon,
  children
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center py-2 hover:bg-muted/30 rounded px-2 -mx-2 transition-colors">
      <div className="flex items-center gap-2 w-28 flex-shrink-0">
        <Icon className="text-muted-foreground" size={14} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
}

export function ElementPropertiesPanel({ element, onClose, onRefresh }: ElementPropertiesPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const currentStatus = statusOptions.find(s => s.status === element.status) || statusOptions[1];
  const currentPriority = priorityOptions.find(p => p.priority === element.priority) || priorityOptions[2];

  const handleStatusChange = async (newStatus: string) => {
    try {
      await updateElement(element.id, { status: newStatus as any });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update status:', e);
    }
  };

  const handlePriorityChange = async (newPriority: string) => {
    try {
      await updateElement(element.id, { priority: newPriority as any });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update priority:', e);
    }
  };

  const handleDateChange = async (field: 'start_date' | 'due_date', value: string) => {
    try {
      await updateElement(element.id, { [field]: value || null });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update date:', e);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="w-72 border-l border-border bg-background flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-muted-foreground transition-colors"
        >
          Properties
          <ChevronDown className={`size-4 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
        </button>
        <div className="flex items-center gap-1">
          <button
            className="p-1 hover:bg-muted rounded transition-colors"
            title="Add property"
          >
            <Plus className="size-4 text-muted-foreground" />
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded transition-colors"
          >
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Properties Content */}
      {!isCollapsed && (
        <div className="flex-1 overflow-auto px-4 py-3">
          {/* Status */}
          <PropertyRow label="Status" icon={Circle}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 text-sm hover:bg-muted px-2 py-1 rounded transition-colors w-full">
                  <currentStatus.icon className={`size-4 ${currentStatus.color}`} />
                  <span>{currentStatus.label}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {statusOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.status}
                    onClick={() => handleStatusChange(option.status)}
                    className="flex items-center gap-2"
                  >
                    <option.icon className={`size-4 ${option.color}`} />
                    <span>{option.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </PropertyRow>

          {/* Priority */}
          <PropertyRow label="Priority" icon={Flag}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 text-sm hover:bg-muted px-2 py-1 rounded transition-colors w-full">
                  <PriorityBars bars={currentPriority.bars} color={currentPriority.color} />
                  <span>{currentPriority.label}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {priorityOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.priority}
                    onClick={() => handlePriorityChange(option.priority)}
                    className="flex items-center gap-2"
                  >
                    <PriorityBars bars={option.bars} color={option.color} />
                    <span>{option.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </PropertyRow>

          {/* Lead / Assignee */}
          <PropertyRow label="Lead" icon={User}>
            <button className="flex items-center gap-2 text-sm text-muted-foreground hover:bg-muted px-2 py-1 rounded transition-colors w-full">
              <Users className="size-4" />
              <span>Add lead</span>
            </button>
          </PropertyRow>

          {/* Members */}
          <PropertyRow label="Members" icon={Users}>
            <button className="flex items-center gap-2 text-sm text-muted-foreground hover:bg-muted px-2 py-1 rounded transition-colors w-full">
              <Plus className="size-4" />
              <span>Add members</span>
            </button>
          </PropertyRow>

          {/* Start date */}
          <PropertyRow label="Start date" icon={Calendar}>
            <input
              type="date"
              value={element.start_date?.split('T')[0] || ''}
              onChange={(e) => handleDateChange('start_date', e.target.value)}
              className="text-sm bg-transparent hover:bg-muted px-2 py-1 rounded transition-colors w-full cursor-pointer"
              placeholder="Add date"
            />
          </PropertyRow>

          {/* Target date / Due date */}
          <PropertyRow label="Target date" icon={Target}>
            <input
              type="date"
              value={element.due_date?.split('T')[0] || ''}
              onChange={(e) => handleDateChange('due_date', e.target.value)}
              className="text-sm bg-transparent hover:bg-muted px-2 py-1 rounded transition-colors w-full cursor-pointer"
              placeholder="Add date"
            />
          </PropertyRow>

          {/* Labels */}
          <PropertyRow label="Labels" icon={Tag}>
            <button className="flex items-center gap-2 text-sm text-muted-foreground hover:bg-muted px-2 py-1 rounded transition-colors w-full">
              <Plus className="size-4" />
              <span>Add label</span>
            </button>
          </PropertyRow>

          {/* Divider */}
          <div className="border-t border-border my-4" />

          {/* Progress Section (placeholder) */}
          <div className="mb-4">
            <button
              className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-muted-foreground transition-colors mb-3"
            >
              Progress
              <ChevronDown className="size-4" />
            </button>

            {/* Progress stats */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-xs text-muted-foreground">Scope</div>
                <div className="text-sm font-medium">
                  {element.subelements?.length || 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Started</div>
                <div className="text-sm font-medium text-yellow-500">
                  {element.status === 'in_progress' ? 1 : 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Completed</div>
                <div className="text-sm font-medium text-green-500">
                  {element.subelements?.filter(s => s.is_completed).length || 0}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
