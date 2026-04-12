'use client';

interface StatCardProps {
  title: string;
  value: number;
  color: 'red' | 'yellow' | 'green' | 'purple';
  subtitle: string;
}

export function StatCard({ title, value, color, subtitle }: StatCardProps) {
  const colorConfig = {
    red: { dot: 'bg-red-400', text: 'text-red-600' },
    yellow: { dot: 'bg-amber-400', text: 'text-amber-600' },
    green: { dot: 'bg-emerald-400', text: 'text-emerald-600' },
    purple: { dot: 'bg-neutral-400', text: 'text-neutral-600' },
  };

  return (
    <div className="bg-card rounded-lg p-5 shadow-[var(--shadow-island)]">
      {/* Large number - hero element */}
      <div className="text-5xl font-bold text-foreground tracking-tight mb-3">
        {value}
      </div>
      {/* Title with status dot */}
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${colorConfig[color].dot}`}></span>
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      {/* Subtitle - muted */}
      <div className="text-xs text-muted-foreground mt-1 ml-4">{subtitle}</div>
    </div>
  );
}
