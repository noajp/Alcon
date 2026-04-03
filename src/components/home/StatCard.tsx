'use client';

interface StatCardProps {
  title: string;
  value: number;
  color: 'red' | 'yellow' | 'green' | 'purple';
  subtitle: string;
}

export function StatCard({ title, value, color, subtitle }: StatCardProps) {
  const colorConfig = {
    red: { dot: '#ef4444', bg: 'rgba(239, 68, 68, 0.06)', text: '#dc2626', border: 'rgba(239, 68, 68, 0.12)' },
    yellow: { dot: '#f59e0b', bg: 'rgba(245, 158, 11, 0.06)', text: '#d97706', border: 'rgba(245, 158, 11, 0.12)' },
    green: { dot: '#10b981', bg: 'rgba(16, 185, 129, 0.06)', text: '#059669', border: 'rgba(16, 185, 129, 0.12)' },
    purple: { dot: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.06)', text: '#7c3aed', border: 'rgba(139, 92, 246, 0.12)' },
  };

  const cfg = colorConfig[color];

  return (
    <div
      className="rounded-2xl p-5 transition-all duration-200 hover:shadow-md cursor-default"
      style={{
        backgroundColor: cfg.bg,
        border: `1px solid ${cfg.border}`,
      }}
    >
      {/* Large number */}
      <div
        className="text-4xl font-bold tracking-tight mb-2"
        style={{ color: cfg.text }}
      >
        {value}
      </div>
      {/* Title with dot */}
      <div className="flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: cfg.dot }}
        />
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      {/* Subtitle */}
      <div className="text-xs text-muted-foreground mt-1 ml-4">{subtitle}</div>
    </div>
  );
}
