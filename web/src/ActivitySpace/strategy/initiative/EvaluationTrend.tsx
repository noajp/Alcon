'use client';

import {
  Bar, BarChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { TrendBucket } from './evaluationModel';

// The Evaluation tab's one chart: finishes per bucket, stacked by the
// verifier's word (pass / fail / unchecked), with send-backs as a line
// over them. A dedicated small component on recharts directly, like the
// app widgets (DataViewWidget) — ChatChart is NOT reused: it renders a
// chat message's ChartSpec under a colour-annotation contract persisted
// on Copilot messages, which is a chat surface, not a report widget.
// Colours come from the design tokens (--status-*), never literals.

export function EvaluationTrend({ buckets }: { buckets: TrendBucket[] }) {
  const { t } = useI18n();
  const data = buckets.map((b) => ({
    name: b.key.slice(5),
    pass: b.pass,
    fail: b.fail,
    unchecked: b.unchecked,
    sendBacks: b.sendBacks,
  }));
  if (data.length === 0) return null;
  return (
    <div className="rounded-lg border border-border/60 p-3" data-testid="evaluation-trend">
      <div className="mb-2 text-[12px] font-medium text-foreground">{t('Trend')}</div>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="pass" name={t('Passed')} stackId="finishes" fill="var(--status-success)" />
            <Bar dataKey="fail" name={t('Failed')} stackId="finishes" fill="var(--status-danger)" />
            <Bar dataKey="unchecked" name={t('Unchecked')} stackId="finishes" fill="var(--status-warning)" />
            <Line type="monotone" dataKey="sendBacks" name={t('Send-backs')} stroke="var(--status-info)" strokeWidth={2} dot={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
