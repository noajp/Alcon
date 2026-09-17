'use client';

import type React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/ui/dropdown-menu';
import { useI18n } from '@/Function/i18n/I18nProvider';

// The row primitives of a settings panel — a titled group, a label + control
// row, a select row, a switch row. Shared by Preferences and the Strategy
// panels so every settings surface reads the same.

export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[14px] font-semibold text-foreground mb-3">{title}</h2>
      <div className="rounded-lg border border-border/60 bg-[var(--surface-rail)]/40 px-4 divide-y divide-border/50">
        {children}
      </div>
    </div>
  );
}

export function Row({
  label, desc, children,
}: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        {desc && <div className="text-[12px] text-muted-foreground mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SelectRow({
  label, desc, value, options, onChange,
}: {
  label: string; desc?: string; value: string; options: string[];
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Row label={label} desc={desc}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium border border-border/60 bg-muted/40 text-foreground hover:bg-muted/70 transition-colors"
          >
            {t(value)}
            <ChevronDown size={12} className="opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]">
          {options.map((opt) => (
            <DropdownMenuItem key={opt} onSelect={() => onChange(opt)} className="gap-2 text-[12px]">
              <span className="flex-1">{t(opt)}</span>
              {value === opt && <Check size={12} />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Row>
  );
}

export function ToggleRow({
  label, desc, value, onChange,
}: { label: string; desc?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={label} desc={desc}>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-[18px] w-8 items-center rounded-full transition-colors ${
          value ? 'bg-primary' : 'bg-muted-foreground/30'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            value ? 'translate-x-[15px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
    </Row>
  );
}

