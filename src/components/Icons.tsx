import type { SVGProps } from 'react';

const base = (d: React.ReactNode) => (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
    {d}
  </svg>
);

export const ICheck = base(<path d="M5 12.5l4.5 4.5L19 7.5" strokeWidth={3} />);
export const IX = base(<path d="M6 6l12 12M18 6L6 18" strokeWidth={3} />);
export const IClose = base(<path d="M6 6l12 12M18 6L6 18" />);
export const IChevR = base(<path d="M9 6l6 6-6 6" />);
export const IChevL = base(<path d="M15 6l-6 6 6 6" />);
export const ISearch = base(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>);
export const IPlus = base(<path d="M12 5v14M5 12h14" />);
export const IEdit = base(<><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></>);
export const ITrash = base(<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>);
export const INote = base(<><path d="M5 4h14v12l-4 4H5z" /><path d="M15 20v-4h4M8 9h8M8 13h5" /></>);
export const IUsers = base(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14c2.5 0 4.2 1.6 4.5 4.5" /></>);
export const IChecklist = base(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8l1.5 1.5L12 7M8 14l1.5 1.5L12 13M14 8.5h3M14 14.5h3" /></>);
export const IChart = base(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>);
export const IReport = base(<><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h6M9 9h2" /></>);
export const IMore = base(<><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>);
export const IUpload = base(<><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v4h16v-4" /></>);
export const IDownload = base(<><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 16v4h16v-4" /></>);
export const IMove = base(<><path d="M4 12h14M14 7l5 5-5 5" /></>);
export const ILogout = base(<><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></>);
export const IShield = base(<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>);
export const IDB = base(<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>);
export const ISettings = base(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>);
export const IMosque = base(<><path d="M12 2v2M7 10c0-3 2.5-5 5-6 2.5 1 5 3 5 6" /><path d="M5 21V10h14v11M3 21h18M10 21v-4a2 2 0 014 0v4M2 21V13M22 21V13" /></>);
export const IAllCheck = base(<><path d="M2 12.5l4.5 4.5L15 8.5" /><path d="M10 15.5l1.5 1.5L22 6.5" /></>);
export const IReset = base(<><path d="M4 12a8 8 0 108-8 8.5 8.5 0 00-6 2.5L4 8" /><path d="M4 3v5h5" /></>);
export const IArchive = base(<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v12h14V8M10 12h4" /></>);
export const IUp = base(<path d="M6 15l6-6 6 6" />);
export const IDown = base(<path d="M6 9l6 6 6-6" />);
export const IPdf = base(<><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /><text x="7.5" y="17.5" fontSize="6" fill="currentColor" stroke="none" fontWeight="700">PDF</text></>);
export const IXls = base(<><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 11l5 6M14 11l-5 6" /></>);
