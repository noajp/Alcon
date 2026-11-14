'use client';

import type React from 'react';
import { useRef } from 'react';
import { ChevronDown } from '@/ui/icons';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  MenuCheck,
} from '@/ui/dropdown-menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { CONTROL_WELL, CONTROL_WELL_HOVER, FONT, SETTINGS_ISLAND } from '@/shared/designTokens';

// The row primitives of a settings panel — the single home every settings
// surface builds from (settings redesign §4.1): a property island with its
// heading above it, the row anatomy (title + one-line explanation + an
// optional state caption, control on the right), the stacked field, the one
// shared Switch, and the segmented control for short enums. Panels keep
// their own backing stores; only the presentation lives here.

/** A group of setting rows floating as one island, heading above the card.
 *  `level` is the heading's rank: 2 under the page's name, 3 where the page
 *  is divided into named parts and the island sits inside one. */
export function SettingsIsland({
  title, description, children, level = 2,
}: { title?: string; description?: string; children: React.ReactNode; level?: 2 | 3 }) {
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <section aria-label={title || undefined}>
      {(title || description) && (
        <div className="mb-2">
          {title && <Heading className={`${FONT.lg} text-foreground`}>{title}</Heading>}
          {description && (
            <p className="text-[12px] text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      )}
      <div className={`${SETTINGS_ISLAND} divide-y divide-[var(--border-subtle)]`}>
        {children}
      </div>
    </section>
  );
}

/** The settings row: title + one-line explanation (+ optional caption for
 *  state, not explanation), control on the right. Rows carry the island's
 *  horizontal padding so hairlines run full-bleed; `flush` drops it for a
 *  row embedded in another padded container (a dialog). */
export function SettingRow({
  label, desc, caption, children, flush = false,
}: {
  label: string; desc?: string; caption?: string; children: React.ReactNode; flush?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-6 py-3.5 ${flush ? '' : 'px-5'}`}>
      <div className="min-w-0 max-w-xl">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        {desc && <div className="text-[12px] text-muted-foreground mt-0.5">{desc}</div>}
        {caption && <div className="text-[11px] text-muted-foreground/80 mt-1">{caption}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** The stacked variant: label above, full-width control — for textareas
 *  and long inputs inside an island. `flush` drops the island padding for a
 *  field embedded in another padded container (a dialog), mirroring
 *  SettingRow's flush; `htmlFor` binds the label to a control by id. */
export function SettingField({
  label, hint, children, flush = false, htmlFor,
}: { label: string; hint?: string; children: React.ReactNode; flush?: boolean; htmlFor?: string }) {
  return (
    <div className={flush ? '' : 'px-5 py-3.5'}>
      <label htmlFor={htmlFor} className="block text-[12px] font-medium text-foreground mb-1.5">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-muted-foreground mt-1.5">{hint}</div>}
    </div>
  );
}

/** The one switch. Every boolean setting renders this — there is no
 *  second implementation to drift from it. It is drawn small; `roomy`
 *  lets it take a press in the 44px around it (the ::before), for a row
 *  that keeps that much room clear of other controls. */
export function Switch({
  value, onChange, disabled = false, label, roomy = false,
}: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; roomy?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-[18px] w-8 items-center rounded-full transition-colors disabled:opacity-50 disabled:pointer-events-none ${
        roomy ? "before:absolute before:-inset-x-1.5 before:-inset-y-[13px] before:content-['']" : ''
      } ${
        value ? 'bg-primary' : 'bg-muted-foreground/30'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          value ? 'translate-x-[15px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

/** A segmented control for an enum with 2–4 short options, where seeing
 *  every choice at once is the clarity win (the dropdown stays for longer
 *  lists). The options sit in one well and the chosen one is a pill raised
 *  off it, so the group reads as a single control, not a row of words.
 *  Radio-group semantics: arrow keys move the selection. */
export function SegmentedControl({
  label, value, options, onChange, disabled = false,
}: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, dir: 1 | -1) => {
    const next = (from + dir + options.length) % options.length;
    onChange(options[next]);
    optionRefs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex items-center gap-0.5 rounded-lg ${CONTROL_WELL} p-0.5 ${disabled ? 'opacity-50' : ''}`}
    >
      {options.map((opt, i) => {
        const selected = opt === value;
        const tabbable = selected || (!options.includes(value) && i === 0);
        return (
          <button
            key={opt}
            ref={(el) => { optionRefs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => onChange(opt)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
              else if (e.key === 'Home') { e.preventDefault(); onChange(options[0]); optionRefs.current[0]?.focus(); }
              else if (e.key === 'End') { e.preventDefault(); onChange(options[options.length - 1]); optionRefs.current[options.length - 1]?.focus(); }
            }}
            className={`h-6 px-2.5 rounded-md text-[12px] font-medium transition-colors ${
              selected
                ? 'bg-card dark:bg-foreground/[0.12] shadow-[var(--shadow-island)] text-foreground'
                : 'text-foreground/70 hover:text-foreground'
            }`}
          >
            {t(opt)}
          </button>
        );
      })}
    </div>
  );
}

export function SegmentedRow({
  label, desc, caption, value, options, onChange, disabled = false,
}: {
  label: string; desc?: string; caption?: string; value: string; options: string[];
  onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <SettingRow label={label} desc={desc} caption={caption}>
      <SegmentedControl label={label} value={value} options={options} onChange={onChange} disabled={disabled} />
    </SettingRow>
  );
}

export function SelectRow({
  label, desc, caption, value, options, onChange, disabled = false,
}: {
  label: string; desc?: string; caption?: string; value: string; options: string[];
  onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <SettingRow label={label} desc={desc} caption={caption}>
      <SelectControl value={value} options={options} onChange={onChange} disabled={disabled} />
    </SettingRow>
  );
}

/** The select of a settings row on its own, for rows laid out by SettingsRow. */
export function SelectControl({
  value, options, onChange, disabled = false,
}: { value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium ${CONTROL_WELL} ${CONTROL_WELL_HOVER} text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none`}
        >
          {t(value)}
          <ChevronDown size={12} className="opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {options.map((opt) => (
          <DropdownMenuItem key={opt} onSelect={() => onChange(opt)} className="gap-2 text-[12px]">
            <span className="flex-1">{t(opt)}</span>
            {value === opt && <MenuCheck />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ToggleRow({
  label, desc, caption, value, onChange, disabled = false, flush = false,
}: {
  label: string; desc?: string; caption?: string; value: boolean;
  onChange: (v: boolean) => void; disabled?: boolean; flush?: boolean;
}) {
  return (
    <SettingRow label={label} desc={desc} caption={caption} flush={flush}>
      <Switch label={label} value={value} onChange={onChange} disabled={disabled} roomy />
    </SettingRow>
  );
}
