// ============================================
// Shared Icon Components
// 2 types: Folder (hierarchy nodes) & Elements (work items)
// ============================================
import Image from 'next/image';

interface IconProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 14,
  md: 18,
  lg: 22,
};

// Object Icon - For all hierarchy nodes (system, object, structure, unit)
export function ObjectIcon({ size = 'md', className = '' }: IconProps) {
  const iconSize = sizeMap[size];
  return (
    <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 ${className}`}>
      <Image src="/object.svg" alt="Object" width={iconSize} height={iconSize} />
    </div>
  );
}

// Elements Icon - For work items (tasks, etc.)
export function ElementsIcon({ size = 'md', className = '' }: IconProps) {
  const iconSize = sizeMap[size];
  return (
    <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 ${className}`}>
      <Image src="/elements.svg" alt="Element" width={iconSize} height={iconSize} />
    </div>
  );
}

// HierarchyIcon - Simple version: folder for nodes, elements for work items
type HierarchyLevel = 'system' | 'object' | 'structure' | 'unit' | 'element';

interface HierarchyIconProps extends IconProps {
  level: HierarchyLevel;
}

export function HierarchyIcon({ level, size = 'md', className = '' }: HierarchyIconProps) {
  if (level === 'element') {
    return <ElementsIcon size={size} className={className} />;
  }
  return <ObjectIcon size={size} className={className} />;
}

// Aliases for backward compatibility
export function SystemIcon(props: IconProps) {
  return <ObjectIcon {...props} />;
}

export function StructureIcon(props: IconProps) {
  return <ObjectIcon {...props} />;
}

export function UnitIcon(props: IconProps) {
  return <ObjectIcon {...props} />;
}

export function ElementIcon(props: IconProps) {
  return <ElementsIcon {...props} />;
}

export function ThreeDotIcon(props: IconProps) {
  return <ObjectIcon {...props} />;
}

export function FileIcon(props: IconProps) {
  return <ObjectIcon {...props} />;
}

export function FolderIcon(props: IconProps) {
  return <ObjectIcon {...props} />;
}

export function FolderIconRound(props: IconProps) {
  return <ObjectIcon {...props} />;
}
