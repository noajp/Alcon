'use client';

// TableView — the "Tables" feature surface. End-user-managed databases
// (Notion DB / Airtable / Supabase Studio style) that live alongside Objects
// and Elements but are entirely independent. This first cut is a plain
// monochrome preview — pure text cells, no chips/avatars/icons — so the DB
// nature is obvious. Schema editor + Postgres-backed rows land in follow-ups.

import { useState } from 'react';

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

const PAGE_SIZE = 20;
const TOTAL = 300;

export function TableView() {
  const [page, setPage] = useState(1);
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, TOTAL);
  const pageCount = Math.ceil(TOTAL / PAGE_SIZE);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* Header — plain title, no icon / no chrome. */}
      <div className="h-10 flex items-center px-4 border-b border-border/60 bg-card flex-shrink-0">
        <span className="text-[12px] font-semibold text-foreground">Deals</span>
      </div>

      {/* Scrollable table area — every cell gets a 1px border on all sides so
          the surface reads as a true DB grid (Supabase Studio / psql look). */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
              <th className="px-3 py-2 text-left font-medium border border-border/60 bg-card">Company</th>
              <th className="px-3 py-2 text-left font-medium border border-border/60 bg-card">Client Name</th>
              <th className="px-3 py-2 text-left font-medium border border-border/60 bg-card">Deal Value</th>
              <th className="px-3 py-2 text-left font-medium border border-border/60 bg-card">Business Report</th>
              <th className="px-3 py-2 text-left font-medium border border-border/60 bg-card">Invoice Date</th>
              <th className="px-3 py-2 text-left font-medium border border-border/60 bg-card">Status</th>
              <th className="px-3 py-2 text-left font-medium border border-border/60 bg-card">Category</th>
            </tr>
          </thead>
          <tbody>
            {DEMO_ROWS.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 align-middle border border-border/40 text-foreground/90">{row.company}</td>
                <td className="px-3 py-2 align-middle border border-border/40 text-foreground/85">{row.client}</td>
                <td className="px-3 py-2 align-middle border border-border/40 text-foreground/90 tabular-nums">{`$${row.dealValue.toLocaleString()}`}</td>
                <td className="px-3 py-2 align-middle border border-border/40 text-foreground/80 max-w-[42ch] truncate">{row.report}</td>
                <td className="px-3 py-2 align-middle border border-border/40 text-foreground/80 tabular-nums">{row.invoiceDate}</td>
                <td className="px-3 py-2 align-middle border border-border/40 text-foreground/80">{row.status}</td>
                <td className="px-3 py-2 align-middle border border-border/40 text-foreground/80">{row.category}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer pagination — text-only controls. */}
      <div className="flex items-center justify-between gap-4 border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground bg-card">
        <span className="tabular-nums">{`${start}-${end} of ${TOTAL}`}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="h-6 px-2 rounded-md tabular-nums text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
          >
            Prev
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
            className="h-6 px-2 rounded-md tabular-nums text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
          >
            Next
          </button>
        </div>
        <span className="tabular-nums">{`Row/Page: ${PAGE_SIZE}`}</span>
      </div>
    </div>
  );
}
