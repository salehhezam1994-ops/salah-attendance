import type { SVGProps } from 'react';

const base = (d: React.ReactNode) => (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {d}
  </svg>
);

export const IHome = base(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>);
export const IMap = base(<><circle cx="12" cy="5" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="18" r="2" /><circle cx="12" cy="13" r="2" /><path d="M12 7v4M10.5 14.5L6.5 16.5M13.5 14.5l4 2" /></>);
export const IChat = base(<><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" /><path d="M8.5 11h7M8.5 14h4" /></>);
export const IBook = base(<><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5z" /><path d="M4 19a2 2 0 012-2h13" /><path d="M9 7h6" /></>);
export const IChart = base(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>);
export const ISettings = base(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>);
export const IMic = base(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></>);
export const ISpeaker = base(<><path d="M11 5L6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" /></>);
export const IPlay = base(<path d="M7 4l13 8-13 8V4z" />);
export const IPause = base(<><path d="M8 5v14M16 5v14" /></>);
export const IStop = base(<rect x="6" y="6" width="12" height="12" rx="2" />);
export const IRepeat = base(<><path d="M4 12a8 8 0 0114-5.3L20 9" /><path d="M20 4v5h-5" /></>);
export const ISend = base(<path d="M4 12l16-8-6 16-2.5-6.5L4 12z" />);
export const IPlus = base(<path d="M12 5v14M5 12h14" />);
export const IMinus = base(<path d="M5 12h14" />);
export const IFit = base(<><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>);
export const IBookmark = base(<path d="M6 3h12v18l-6-4-6 4V3z" />);
export const IBack = base(<path d="M15 6l-6 6 6 6" />);
export const INext = base(<path d="M9 6l6 6-6 6" />);
export const ILink = base(<><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></>);
export const ICheck = base(<path d="M5 13l4 4L19 7" />);
export const IFloat = base(<><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="12" y="11" width="7" height="6" rx="1" /></>);
export const ISearch = base(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>);
export const ISpark = base(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />);
export const IQuestion = base(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 114 2c-.8.5-1.5 1-1.5 2M12 17h.01" /></>);
export const IPlan = base(<><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>);
export const IUpdates = base(<><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></>);
