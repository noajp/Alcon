'use client';

// TableView — the "Tables" feature surface. End-user-managed databases
// (Notion DB / Airtable / Supabase Studio style) that live alongside Objects
// and Elements but are entirely independent. This first cut is a static
// preview matching the reference design — schema definition, row CRUD, and
// the Postgres-backed tables ship in follow-ups.

import { useState } from 'react';
import { ChevronLeft, ChevronRight, GripVertical, Plus, Sparkles } from 'lucide-react';
import { NavTableIcon } from '@/shell/sidebar/NavIcons';

// ─── Demo data ─────────────────────────────────────────────────────────────
type Status = 'Accepted' | 'Rejected' | 'Under Review' | 'Processing';
type Row = {
  id: string;
  company: string;
  client: string;
  dealValue: number;
  report: string;
  invoiceDate: string;
  status: Status;
  category: string;
};

const DEMO_ROWS: Row[] = [
  { id: '1',  company: 'BrightPath',   client: 'Olivia Carter',     dealValue: 1300,  report: 'Financial dashboard for investment tracking.',     invoiceDate: '24/10/2025', status: 'Rejected',     category: 'Finance' },
  { id: '2',  company: 'CoreVision',   client: 'Ethan Miller',      dealValue: 2500,  report: 'Designed an AI workflow tool for customer support.', invoiceDate: '26/10/2025', status: 'Accepted',     category: 'AI' },
  { id: '3',  company: 'VentureEdge',  client: 'Amelia Thompson',   dealValue: 3600,  report: 'Created a sleek B2B portfolio website.',           invoiceDate: '31/10/2025', status: 'Under Review', category: 'B2B' },
  { id: '4',  company: 'Skyline Group',client: 'Liam Johnson',      dealValue: 800,   report: 'Developed a SaaS analytics platform for performance', invoiceDate: '03/11/2025', status: 'Processing',   category: 'SaaS' },
  { id: '5',  company: 'NextLink',     client: 'Charlotte Davis',   dealValue: 4200,  report: 'Automated internal operations with a control dashbo', invoiceDate: '07/11/2025', status: 'Accepted',     category: 'Automation' },
  { id: '6',  company: 'HelixOne',     client: 'Noah Anderson',     dealValue: 2300,  report: 'Smart AI platform for marketing personalization.', invoiceDate: '10/11/2025', status: 'Rejected',     category: 'Tech' },
  { id: '7',  company: 'NovaTech',     client: 'Isabella White',    dealValue: 10800, report: 'SaaS client dashboard for enterprise reporting.',  invoiceDate: '11/11/2025', status: 'Under Review', category: 'SaaS' },
  { id: '8',  company: 'AxisLogic',    client: 'James Wilson',      dealValue: 2300,  report: 'B2B CRM to streamline client communication.',      invoiceDate: '12/11/2025', status: 'Accepted',     category: 'B2B' },
  { id: '9',  company: 'FusionWorks',  client: 'Mia Martinez',      dealValue: 7500,  report: 'Automation tool for logistics management.',         invoiceDate: '14/11/2025', status: 'Under Review', category: 'Automation' },
  { id: '10', company: 'DataVerse',    client: 'Benjamin Moore',    dealValue: 15000, report: 'Built a big data analytics dashboard.',             invoiceDate: '15/11/2025', status: 'Processing',   category: 'Tech' },
  { id: '11', company: 'Optima Corp',  client: 'Harper Lewis',      dealValue: 4200,  report: 'Lead management dashboard for sales teams.',        invoiceDate: '16/11/2025', status: 'Rejected',     category: 'B2B' },
  { id: '12', company: 'StratusFlow',  client: 'Lucas Robinson',    dealValue: 2500,  report: 'Engineered a finance forecasting platform.',        invoiceDate: '19/11/2025', status: 'Accepted',     category: 'Finance' },
  { id: '13', company: 'BluePeak',     client: 'Ella Walker',       dealValue: 4200,  report: 'Designed a SaaS UI focused on client retention.',   invoiceDate: '20/11/2025', status: 'Accepted',     category: 'SaaS' },
  { id: '14', company: 'NeuraSys',     client: 'Henry Hall',        dealValue: 1300,  report: 'Built an AI interface for business predictions.',   invoiceDate: '22/11/2025', status: 'Under Review', category: 'AI' },
  { id: '15', company: 'VertexPro',    client: 'Grace Allen',       dealValue: 15000, report: 'Automation dashboard for team operations.',         invoiceDate: '23/11/2025', status: 'Rejected',     category: 'Automation' },
  { id: '16', company: 'OmniReach',    client: 'Jack Turner',       dealValue: 4200,  report: 'Developed a B2B outreach portal for marketing.',    invoiceDate: '24/11/2025', status: 'Processing',   category: 'B2B' },
  { id: '17', company: 'DataFusion',   client: 'Scarlett King',     dealValue: 4590,  report: 'Built a corporate finance reporting tool.',         invoiceDate: '26/11/2025', status: 'Accepted',     category: 'Finance' },
  { id: '18', company: 'Lumeon',       client: 'William Scott',     dealValue: 1300,  report: 'Designed an AI-driven business insights app.',      invoiceDate: '29/11/2025', status: 'Rejected',     category: 'Tech' },
  { id: '19', company: 'IntegraTech',  client: 'Sophie Baker',      dealValue: 2500,  report: 'Created a SaaS integration hub for third-party tools.', invoiceDate: '30/11/2025', status: 'Under Review', category: 'SaaS' },
];

const STATUS_PILL: Record<Status, { dot: string; pill: string; text: string }> = {
  Accepted:       { dot: 'bg-emerald-500', pill: 'bg-emerald-500/12 text-emerald-400 ring-emerald-500/20',  text: 'text-emerald-400' },
  Rejected:       { dot: 'bg-rose-500',    pill: 'bg-rose-500/12 text-rose-400 ring-rose-500/20',          text: 'text-rose-400' },
  'Under Review': { dot: 'bg-sky-500',     pill: 'bg-sky-500/12 text-sky-400 ring-sky-500/20',             text: 'text-sky-400' },
  Processing:    { dot: 'bg-amber-500',   pill: 'bg-amber-500/12 text-amber-400 ring-amber-500/20',       text: 'text-amber-400' },
};

// Small coloured "+" beside the report — pure decoration in the demo design.
function ReportMark() {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-emerald-500/15 text-emerald-400">
      <Plus size={11} strokeWidth={2.5} />
    </span>
  );
}

function CompanyAvatar({ name }: { name: string }) {
  // Stable colour by hashing the company name — keeps the same row's chip the
  // same hue between renders without persisting state.
  const HUES = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#a855f7','#ec4899'];
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  const color = HUES[h % HUES.length];
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  return (
    <span
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {initials}
    </span>
  );
}

const PAGE_SIZE = 20;

export function TableView() {
  const [selected, setSelected] = useState<Set<string>>(new Set(['5', '8', '11', '15']));
  const [page, setPage] = useState(1);

  const total = 300; // demo: shows pagination as "1-20 of 300"
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  const pageCount = Math.ceil(total / PAGE_SIZE);

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* Header — title + actions slot (kept simple; real toolbar lands with
          the schema definition step). */}
      <div className="h-10 flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
          <NavTableIcon size={14} />
          Table
        </span>
        <span className="text-[11px] text-muted-foreground">Deals</span>
        <div className="flex-1" />
        <button
          type="button"
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-md transition-colors"
          title="AI assist (demo)"
        >
          <Sparkles size={12} /> Ask
        </button>
      </div>

      {/* Scrollable table area */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
              <th className="w-8 px-2 py-2.5 text-left font-medium border-b border-border/60" />
              <th className="w-8 px-1 py-2.5 text-left font-medium border-b border-border/60" />
              <th className="px-3 py-2.5 text-left font-medium border-b border-border/60">Company</th>
              <th className="px-3 py-2.5 text-left font-medium border-b border-border/60">Client Name</th>
              <th className="px-3 py-2.5 text-left font-medium border-b border-border/60">Deal Value</th>
              <th className="px-3 py-2.5 text-left font-medium border-b border-border/60">Business Report</th>
              <th className="px-3 py-2.5 text-left font-medium border-b border-border/60">Invoice Date</th>
              <th className="px-3 py-2.5 text-left font-medium border-b border-border/60">Status</th>
              <th className="px-3 py-2.5 text-left font-medium border-b border-border/60">Category</th>
            </tr>
          </thead>
          <tbody>
            {DEMO_ROWS.map((row) => {
              const isSel = selected.has(row.id);
              const pill = STATUS_PILL[row.status];
              return (
                <tr
                  key={row.id}
                  className={`group transition-colors ${isSel ? 'bg-foreground/[0.03]' : 'hover:bg-foreground/[0.02]'}`}
                >
                  {/* Drag handle gutter */}
                  <td className="w-8 px-2 py-2.5 align-middle border-b border-border/40">
                    <span className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground/30 group-hover:text-muted-foreground/70 transition-colors">
                      <GripVertical size={12} />
                    </span>
                  </td>
                  {/* Checkbox */}
                  <td className="w-8 px-1 py-2.5 align-middle border-b border-border/40">
                    <button
                      type="button"
                      onClick={() => toggleRow(row.id)}
                      aria-label={isSel ? 'Deselect row' : 'Select row'}
                      className={`mx-auto flex h-4 w-4 items-center justify-center rounded-[3px] border transition-colors ${
                        isSel
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-muted-foreground/40 bg-transparent hover:border-foreground/60'
                      }`}
                    >
                      {isSel && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  </td>
                  {/* Company — name only */}
                  <td className="px-3 py-2.5 align-middle border-b border-border/40">
                    <span className="text-foreground/90 font-medium">{row.company}</span>
                  </td>
                  {/* Client — avatar + name */}
                  <td className="px-3 py-2.5 align-middle border-b border-border/40">
                    <span className="inline-flex items-center gap-2">
                      <CompanyAvatar name={row.client} />
                      <span className="text-foreground/85">{row.client}</span>
                    </span>
                  </td>
                  {/* Deal Value */}
                  <td className="px-3 py-2.5 align-middle border-b border-border/40">
                    <span className="text-foreground/90 tabular-nums">{`$${row.dealValue.toLocaleString()}`}</span>
                  </td>
                  {/* Business Report */}
                  <td className="px-3 py-2.5 align-middle border-b border-border/40">
                    <span className="inline-flex items-center gap-2 max-w-[42ch]">
                      <ReportMark />
                      <span className="truncate text-foreground/80">{row.report}</span>
                    </span>
                  </td>
                  {/* Invoice Date */}
                  <td className="px-3 py-2.5 align-middle border-b border-border/40">
                    <span className={`tabular-nums ${row.status === 'Rejected' ? 'text-rose-400' : 'text-foreground/80'}`}>
                      {row.invoiceDate}
                    </span>
                  </td>
                  {/* Status pill */}
                  <td className="px-3 py-2.5 align-middle border-b border-border/40">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ring-1 ${pill.pill}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
                      <span className="text-[11px] font-medium">{row.status}</span>
                    </span>
                  </td>
                  {/* Category */}
                  <td className="px-3 py-2.5 align-middle border-b border-border/40">
                    <span className="text-foreground/80">{row.category}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer pagination — Static demo controls. */}
      <div className="flex items-center justify-between gap-4 border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground bg-card">
        <span className="tabular-nums">{`${start}-${end} of ${total}`}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            aria-label="Previous page"
          >
            <ChevronLeft size={14} />
          </button>
          {Array.from({ length: Math.min(10, pageCount) }).map((_, i) => {
            const n = i + 1;
            const isActive = page === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => setPage(n)}
                className={`h-6 min-w-[1.5rem] px-1.5 rounded-md tabular-nums transition-colors ${
                  isActive
                    ? 'bg-foreground/10 text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                }`}
              >
                {n}
              </button>
            );
          })}
          <button
            type="button"
            disabled={page === pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            aria-label="Next page"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <span className="tabular-nums">{`Row/Page: ${PAGE_SIZE}`}</span>
      </div>
    </div>
  );
}
