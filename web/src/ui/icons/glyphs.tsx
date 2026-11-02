'use client';

import type { ReactNode } from 'react';
import { gearPath, glyph, hole } from './glyph';

// The drawings. Each is exported under the Lucide name it replaces, so
// `@/ui/icons` serves it wherever that name was used. Things are solid with
// knockouts; actions are lines. See glyph.tsx.

// ── Places and concepts ───────────────────────────────────────

const TABLE = {
  solid: <rect x="3" y="2.75" width="10" height="10.5" rx="1.9" />,
  cut: <path d="M2 6.5h12M6.75 1.5v13" />,
};
export const Grid2x2 = glyph('Grid2x2', TABLE);
export const Table2 = glyph('Table2', TABLE);

export const House = glyph('House', {
  solid: <path d="M7.3 2.45a1.1 1.1 0 0 1 1.4 0l4.1 3.45c.25.21.4.52.4.85v5.75a1.25 1.25 0 0 1-1.25 1.25H9.6V10.6a.8.8 0 0 0-.8-.8H7.2a.8.8 0 0 0-.8.8v3.15H4.05A1.25 1.25 0 0 1 2.8 12.5V6.75c0-.33.15-.64.4-.85Z" />,
});

export const GalleryHorizontal = glyph('GalleryHorizontal', {
  solid: <rect x="4.75" y="3" width="6.5" height="10" rx="1.6" />,
  line: <path d="M2.25 4.75v6.5M13.75 4.75v6.5" />,
});

export const Settings = glyph('Settings', {
  solid: <path fillRule="evenodd" d={`${gearPath(8, 8, 6.1, 4.55, 8)}M8 5.9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2Z`} />,
});

const SLIDERS = {
  line: <path d="M2.5 5h3.5M10.75 5h2.75M2.5 11h1.75M9 11h4.5" />,
  solid: <><circle cx="8.4" cy="5" r="2" /><circle cx="6.6" cy="11" r="2" /></>,
};
export const Settings2 = glyph('Settings2', SLIDERS);
export const SlidersHorizontal = glyph('SlidersHorizontal', SLIDERS);

export const Bell = glyph('Bell', {
  solid: <>
    <path d="M8 1.9a.9.9 0 0 1 .9.9v.4c1.85.42 3.15 2.05 3.15 3.95v2.4l.95 1.5a.6.6 0 0 1-.5.92H3.5a.6.6 0 0 1-.5-.92l.95-1.5v-2.4c0-1.9 1.3-3.53 3.15-3.95v-.4a.9.9 0 0 1 .9-.9Z" />
    <path d="M6.55 12.95h2.9a1.45 1.45 0 0 1-2.9 0Z" />
  </>,
});

const CALENDAR = {
  solid: <rect x="2.75" y="3.25" width="10.5" height="10" rx="1.9" />,
  cut: <><path d="M2 6.75h12" /><circle cx="5.5" cy="3.35" r="1.35" style={hole} /><circle cx="10.5" cy="3.35" r="1.35" style={hole} /></>,
  line: <path d="M5.5 1.9v2.6M10.5 1.9v2.6" />,
};
export const Calendar = glyph('Calendar', CALENDAR);
export const CalendarIcon = glyph('CalendarIcon', CALENDAR);
export const CalendarDays = glyph('CalendarDays', CALENDAR);

export const BookOpen = glyph('BookOpen', {
  solid: <>
    <path d="M2.4 3.75c0-.36.25-.67.6-.74 1.6-.35 3.1-.08 4.4.8v9.1c-1.25-.82-2.7-1.05-4.3-.7a.6.6 0 0 1-.7-.59Z" />
    <path d="M13.6 3.75c0-.36-.25-.67-.6-.74-1.6-.35-3.1-.08-4.4.8v9.1c1.25-.82 2.7-1.05 4.3-.7a.6.6 0 0 0 .7-.59Z" />
  </>,
});

const BARS = {
  solid: <>
    <rect x="3.4" y="9" width="2.2" height="4.25" rx="1.1" />
    <rect x="6.9" y="5.75" width="2.2" height="7.5" rx="1.1" />
    <rect x="10.4" y="2.75" width="2.2" height="10.5" rx="1.1" />
  </>,
};
export const ChartNoAxesColumn = glyph('ChartNoAxesColumn', BARS);
export const BarChart3 = glyph('BarChart3', BARS);
export const ChartColumn = glyph('ChartColumn', BARS);

const GANTT = {
  solid: <>
    <rect x="4" y="3" width="6" height="2.2" rx="1.1" />
    <rect x="6.5" y="6.9" width="6.25" height="2.2" rx="1.1" />
    <rect x="5" y="10.8" width="5.5" height="2.2" rx="1.1" />
  </>,
  line: <path d="M2.25 2.25v11.5" />,
};
export const ChartGantt = glyph('ChartGantt', GANTT);
export const GanttChart = glyph('GanttChart', GANTT);

export const Grip = glyph('Grip', {
  solid: <>
    {[4.5, 8, 11.5].flatMap((y) => [4.5, 8, 11.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.05" />))}
  </>,
});

export const Milestone = glyph('Milestone', {
  solid: <path d="M3 4.25a.75.75 0 0 1 .75-.75h7.05c.2 0 .4.08.54.23l2.05 2.1a.75.75 0 0 1 0 1.04l-2.05 2.1a.75.75 0 0 1-.54.23H3.75A.75.75 0 0 1 3 8.45Z" />,
  line: <path d="M6.5 9.75v4.25M6.5 1.75v1.5" />,
});

export const Layers = glyph('Layers', {
  solid: <path d="M8 2.1 12.6 4.65 8 7.2 3.4 4.65Z" />,
  line: <path d="M3.5 8.1 8 10.6 12.5 8.1M3.5 11.35 8 13.85 12.5 11.35" />,
});

export const Box = glyph('Box', {
  solid: <path d="M7.6 1.95a.8.8 0 0 1 .8 0l4.3 2.4c.25.14.4.4.4.7v5.9c0 .29-.15.56-.4.7l-4.3 2.4a.8.8 0 0 1-.8 0l-4.3-2.4a.8.8 0 0 1-.4-.7v-5.9c0-.3.15-.56.4-.7Z" />,
  cut: <path d="M2.8 4.7 8 7.6l5.2-2.9M8 7.6v6.8" />,
});

export const Component = glyph('Component', {
  solid: <>
    <path d="M7.5 1.9a.7.7 0 0 1 1 0l1.6 1.6a.7.7 0 0 1 0 1L8.5 6.1a.7.7 0 0 1-1 0L5.9 4.5a.7.7 0 0 1 0-1Z" />
    <path d="M11.5 5.9a.7.7 0 0 1 1 0l1.6 1.6a.7.7 0 0 1 0 1l-1.6 1.6a.7.7 0 0 1-1 0L9.9 8.5a.7.7 0 0 1 0-1Z" />
    <path d="M7.5 9.9a.7.7 0 0 1 1 0l1.6 1.6a.7.7 0 0 1 0 1l-1.6 1.6a.7.7 0 0 1-1 0l-1.6-1.6a.7.7 0 0 1 0-1Z" />
    <path d="M3.5 5.9a.7.7 0 0 1 1 0l1.6 1.6a.7.7 0 0 1 0 1L4.5 10.1a.7.7 0 0 1-1 0L1.9 8.5a.7.7 0 0 1 0-1Z" />
  </>,
});

export const MessageCircle = glyph('MessageCircle', {
  solid: <path d="M8 2.5c3.05 0 5.5 2.2 5.5 4.95S11.05 12.4 8 12.4c-.7 0-1.4-.1-2.03-.32l-2.6.95a.5.5 0 0 1-.64-.62l.7-2.1A4.7 4.7 0 0 1 2.5 7.45C2.5 4.7 4.95 2.5 8 2.5Z" />,
});

export const HeartHandshake = glyph('HeartHandshake', {
  solid: <><circle cx="10.1" cy="8" r="3.15" /><circle cx="6.1" cy="8" r="3.15" /></>,
  cut: <circle cx="10.1" cy="8" r="3.55" strokeWidth={0.8} />,
});

const PAGE = {
  solid: <path d="M5.5 2h3.86c.4 0 .78.16 1.06.44l2.08 2.08c.28.28.44.66.44 1.06v6.92a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 12.5v-9A1.5 1.5 0 0 1 5.5 2Z" />,
  cut: <><path d="M9.5 1.5v3a.5.5 0 0 0 .5.5h3" strokeWidth={1.1} /><path d="M6.25 8.4h3.5M6.25 10.9h2.25" /></>,
};
export const FileText = glyph('FileText', PAGE);
export const File = glyph('File', { solid: PAGE.solid, cut: <path d="M9.5 1.5v3a.5.5 0 0 0 .5.5h3" strokeWidth={1.1} /> });
export const Files = glyph('Files', {
  solid: <path d="M6.75 1.75h3.1c.33 0 .65.13.88.37l1.9 1.9c.24.23.37.55.37.88v6.35a1.5 1.5 0 0 1-1.5 1.5h-4.75a1.5 1.5 0 0 1-1.5-1.5v-8a1.5 1.5 0 0 1 1.5-1.5Z" />,
  cut: <path d="M9.75 1.25v2.5a.5.5 0 0 0 .5.5h2.5" strokeWidth={1.1} />,
  line: <path d="M3 5.5v6.75a2 2 0 0 0 2 2h4.5" />,
});

const SHIELD = {
  solid: <path d="M7.75 2.05a.7.7 0 0 1 .5 0l3.85 1.45a.7.7 0 0 1 .45.65v3.2c0 2.85-1.9 5.05-4.3 6.08a.7.7 0 0 1-.5 0C5.35 12.4 3.45 10.2 3.45 7.35v-3.2a.7.7 0 0 1 .45-.65Z" />,
  cut: <path d="m6 7.95 1.4 1.4 2.6-2.7" strokeWidth={1.3} />,
};
export const ShieldCheck = glyph('ShieldCheck', SHIELD);

const PERSON = {
  solid: <>
    <circle cx="8" cy="5" r="2.4" />
    <path d="M3.75 13.05c.32-2.3 2.05-3.7 4.25-3.7s3.93 1.4 4.25 3.7a.7.7 0 0 1-.7.8h-7.1a.7.7 0 0 1-.7-.8Z" />
  </>,
};
export const User = glyph('User', PERSON);
export const UserRound = glyph('UserRound', PERSON);
// A person moved aside for a sign beside them (add, remove).
const PERSON_BESIDE = <>
  <circle cx="6.5" cy="5" r="2.35" />
  <path d="M2.4 13.05c.32-2.3 1.95-3.7 4.1-3.7s3.78 1.4 4.1 3.7a.7.7 0 0 1-.7.8H3.1a.7.7 0 0 1-.7-.8Z" />
</>;
export const UserPlus = glyph('UserPlus', {
  solid: PERSON_BESIDE,
  line: <path d="M12.75 4.25v4M10.75 6.25h4" />,
});

export const Users = glyph('Users', {
  solid: <>
    <circle cx="6.25" cy="5.1" r="2.25" />
    <path d="M2.35 13.05c.3-2.2 1.9-3.55 3.9-3.55s3.6 1.35 3.9 3.55a.7.7 0 0 1-.7.8H3.05a.7.7 0 0 1-.7-.8Z" />
    <circle cx="11.6" cy="5.4" r="1.75" />
    <path d="M11.6 9.5c1.6 0 2.85 1.05 3.1 2.8a.6.6 0 0 1-.6.7h-2.15c-.12-1.35-.62-2.5-1.5-3.3.36-.13.75-.2 1.15-.2Z" />
  </>,
});


export const ClipboardList = glyph('ClipboardList', {
  solid: <><rect x="3.25" y="2.75" width="9.5" height="11" rx="1.8" /><rect x="5.75" y="1.5" width="4.5" height="2.5" rx="1" /></>,
  cut: <><path d="M5.25 4.6h5.5" strokeWidth={1.1} /><path d="M5.9 7.6h4.2M5.9 10.1h2.8" /></>,
});

export const Kanban = glyph('Kanban', {
  solid: <>
    <rect x="2.75" y="2.75" width="2.8" height="8.5" rx="1.1" />
    <rect x="6.6" y="2.75" width="2.8" height="5.5" rx="1.1" />
    <rect x="10.45" y="2.75" width="2.8" height="10.5" rx="1.1" />
  </>,
});

const LIST = {
  solid: <><circle cx="3.6" cy="4.5" r="1.1" /><circle cx="3.6" cy="8" r="1.1" /><circle cx="3.6" cy="11.5" r="1.1" /></>,
  line: <path d="M6.5 4.5h6.5M6.5 8h6.5M6.5 11.5h6.5" />,
};
export const List = glyph('List', LIST);

export const Flag = glyph('Flag', {
  solid: <path d="M3.75 2.6h7.85a.5.5 0 0 1 .41.79L10.35 5.9l1.66 2.51a.5.5 0 0 1-.41.79H3.75Z" />,
  line: <path d="M3.75 2.25v11.5" />,
});

export const Bot = glyph('Bot', {
  solid: <><rect x="3" y="5" width="10" height="8" rx="2.4" /><circle cx="8" cy="2.4" r="1.05" /></>,
  cut: <><circle cx="6.1" cy="8.9" r="1" style={hole} /><circle cx="9.9" cy="8.9" r="1" style={hole} /></>,
  line: <path d="M8 3.4V5" />,
});

const FOLDER_SHAPE = <path d="M2.5 4.25c0-.69.56-1.25 1.25-1.25h2.6c.33 0 .65.13.88.37l.95.95c.24.23.55.36.88.36h3.19c.69 0 1.25.56 1.25 1.25v6.82c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25Z" />;
export const Folder = glyph('Folder', { solid: FOLDER_SHAPE });
export const FolderPlus = glyph('FolderPlus', { solid: FOLDER_SHAPE, cut: <path d="M8 6.75v4M6 8.75h4" strokeWidth={1.3} /> });
export const FolderInput = glyph('FolderInput', { solid: FOLDER_SHAPE, cut: <path d="M5.75 8.75h4.25M8.25 7l1.75 1.75L8.25 10.5" strokeWidth={1.3} /> });

export const Inbox = glyph('Inbox', {
  solid: <path d="M4.4 2.75h7.2c.6 0 1.13.4 1.3.98l1.35 4.6c.03.1.05.2.05.3v3.37a1.25 1.25 0 0 1-1.25 1.25H2.95a1.25 1.25 0 0 1-1.25-1.25V8.63c0-.1.02-.2.05-.3l1.35-4.6c.17-.58.7-.98 1.3-.98Z" />,
  cut: <path d="M1.6 8.25h3.15l.9 1.6h4.7l.9-1.6h3.15" strokeWidth={1.1} />,
});

export const Archive = glyph('Archive', {
  solid: <><rect x="2.25" y="2.75" width="11.5" height="3" rx="1" /><path d="M3.25 6.75h9.5v5.5a1.5 1.5 0 0 1-1.5 1.5h-6.5a1.5 1.5 0 0 1-1.5-1.5Z" /></>,
  cut: <path d="M6.5 9.1h3" />,
});

export const Lock = glyph('Lock', {
  solid: <rect x="3.25" y="7" width="9.5" height="7" rx="1.8" />,
  cut: <circle cx="8" cy="10.5" r="1" style={hole} />,
  line: <path d="M5.25 7V5.25a2.75 2.75 0 0 1 5.5 0V7" />,
});

export const Tag = glyph('Tag', {
  solid: <path d="M2.5 3.25c0-.41.34-.75.75-.75h4.4c.2 0 .39.08.53.22l5.6 5.6a.75.75 0 0 1 0 1.06l-4.4 4.4a.75.75 0 0 1-1.06 0l-5.6-5.6a.75.75 0 0 1-.22-.53Z" />,
  cut: <circle cx="5.6" cy="5.6" r="1.1" style={hole} />,
});

export const Trash2 = glyph('Trash2', {
  solid: <path d="M4 5.6h8l-.6 7.3a1.5 1.5 0 0 1-1.5 1.35H6.1a1.5 1.5 0 0 1-1.5-1.35Z" />,
  cut: <path d="M6.75 7.9v3.9M9.25 7.9v3.9" />,
  line: <path d="M2.75 4.1h10.5M6.25 4.1V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.1" />,
});

const PENCIL = {
  solid: <path d="M11.1 2.6a1.6 1.6 0 0 1 2.3 2.3l-7.4 7.4-3.1.8.8-3.1Z" />,
  cut: <path d="m9.55 4.15 2.3 2.3" />,
};
export const Pencil = glyph('Pencil', PENCIL);
export const PenLine = glyph('PenLine', { ...PENCIL, line: <path d="M8.5 13.75h4.75" /> });

export const Copy = glyph('Copy', {
  solid: <rect x="5.5" y="5.5" width="8" height="8" rx="1.8" />,
  line: <path d="M3.5 10.5h-.25a.75.75 0 0 1-.75-.75v-6.5a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 .75.75v.25" />,
});

export const Paperclip = glyph('Paperclip', {
  line: <path d="M12.5 7.5 7.6 12.4a2.9 2.9 0 0 1-4.1-4.1l5.3-5.3a1.95 1.95 0 0 1 2.75 2.75l-5.3 5.3a1 1 0 0 1-1.4-1.4l4.9-4.9" />,
});

// ── Signals ───────────────────────────────────────────────────

const CIRCLE = <circle cx="8" cy="8" r="5.75" />;
export const CheckCircle2 = glyph('CheckCircle2', { solid: CIRCLE, cut: <path d="m5.6 8.1 1.6 1.6 3.2-3.3" strokeWidth={1.3} /> });
export const CircleCheck = glyph('CircleCheck', { solid: CIRCLE, cut: <path d="m5.6 8.1 1.6 1.6 3.2-3.3" strokeWidth={1.3} /> });
const ALERT = { solid: CIRCLE, cut: <><path d="M8 5v3.4" strokeWidth={1.3} /><circle cx="8" cy="10.75" r=".8" style={hole} /></> };
export const AlertCircle = glyph('AlertCircle', ALERT);
export const CircleAlert = glyph('CircleAlert', ALERT);
export const AlertTriangle = glyph('AlertTriangle', {
  solid: <path d="M7.1 2.6a1.05 1.05 0 0 1 1.8 0l5.15 9.15a1.05 1.05 0 0 1-.9 1.55H2.85a1.05 1.05 0 0 1-.9-1.55Z" />,
  cut: <><path d="M8 6.1v3" strokeWidth={1.3} /><circle cx="8" cy="11.1" r=".8" style={hole} /></>,
});

// AI — a thought joined to the things it reaches.
export const AiGraph = glyph('AiGraph', {
  solid: <>
    <circle cx="8" cy="8" r="2.35" />
    <circle cx="3.6" cy="3.6" r="1.35" /><circle cx="12.4" cy="4.1" r="1.35" />
    <circle cx="12" cy="12.4" r="1.35" /><circle cx="3.8" cy="12" r="1.35" />
  </>,
  line: <path d="M4.6 4.6 6.4 6.4M11.4 4.9 9.7 6.5M11.1 11.4 9.6 9.8M4.8 11 6.4 9.6" style={{ strokeWidth: 1.2 }} />,
});

// ── Actions ───────────────────────────────────────────────────

const line = (displayName: string, d: string) => glyph(displayName, { line: <path d={d} /> });

export const Check = line('Check', 'M3.5 8.4 6.6 11.4 12.5 4.75');
export const CheckIcon = line('CheckIcon', 'M3.5 8.4 6.6 11.4 12.5 4.75');
export const Plus = line('Plus', 'M8 3.25v9.5M3.25 8h9.5');
export const PlusIcon = line('PlusIcon', 'M8 3.25v9.5M3.25 8h9.5');
export const X = line('X', 'm4.25 4.25 7.5 7.5M11.75 4.25l-7.5 7.5');
export const XIcon = line('XIcon', 'm4.25 4.25 7.5 7.5M11.75 4.25l-7.5 7.5');
export const Minus = line('Minus', 'M3.25 8h9.5');
export const ChevronDown = line('ChevronDown', 'M4.5 6.25 8 9.75l3.5-3.5');
export const ChevronDownIcon = line('ChevronDownIcon', 'M4.5 6.25 8 9.75l3.5-3.5');
export const ChevronUp = line('ChevronUp', 'M4.5 9.75 8 6.25l3.5 3.5');
export const ChevronUpIcon = line('ChevronUpIcon', 'M4.5 9.75 8 6.25l3.5 3.5');
export const ChevronRight = line('ChevronRight', 'M6.25 4.5 9.75 8l-3.5 3.5');
export const ChevronRightIcon = line('ChevronRightIcon', 'M6.25 4.5 9.75 8l-3.5 3.5');
export const ChevronLeft = line('ChevronLeft', 'M9.75 4.5 6.25 8l3.5 3.5');
export const ChevronLeftIcon = line('ChevronLeftIcon', 'M9.75 4.5 6.25 8l3.5 3.5');
export const ChevronsUpDown = line('ChevronsUpDown', 'M5.25 6 8 3.25 10.75 6M5.25 10 8 12.75 10.75 10');
export const ArrowRight = line('ArrowRight', 'M3 8h9.75M9 4.25 12.75 8 9 11.75');
export const ArrowLeft = line('ArrowLeft', 'M13 8H3.25M7 4.25 3.25 8 7 11.75');
export const ArrowUp = line('ArrowUp', 'M8 13V3.25M4.25 7 8 3.25 11.75 7');
export const ArrowDown = line('ArrowDown', 'M8 3v9.75M4.25 9 8 12.75 11.75 9');
export const ArrowUpRight = line('ArrowUpRight', 'm4.75 11.25 6.5-6.5M5.75 4.75h5.5v5.5');
export const ExternalLink = line('ExternalLink', 'M7 3.5H4.75A1.25 1.25 0 0 0 3.5 4.75v6.5c0 .69.56 1.25 1.25 1.25h6.5c.69 0 1.25-.56 1.25-1.25V9M9.5 3h3.5v3.5M13 3 7.5 8.5');
export const Download = line('Download', 'M8 2.5V10M4.75 7 8 10.25 11.25 7M3 13.25h10');
export const Upload = line('Upload', 'M8 10.5V3M4.75 6 8 2.75 11.25 6M3 13.25h10');
export const Maximize2 = line('Maximize2', 'M9.5 2.75h3.75V6.5M6.5 13.25H2.75V9.5M13.25 2.75l-4 4M2.75 13.25l4-4');
export const Minimize2 = line('Minimize2', 'M3.25 9.25H6.75v3.5M12.75 6.75H9.25v-3.5M6.75 9.25l-4 4M9.25 6.75l4-4');
export const Link2 = line('Link2', 'M6.5 5.25H5a2.75 2.75 0 0 0 0 5.5h1.5M9.5 5.25H11a2.75 2.75 0 0 1 0 5.5H9.5M5.75 8h4.5');
export const RefreshCw = line('RefreshCw', 'M12.9 6.4A5.1 5.1 0 0 0 3.7 4.9M3.1 9.6a5.1 5.1 0 0 0 9.2 1.5M3.4 2.6v2.6H6M12.6 13.4v-2.6H10');
export const RotateCcw = line('RotateCcw', 'M3.25 8a4.75 4.75 0 1 0 1.4-3.35L3.25 6M3.25 2.75V6h3.25');
export const Search = glyph('Search', { line: <><circle cx="7" cy="7" r="4.1" /><path d="m10.1 10.1 3.15 3.15" /></> });

export const MoreHorizontal = glyph('MoreHorizontal', {
  solid: <><circle cx="3.5" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" /><circle cx="12.5" cy="8" r="1.25" /></>,
});
export const Ellipsis = MoreHorizontal;

export const Play = glyph('Play', {
  solid: <path d="M5 3.4a.75.75 0 0 1 1.13-.65l6.55 4.6a.8.8 0 0 1 0 1.3l-6.55 4.6A.75.75 0 0 1 5 12.6Z" />,
});

// ── The rest ──────────────────────────────────────────────────
// Drawn in the same two kinds. A few outlines too intricate to redraw well
// on 16 units (a wrench, a hand) are Lucide's own, scaled to this grid at
// this weight.

const TO16 = 'scale(0.6667)';
const scaledLine = (displayName: string, paths: string[]) => glyph(displayName, {
  line: <g transform={TO16} style={{ strokeWidth: 2.25 }}>{paths.map((d) => <path key={d} d={d} />)}</g>,
});

export const Home = House;
export const SearchIcon = Search;
export const PlayIcon = Play;
export const TriangleAlert = AlertTriangle;

// Pages of a kind: the page, its fold, and a mark for the kind.
const FOLD = <path d="M9.5 1.5v3a.5.5 0 0 0 .5.5h3" strokeWidth={1.1} />;
const page = (displayName: string, mark: ReactNode) => glyph(displayName, { solid: PAGE.solid, cut: <>{FOLD}{mark}</> });
export const FilePlus = page('FilePlus', <path d="M8.5 7.5v4M6.5 9.5h4" strokeWidth={1.3} />);
export const FileUp = page('FileUp', <path d="M8.5 11.75v-4M6.9 9.1l1.6-1.6 1.6 1.6" strokeWidth={1.25} />);
export const FileDown = page('FileDown', <path d="M8.5 7.25v4M6.9 9.9l1.6 1.6 1.6-1.6" strokeWidth={1.25} />);
export const FileCode2 = page('FileCode2', <path d="M7.4 7.9 6 9.5l1.4 1.6M9.6 7.9 11 9.5l-1.4 1.6" strokeWidth={1.15} />);
export const FileJson = page('FileJson', <path d="M7.4 7.4c-.6 0-.9.3-.9.9v.45c0 .45-.2.7-.65.7.45 0 .65.25.65.7v.45c0 .6.3.9.9.9M9.6 7.4c.6 0 .9.3.9.9v.45c0 .45.2.7.65.7-.45 0-.65.25-.65.7v.45c0 .6-.3.9-.9.9" strokeWidth={1} />);
export const FileSpreadsheet = page('FileSpreadsheet', <path d="M4 9.6h9M8.5 7v7" strokeWidth={1} />);
export const FileVideo = page('FileVideo', <path d="M7.35 7.7v3.6l3-1.8Z" style={hole} />);
export const FileAudio = page('FileAudio', <><path d="M8.6 11.3V7.9l1.9-.6" strokeWidth={1} /><circle cx="7.75" cy="11.4" r="1" style={hole} /></>);
export const FileImage = page('FileImage', <><circle cx="7" cy="8.1" r=".95" style={hole} /><path d="M4 13.2 7.6 10l1.3 1.1 1.6-1.5L13 12v2H4Z" style={hole} /></>);
export const FileArchive = page('FileArchive', <><path d="M7.5 5.6v.8M7.5 7.6v.8" strokeWidth={1} /><rect x="6.6" y="9.4" width="1.8" height="2.4" rx=".55" style={hole} /></>);
export const FileLock2 = page('FileLock2', <><rect x="6.4" y="9.6" width="4.2" height="3.1" rx=".7" style={hole} /><path d="M7.4 9.6v-.8a1.1 1.1 0 0 1 2.2 0v.8" strokeWidth={1} /></>);

export const ScrollText = glyph('ScrollText', {
  solid: <rect x="3.75" y="2.25" width="8.5" height="11.5" rx="1.7" />,
  cut: <path d="M6.1 5.6h3.8M6.1 8h3.8M6.1 10.4h2.3" />,
});

export const NotebookText = glyph('NotebookText', {
  solid: <rect x="4" y="2.25" width="8.75" height="11.5" rx="1.7" />,
  cut: <path d="M7.1 5.75h3.2M7.1 8.25h3.2" />,
  line: <path d="M2.75 5h2.5M2.75 8h2.5M2.75 11h2.5" />,
});

export const BookMarked = glyph('BookMarked', {
  solid: <rect x="3.25" y="2.25" width="9.5" height="11.5" rx="1.7" />,
  cut: <path d="M8.4 1.8v4.6l1.3-1 1.3 1V1.8Z" style={hole} />,
});

export const Presentation = glyph('Presentation', {
  solid: <rect x="2.25" y="2.5" width="11.5" height="7.75" rx="1.6" />,
  line: <path d="M8 10.25v3M5.75 13.5h4.5" />,
});

export const Workflow = glyph('Workflow', {
  solid: <><rect x="2.5" y="2.5" width="5" height="5" rx="1.3" /><rect x="8.5" y="8.5" width="5" height="5" rx="1.3" /></>,
  line: <path d="M5 7.5v1.25A2.25 2.25 0 0 0 7.25 11H8.5" />,
});

const sparkle = (cx: number, cy: number, r: number) => {
  const k = r * 0.16;
  return `M${cx} ${cy - r}Q${cx + k} ${cy - k} ${cx + r} ${cy}Q${cx + k} ${cy + k} ${cx} ${cy + r}Q${cx - k} ${cy + k} ${cx - r} ${cy}Q${cx - k} ${cy - k} ${cx} ${cy - r}Z`;
};
export const Sparkles = glyph('Sparkles', {
  solid: <><path d={sparkle(6.75, 9, 5)} /><path d={sparkle(12.1, 3.9, 2.4)} /></>,
});

export const Zap = glyph('Zap', {
  solid: <path d="M8.95 1.85a.45.45 0 0 1 .8.32L9.15 6.5h3.3a.55.55 0 0 1 .43.9l-5.83 6.75a.45.45 0 0 1-.8-.32l.6-4.33h-3.3a.55.55 0 0 1-.43-.9Z" />,
});

export const Wrench = glyph('Wrench', {
  solid: <path transform={TO16} d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
});

export const Pin = glyph('Pin', {
  solid: <path transform={TO16} d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />,
  line: <path d="M8 11.5v2.75" />,
});

export const Hand = scaledLine('Hand', [
  'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2', 'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2', 'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8',
  'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
]);
export const Handshake = scaledLine('Handshake', [
  'm11 17 2 2a1 1 0 1 0 3-3', 'm14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4',
  'm21 3 1 11h-2', 'M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3', 'M3 4h8',
]);

export const Building2 = glyph('Building2', {
  solid: <><rect x="2.75" y="2.25" width="6.75" height="11.5" rx="1.4" /><rect x="8" y="6.25" width="5.25" height="7.5" rx="1.2" /></>,
  cut: <path d="M5 5.25h2.25M5 7.75h2.25M5 10.25h2.25M9.5 9.25h-.1" strokeWidth={1.1} />,
});

export const Smile = glyph('Smile', {
  solid: CIRCLE,
  cut: <><circle cx="6.1" cy="6.8" r=".8" style={hole} /><circle cx="9.9" cy="6.8" r=".8" style={hole} /><path d="M5.75 9.5a2.75 2.75 0 0 0 4.5 0" strokeWidth={1.25} /></>,
});

const CLOCK = { solid: CIRCLE, cut: <path d="M8 4.75V8h2.6" strokeWidth={1.3} /> };
export const Clock = glyph('Clock', CLOCK);
export const Clock3 = glyph('Clock3', CLOCK);
export const Timer = glyph('Timer', {
  solid: <circle cx="8" cy="9" r="5" />,
  cut: <path d="M8 9V6.4" strokeWidth={1.3} />,
  line: <path d="M6.5 1.75h3" />,
});

export const CalendarPlus = glyph('CalendarPlus', { ...CALENDAR, cut: <>{CALENDAR.cut}<path d="M8 8.6v3.3M6.35 10.25h3.3" strokeWidth={1.25} /></> });
export const CalendarRange = glyph('CalendarRange', { ...CALENDAR, cut: <>{CALENDAR.cut}<path d="M5.25 10.25h5.5" strokeWidth={1.4} /></> });
export const CalendarClock = glyph('CalendarClock', {
  solid: <><path d="M4.4 3.25h6.2c.9 0 1.65.75 1.65 1.65V7a4.25 4.25 0 0 0-5.25 6.25H4.4c-.91 0-1.65-.74-1.65-1.65V4.9c0-.9.74-1.65 1.65-1.65Z" /><circle cx="11" cy="11" r="3.1" /></>,
  cut: <><path d="M2 6.75h12" /><circle cx="5.5" cy="3.35" r="1.35" style={hole} /><circle cx="10.5" cy="3.35" r="1.35" style={hole} /><path d="M11 9.5V11h1.1" strokeWidth={1} /></>,
  line: <path d="M5.5 1.9v2.6M10.5 1.9v2.6" />,
});

export const Plug = glyph('Plug', {
  solid: <path d="M4.25 5.25h7.5v2.5a3.75 3.75 0 0 1-7.5 0Z" />,
  line: <path d="M6.25 1.9v3.35M9.75 1.9v3.35M8 11.5v2.6" />,
});

const PANEL_FRAME = <rect x="2.75" y="3.25" width="10.5" height="9.5" rx="1.75" />;
export const PanelLeft = glyph('PanelLeft', {
  solid: <path d="M4.5 3.25h2v9.5h-2a1.75 1.75 0 0 1-1.75-1.75V5a1.75 1.75 0 0 1 1.75-1.75Z" />,
  line: PANEL_FRAME,
});
export const PanelRight = glyph('PanelRight', {
  solid: <path d="M11.5 3.25h-2v9.5h2a1.75 1.75 0 0 0 1.75-1.75V5a1.75 1.75 0 0 0-1.75-1.75Z" />,
  line: PANEL_FRAME,
});
export const PanelLeftOpen = glyph('PanelLeftOpen', { line: <>{PANEL_FRAME}<path d="M6.25 3.5v9M8.9 6.25 10.65 8 8.9 9.75" /></> });
export const PanelLeftClose = glyph('PanelLeftClose', { line: <>{PANEL_FRAME}<path d="M6.25 3.5v9M10.65 6.25 8.9 8l1.75 1.75" /></> });

const BUBBLE = <path d="M3.75 2.75h8.5c.69 0 1.25.56 1.25 1.25v6c0 .69-.56 1.25-1.25 1.25H6.5l-2.6 2.1a.5.5 0 0 1-.82-.39V11.2A1.25 1.25 0 0 1 2.5 10V4c0-.69.56-1.25 1.25-1.25Z" />;
export const MessageSquare = glyph('MessageSquare', { solid: BUBBLE });
export const MessageSquarePlus = glyph('MessageSquarePlus', { solid: BUBBLE, cut: <path d="M8 5v4M6 7h4" strokeWidth={1.3} /> });

export const Mail = glyph('Mail', {
  solid: <rect x="2" y="3.25" width="12" height="9.5" rx="1.8" />,
  cut: <path d="m2.75 4.9 5.25 3.9 5.25-3.9" strokeWidth={1.2} />,
});

export const KeyRound = glyph('KeyRound', {
  solid: <circle cx="10.1" cy="5.9" r="3.6" />,
  cut: <circle cx="10.9" cy="5.1" r=".95" style={hole} />,
  line: <path d="M7.6 8.4 2.75 13.25M4.4 11.6l1.6 1.6" />,
});

export const Globe = glyph('Globe', {
  solid: CIRCLE,
  cut: <><path d="M2 8h12" strokeWidth={1} /><path d="M8 2.25c-1.55 1.6-2.35 3.5-2.35 5.75S6.45 12.15 8 13.75c1.55-1.6 2.35-3.5 2.35-5.75S9.55 3.85 8 2.25Z" strokeWidth={1} /></>,
});

export const Compass = glyph('Compass', { solid: CIRCLE, cut: <path d="M10.6 5.4 9.2 9.2 5.4 10.6l1.4-3.8Z" style={hole} /> });
export const CirclePlay = glyph('CirclePlay', { solid: CIRCLE, cut: <path d="M6.6 5.4v5.2L10.75 8Z" style={hole} /> });
export const Info = glyph('Info', { solid: CIRCLE, cut: <><path d="M8 7.4v3.6" strokeWidth={1.3} /><circle cx="8" cy="5.15" r=".8" style={hole} /></> });
export const HelpCircle = glyph('HelpCircle', { solid: CIRCLE, cut: <><path d="M6.35 6.35a1.7 1.7 0 0 1 3.3.55c0 1.1-1.65 1.35-1.65 2.4" strokeWidth={1.3} /><circle cx="8" cy="11.1" r=".8" style={hole} /></> });

export const Palette = glyph('Palette', {
  solid: <path d="M8 2.25a5.75 5.75 0 0 0 0 11.5c.75 0 1.2-.55 1.2-1.15 0-.3-.1-.55-.3-.78a1.1 1.1 0 0 1 .85-1.82h1.25a3.25 3.25 0 0 0 2.75-3.3C13.75 4.4 11.15 2.25 8 2.25Z" />,
  cut: <><circle cx="5.1" cy="7.4" r=".85" style={hole} /><circle cx="6.75" cy="4.9" r=".85" style={hole} /><circle cx="9.6" cy="4.9" r=".85" style={hole} /><circle cx="11.25" cy="7.2" r=".85" style={hole} /></>,
});

const EYE = <path d="M8 3.5c3 0 5.1 2.2 5.9 3.95a1.3 1.3 0 0 1 0 1.1C13.1 10.3 11 12.5 8 12.5S2.9 10.3 2.1 8.55a1.3 1.3 0 0 1 0-1.1C2.9 5.7 5 3.5 8 3.5Z" />;
export const Eye = glyph('Eye', { solid: EYE, cut: <circle cx="8" cy="8" r="2.1" strokeWidth={1.2} /> });
export const EyeOff = glyph('EyeOff', {
  solid: EYE,
  cut: <><circle cx="8" cy="8" r="2.1" strokeWidth={1.2} /><path d="m2.75 2.75 10.5 10.5" strokeWidth={2.8} /></>,
  line: <path d="m3 3 10 10" />,
});

export const Filter = glyph('Filter', {
  solid: <path d="M2.65 3.5c-.2-.45.1-.95.6-.95h9.5c.5 0 .8.5.6.95L9.5 8.3v4.35a.6.6 0 0 1-.9.52l-1.4-.8a.6.6 0 0 1-.3-.52V8.3Z" />,
});

export const FlaskConical = glyph('FlaskConical', {
  solid: <path d="M6.25 2.25h3.5v4.1l3.45 5.75a1.1 1.1 0 0 1-.95 1.65H3.75a1.1 1.1 0 0 1-.95-1.65l3.45-5.75Z" />,
  cut: <path d="M4.6 9.75h6.8" strokeWidth={1} />,
  line: <path d="M5.5 2.25h5" />,
});

export const Diamond = glyph('Diamond', {
  solid: <path d="M7.3 2.2a1 1 0 0 1 1.4 0l5.1 5.1a1 1 0 0 1 0 1.4l-5.1 5.1a1 1 0 0 1-1.4 0L2.2 8.7a1 1 0 0 1 0-1.4Z" />,
});
export const Square = glyph('Square', { solid: <rect x="3" y="3" width="10" height="10" rx="2" /> });
export const Pause = glyph('Pause', { solid: <><rect x="4" y="3" width="2.75" height="10" rx="1" /><rect x="9.25" y="3" width="2.75" height="10" rx="1" /></> });

export const Save = glyph('Save', {
  solid: <path d="M3.75 2.5h6.7c.33 0 .65.13.88.37l2.3 2.3c.24.23.37.55.37.88v6.2c0 .69-.56 1.25-1.25 1.25h-9c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25Z" />,
  cut: <><rect x="5.1" y="9" width="5.8" height="3.25" rx=".6" style={hole} /><path d="M5.6 2v2.4h4V2" strokeWidth={1.1} /></>,
});

export const Image = glyph('Image', {
  solid: <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.9" />,
  cut: <><circle cx="5.9" cy="6.3" r="1.1" style={hole} /><path d="M1.5 14v-1.6l4-3.6 2 1.8 3.2-3 3.8 3.4V14Z" style={hole} /></>,
});
export const ImagePlus = glyph('ImagePlus', {
  solid: <rect x="2" y="4" width="9.75" height="9.5" rx="1.8" />,
  cut: <><circle cx="5.3" cy="7.3" r="1" style={hole} /><path d="M1.5 14v-1.4l3.4-3.1 1.7 1.5 2.8-2.6 3.1 2.8V14Z" style={hole} /></>,
  line: <path d="M13 1.75v3.5M11.25 3.5h3.5" />,
});

export const LayoutGrid = glyph('LayoutGrid', {
  solid: <>{[[2.5, 2.5], [8.9, 2.5], [2.5, 8.9], [8.9, 8.9]].map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="4.6" height="4.6" rx="1.25" />)}</>,
});
export const LayoutDashboard = glyph('LayoutDashboard', {
  solid: <>
    <rect x="2.5" y="2.5" width="5" height="6.5" rx="1.25" /><rect x="8.75" y="2.5" width="4.75" height="4" rx="1.25" />
    <rect x="8.75" y="7.75" width="4.75" height="5.75" rx="1.25" /><rect x="2.5" y="10.25" width="5" height="3.25" rx="1.25" />
  </>,
});
export const Blocks = glyph('Blocks', {
  solid: <>
    <rect x="2.5" y="2.75" width="4.75" height="4.75" rx="1.2" /><rect x="2.5" y="8.75" width="4.75" height="4.75" rx="1.2" />
    <rect x="8.5" y="8.75" width="4.75" height="4.75" rx="1.2" /><rect x="9" y="2.25" width="4.5" height="4.5" rx="1.2" transform="rotate(12 11.25 4.5)" />
  </>,
});
export const Columns3 = glyph('Columns3', { solid: <rect x="2.5" y="2.75" width="11" height="10.5" rx="1.9" />, cut: <path d="M6.2 2v12M9.8 2v12" /> });
export const Rows3 = glyph('Rows3', { solid: <rect x="2.5" y="2.75" width="11" height="10.5" rx="1.9" />, cut: <path d="M2 6.3h12M2 9.7h12" /> });

export const GripVertical = glyph('GripVertical', {
  solid: <>{[4.25, 8, 11.75].flatMap((y) => [6, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.05" />))}</>,
});

export const ListOrdered = glyph('ListOrdered', {
  solid: <>{[4.5, 8, 11.5].map((y) => <rect key={y} x="2.5" y={y - 1.05} width="2.1" height="2.1" rx=".55" />)}</>,
  line: LIST.line,
});
export const ListChecks = glyph('ListChecks', { line: <path d="m2.5 4.6 1.1 1.1 1.9-2.1M2.5 10.6l1.1 1.1 1.9-2.1M7.75 4.75h5.5M7.75 10.75h5.5" /> });
export const ListTodo = glyph('ListTodo', {
  solid: <rect x="2.25" y="2.75" width="4.25" height="4.25" rx="1.1" />,
  cut: <path d="m3.35 4.95.8.8 1.3-1.45" strokeWidth={1} />,
  line: <><rect x="2.85" y="9.6" width="3.05" height="3.05" rx=".8" /><path d="M8.75 4.9h4.5M8.75 11.1h4.5" /></>,
});
export const ListFilter = line('ListFilter', 'M2.5 4.5h11M4.5 8h7M6.5 11.5h3');
export const Menu = line('Menu', 'M2.75 4.5h10.5M2.75 8h10.5M2.75 11.5h10.5');
export const Hash = line('Hash', 'M3 6h10.5M2.5 10H13M6.5 2.75 5.5 13.25M10.5 2.75l-1 10.5');

// Code
const node = (cx: number, cy: number) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.75" />;
export const GitBranch = glyph('GitBranch', { solid: <>{node(5, 3.75)}{node(5, 12.25)}{node(11, 4.25)}</>, line: <path d="M5 5.5v5M11 6c0 2.6-2 3.85-6 4.5" /> });
export const GitMerge = glyph('GitMerge', { solid: <>{node(5, 3.75)}{node(5, 12.25)}{node(11.25, 10)}</>, line: <path d="M5 5.5v5M5 5.5c0 2.6 2.3 4.5 4.5 4.5" /> });
export const GitCompare = glyph('GitCompare', {
  solid: <>{node(4.5, 4)}{node(11.5, 12)}</>,
  line: <path d="M4.5 5.75V10a2 2 0 0 0 2 2h2.5M11.5 10.25V6a2 2 0 0 0-2-2H7M7.75 10.5 9.25 12l-1.5 1.5M8.25 2.5 6.75 4l1.5 1.5" />,
});
export const GitPullRequest = glyph('GitPullRequest', {
  solid: <>{node(4.5, 3.75)}{node(4.5, 12.25)}{node(11.5, 12.25)}</>,
  line: <path d="M4.5 5.5v5M11.5 10.5V6.25a1.75 1.75 0 0 0-1.75-1.75H7.5M9 3 7.5 4.5 9 6" />,
});
export const GitPullRequestDraft = glyph('GitPullRequestDraft', {
  solid: <>{node(4.5, 3.75)}{node(4.5, 12.25)}{node(11.5, 12.25)}<circle cx="11.5" cy="4" r=".85" /><circle cx="11.5" cy="7.25" r=".85" /></>,
  line: <path d="M4.5 5.5v5" />,
});
export const GitPullRequestClosed = glyph('GitPullRequestClosed', {
  solid: <>{node(4.5, 3.75)}{node(4.5, 12.25)}{node(11.5, 12.25)}</>,
  line: <path d="M4.5 5.5v5M11.5 7.75v2.75M10 2.75l3 3M13 2.75l-3 3" />,
});
export const Diff = line('Diff', 'M8 2.75v5M5.5 5.25h5M5.5 12.25h5');

export const Waypoints = glyph('Waypoints', {
  solid: <>{[[8, 3.25], [3.25, 8], [12.75, 8], [8, 12.75]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />)}</>,
  line: <path d="M6.85 4.4 4.4 6.85M9.15 4.4l2.45 2.45M4.4 9.15l2.45 2.45" />,
});

export const UserMinus = glyph('UserMinus', { solid: PERSON_BESIDE, line: <path d="M10.75 6.25h4" /> });

export const ArchiveRestore = glyph('ArchiveRestore', {
  solid: <><rect x="2.25" y="2.75" width="11.5" height="3" rx="1" /><path d="M3.25 6.75h9.5v5.5a1.5 1.5 0 0 1-1.5 1.5h-6.5a1.5 1.5 0 0 1-1.5-1.5Z" /></>,
  cut: <path d="M8 12.1V8.6M6.5 10 8 8.5 9.5 10" strokeWidth={1.2} />,
});

export const SquarePen = glyph('SquarePen', {
  solid: <path d="M11.6 2.1a1.35 1.35 0 0 1 1.9 1.9L8.6 8.9l-2.4.6.6-2.4Z" />,
  line: <path d="M7.25 2.75h-3A1.25 1.25 0 0 0 3 4v7.75C3 12.44 3.56 13 4.25 13H12c.69 0 1.25-.56 1.25-1.25v-3" />,
});

export const Sun = glyph('Sun', {
  solid: <circle cx="8" cy="8" r="2.75" />,
  line: <path d="M8 1.75v1.1M8 13.15v1.1M1.75 8h1.1M13.15 8h1.1M3.6 3.6l.75.75M11.65 11.65l.75.75M3.6 12.4l.75-.75M11.65 4.35l.75-.75" />,
});

export const Fingerprint = line('Fingerprint', 'M4.6 12.6c.55-1.25.85-2.7.85-4.6a2.55 2.55 0 0 1 5.1 0c0 1.25-.1 2.45-.4 3.6M8 8c0 2.05-.4 3.95-1.2 5.6M3.2 9.6c.1-.5.15-1.05.15-1.6a4.65 4.65 0 0 1 8.4-2.75M12.65 8c0 1.85-.2 3.35-.6 4.5');
export const Languages = line('Languages', 'M2.5 4h6M5.5 2.75V4M3.6 4c.5 2.4 2.1 4.1 4.6 5M7.4 4C6.9 6.4 5.3 8.1 2.8 9M8.75 13.5l2.4-6 2.4 6M9.5 11.75h3.3');
export const LogOut = line('LogOut', 'M6 2.75H4.25C3.56 2.75 3 3.31 3 4v8c0 .69.56 1.25 1.25 1.25H6M7 8h6.5M10.5 4.75 13.75 8l-3.25 3.25');
export const History = line('History', 'M3.25 8a4.75 4.75 0 1 0 1.4-3.35L3.25 6M3.25 2.75V6h3.25M8 5.5V8l1.75 1.25');
export const RotateCw = line('RotateCw', 'M12.75 8a4.75 4.75 0 1 1-1.4-3.35L12.75 6M12.75 2.75V6H9.5');
export const CheckCheck = line('CheckCheck', 'M1.75 8.5 4.5 11.25 10 5.25M7.5 10.75l.5.5 5.75-6');
export const Unlink = line('Unlink', 'M6.5 5.25H5a2.75 2.75 0 0 0 0 5.5h1.5M9.5 5.25H11a2.75 2.75 0 0 1 0 5.5H9.5M5.5 2.25l.75 1.5M10.5 13.75l-.75-1.5');
export const Shuffle = line('Shuffle', 'M2.5 4.5h1.75a3 3 0 0 1 2.5 1.35l2.5 4.3a3 3 0 0 0 2.5 1.35h1.75M2.5 11.5h1.75a3 3 0 0 0 2.2-.95M9.55 5.45A3 3 0 0 1 11.75 4.5h1.75M11.75 2.75l1.75 1.75-1.75 1.75M11.75 9.75l1.75 1.75-1.75 1.75');
export const Scale = line('Scale', 'M8 2.5v11M5 13.5h6M3 4.5h10M3 4.5 1.5 8.4a1.6 1.6 0 0 0 3 0ZM13 4.5l-1.5 3.9a1.6 1.6 0 0 0 3 0Z');
export const CornerUpRight = line('CornerUpRight', 'M3.5 13v-4a3 3 0 0 1 3-3h6.5M9.75 2.75 13 6l-3.25 3.25');
export const CornerDownRight = line('CornerDownRight', 'M3.5 3v4a3 3 0 0 0 3 3h6.5M9.75 6.75 13 10l-3.25 3.25');
export const ArrowRightLeft = line('ArrowRightLeft', 'M3 5h10M10 2l3 3-3 3M13 11H3M6 8l-3 3 3 3');
export const Activity = line('Activity', 'M1.75 8h2.5L6 3.75l3.75 8.5L11.5 8h2.75');
export const ZoomIn = glyph('ZoomIn', { line: <><circle cx="7" cy="7" r="4.1" /><path d="m10.1 10.1 3.15 3.15M5.4 7h3.2M7 5.4v3.2" /></> });
export const ZoomOut = glyph('ZoomOut', { line: <><circle cx="7" cy="7" r="4.1" /><path d="m10.1 10.1 3.15 3.15M5.4 7h3.2" /></> });

// Strategy — geometric marks, their corners softened (SOFT): the layer that
// sets direction, and its units under it.
const SOFT = { stroke: 'currentColor', strokeWidth: 1.1, strokeLinejoin: 'round' } as const;

// Strategy itself: a compass rose, four long points and four short.
export const CompassRose = glyph('CompassRose', {
  solid: <>
    <path d="M8 1.5 9.35 6.65 14.5 8 9.35 9.35 8 14.5 6.65 9.35 1.5 8l5.15-1.35Z" {...SOFT} />
    <path d="M12.2 3.8 10 7.1 8.9 6ZM12.2 12.2 8.9 10 10 8.9ZM3.8 12.2 6 8.9 7.1 10ZM3.8 3.8 7.1 6 6 7.1Z" {...SOFT} />
  </>,
  cut: <circle cx="8" cy="8" r="1.05" style={hole} />,
});

// The Vision: the guiding star over the horizon.
export const GuidingStar = glyph('GuidingStar', {
  solid: <path d="M8 1.7 9.1 5.65 13.05 6.75 9.1 7.85 8 11.8 6.9 7.85 2.95 6.75 6.9 5.65Z" {...SOFT} />,
  line: <path d="M1.75 14.25h12.5" />,
});

// A Portfolio: chevrons stacked, an insignia — Initiatives advancing as one.
export const Chevrons = glyph('Chevrons', {
  solid: <>
    <path d="M2.9 7.2 8 3l5.1 4.2v2.1L8 5.1 2.9 9.3Z" {...SOFT} />
    <path d="M2.9 11.7 8 7.5l5.1 4.2v2.1L8 9.6 2.9 13.8Z" {...SOFT} />
  </>,
});

// An Initiative: a spearhead, the axis of advance.
export const Spearhead = glyph('Spearhead', {
  solid: <path d="M8 1.9 13.55 13.1 8 10.2 2.45 13.1Z" {...SOFT} />,
});

