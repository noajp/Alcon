'use client';

import {
  Box, BookOpen, ChartColumn, Check, CodeXml, Compass, Diamond, Flag, FlaskConical, Folder, Globe, Kanban, Layers,
  Mail, Milestone, Presentation, ShieldCheck, Sparkles, Tag, Users, Workflow, Wrench, X, Zap,
} from '@/ui/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { cn } from '@/lib/utils';
import { LABEL_PALETTE } from './labelColor';

// An Object's own mark: the icon and colour its members gave it, or the
// Object glyph when they gave none. The icon is a key of OBJECT_GLYPHS or an
// emoji; the colour is a LABEL_PALETTE key, so it reads the same as a label.

export const OBJECT_GLYPHS = {
  box: Box, folder: Folder, flag: Flag, milestone: Milestone, layers: Layers, kanban: Kanban,
  chart: ChartColumn, workflow: Workflow, zap: Zap, wrench: Wrench, code: CodeXml, flask: FlaskConical,
  compass: Compass, globe: Globe, diamond: Diamond, sparkles: Sparkles, presentation: Presentation,
  book: BookOpen, mail: Mail, shield: ShieldCheck, users: Users, tag: Tag,
} as const;
type GlyphKey = keyof typeof OBJECT_GLYPHS;

const QUICK_EMOJI = ['📦', '🚀', '🎯', '📈', '🛠️', '🧪', '💡', '📣', '🏗️', '🔒', '🌏', '⭐'];

const isGlyphKey = (s: string): s is GlyphKey => s in OBJECT_GLYPHS;

/** A palette key's colour, or undefined for none (or a key not in the palette). */
export function objectColorHex(color: string | null | undefined): string | undefined {
  return LABEL_PALETTE.find((p) => p.key === color)?.hex;
}

export function ObjectMark({ object, size = 16, className }: {
  object: { icon?: string | null; color?: string | null };
  size?: number;
  className?: string;
}) {
  const hex = objectColorHex(object.color);
  const icon = object.icon ?? null;
  if (icon && isGlyphKey(icon)) {
    const Glyph = OBJECT_GLYPHS[icon];
    return <Glyph size={size} strokeWidth={2} className={cn('shrink-0', className)} style={hex ? { color: hex } : undefined} />;
  }
  if (icon) {
    return <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center leading-none', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.85) }}>{icon}</span>;
  }
  return <Box size={size} strokeWidth={2} className={cn('shrink-0', className)} style={hex ? { color: hex } : undefined} />;
}

/** The mark as a button that opens the icon and colour picker. Without
 *  `onChange` (no right to edit) it is the mark alone. */
export function ObjectMarkPicker({ object, size = 18, onChange }: {
  object: { icon?: string | null; color?: string | null };
  size?: number;
  onChange?: (patch: { icon?: string | null; color?: string | null }) => void;
}) {
  const { t } = useI18n();
  if (!onChange) return <ObjectMark object={object} size={size} className="text-muted-foreground" />;
  const current = object.icon ?? null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={t('Change icon and colour')} title={t('Change icon and colour')}
          className="-m-1 inline-flex rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 data-[state=open]:bg-muted/60">
          <ObjectMark object={object} size={size} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 p-3">
        <div>
          <p className="mb-1.5 text-[11px] text-muted-foreground">{t('Colour')}</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-label={t('No colour')} onClick={() => onChange({ color: null })}
              className={cn('flex size-6 items-center justify-center rounded-full border border-border text-muted-foreground', !object.color && 'ring-2 ring-[var(--accent-default)] ring-offset-1 ring-offset-popover')}>
              <X size={12} />
            </button>
            {LABEL_PALETTE.map((p) => (
              <button key={p.key} type="button" aria-label={t(p.label)} title={t(p.label)} onClick={() => onChange({ color: p.key })}
                className={cn('flex size-6 items-center justify-center rounded-full text-white', object.color === p.key && 'ring-2 ring-[var(--accent-default)] ring-offset-1 ring-offset-popover')}
                style={{ backgroundColor: p.hex }}>
                {object.color === p.key && <Check size={12} />}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[11px] text-muted-foreground">{t('Icon')}</p>
          <div className="grid grid-cols-8 gap-1">
            {(Object.keys(OBJECT_GLYPHS) as GlyphKey[]).map((key) => (
              <button key={key} type="button" aria-label={key} onClick={() => onChange({ icon: key === 'box' ? null : key })}
                className={cn('flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  (current ?? 'box') === key && 'bg-muted text-foreground')}>
                <ObjectMark object={{ icon: key, color: object.color }} size={15} />
              </button>
            ))}
            {QUICK_EMOJI.map((e) => (
              <button key={e} type="button" aria-label={e} onClick={() => onChange({ icon: e })}
                className={cn('flex size-7 items-center justify-center rounded-md text-[15px] hover:bg-muted/60', current === e && 'bg-muted')}>
                {e}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
