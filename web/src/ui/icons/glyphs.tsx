'use client';

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

export const Target = glyph('Target', {
  solid: <>
    <path fillRule="evenodd" d="M8 2.75a5.25 5.25 0 1 0 0 10.5 5.25 5.25 0 0 0 0-10.5Zm0 1.3a3.95 3.95 0 1 1 0 7.9 3.95 3.95 0 0 1 0-7.9Z" />
    <circle cx="8" cy="8" r="2.1" />
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

export const Mountain = glyph('Mountain', {
  solid: <path d="M6.3 4.4a.8.8 0 0 1 1.4 0l1.65 2.85 1.05-1.65a.8.8 0 0 1 1.36.02l2.8 4.55a.8.8 0 0 1-.68 1.23H2.12a.8.8 0 0 1-.69-1.2Z" />,
});

export const Briefcase = glyph('Briefcase', {
  solid: <rect x="2.5" y="5" width="11" height="8.25" rx="1.8" />,
  cut: <path d="M2 8.75h12" />,
  line: <path d="M6 5V3.9a.9.9 0 0 1 .9-.9h2.2a.9.9 0 0 1 .9.9V5" />,
});

export const Stone = glyph('Stone', {
  solid: <path d="M7.35 2.3a.85.85 0 0 1 1.3 0l4.55 5.15a.85.85 0 0 1 0 1.1L8.65 13.7a.85.85 0 0 1-1.3 0L2.8 8.55a.85.85 0 0 1 0-1.1Z" />,
  cut: <path d="M2 8h12" />,
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
export const UserPlus = glyph('UserPlus', {
  solid: <>
    <circle cx="6.5" cy="5" r="2.35" />
    <path d="M2.4 13.05c.32-2.3 1.95-3.7 4.1-3.7s3.78 1.4 4.1 3.7a.7.7 0 0 1-.7.8H3.1a.7.7 0 0 1-.7-.8Z" />
  </>,
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
