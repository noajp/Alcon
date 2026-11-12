'use client';

import { useI18n } from '@/Function/i18n/I18nProvider';
import { SegmentedRow, SelectRow, SettingsIsland, ToggleRow } from './SettingsControls';
import { TIMELINE_MONTHS_AHEAD_RANGE, TIMELINE_MONTHS_BACK_RANGE } from './preferencesStore';
import { useUserPreferences } from './useUserPreferences';

// Settings › Strategy › Timeline: how the Strategy Timeline is drawn for
// this person — the span one screen shows, the window around this month,
// and the marks on it. Saved to `user_preferences`; TimelineView reads the
// cached copy.

const SCALE_LABEL = { month: 'Month', quarter: 'Quarter' } as const;
const BACK_CHOICES = [0, 1, 2, 3, 6, 12];
const AHEAD_CHOICES = [3, 6, 10, 12, 18, 24, 36];

/** The choices for a month count, with the saved value kept among them. */
function monthChoices(choices: number[], current: number, range: { min: number; max: number }): string[] {
  const all = choices.includes(current) ? choices : [...choices, current].sort((a, b) => a - b);
  return all.filter((n) => n >= range.min && n <= range.max).map(String);
}

export function TimelineSettings() {
  const { t } = useI18n();
  const { preferences, error, savePreference } = useUserPreferences();

  return (
    <div className="space-y-10">
      {error && <div className="px-1 text-[12px] text-destructive">{t("Couldn't save: {error}", { error })}</div>}

      <SettingsIsland title={t('Window')}>
        <SegmentedRow
          label={t('Scale')}
          desc={t('How much of the year one screen shows')}
          value={SCALE_LABEL[preferences.timeline_scale]}
          options={[SCALE_LABEL.month, SCALE_LABEL.quarter]}
          onChange={(label) => savePreference('timeline_scale', label === SCALE_LABEL.month ? 'month' : 'quarter')}
        />
        <SelectRow
          label={t('Months back')}
          desc={t('How far before this month the window starts')}
          value={String(preferences.timeline_months_back)}
          options={monthChoices(BACK_CHOICES, preferences.timeline_months_back, TIMELINE_MONTHS_BACK_RANGE)}
          onChange={(v) => savePreference('timeline_months_back', Number(v))}
        />
        <SelectRow
          label={t('Months ahead')}
          desc={t('How far after this month the window runs')}
          value={String(preferences.timeline_months_ahead)}
          options={monthChoices(AHEAD_CHOICES, preferences.timeline_months_ahead, TIMELINE_MONTHS_AHEAD_RANGE)}
          onChange={(v) => savePreference('timeline_months_ahead', Number(v))}
        />
      </SettingsIsland>

      <SettingsIsland title={t('Marks')}>
        <ToggleRow
          label={t('Today marker')}
          desc={t('A line through today across every row')}
          value={preferences.timeline_today_marker}
          onChange={(v) => savePreference('timeline_today_marker', v)}
        />
        <ToggleRow
          label={t('Progress fill')}
          desc={t('Shade each band by how much of its work is done')}
          value={preferences.timeline_progress_fill}
          onChange={(v) => savePreference('timeline_progress_fill', v)}
        />
      </SettingsIsland>
    </div>
  );
}
