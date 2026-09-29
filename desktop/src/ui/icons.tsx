import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 18, ...rest }: P) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...rest,
});

export const IconChat = (p: P) => <svg {...base(p)}><path d="M4 12.5c0-4.4 3.6-7.5 8-7.5s8 3.1 8 7.5-3.6 7.5-8 7.5c-1.1 0-2.2-.2-3.1-.5L4.5 21l1.1-3.6C4.6 16 4 14.3 4 12.5Z" /><path d="M8.5 12.5h.01M12 12.5h.01M15.5 12.5h.01" strokeWidth="2.6" /></svg>;
export const IconTasks = (p: P) => <svg {...base(p)}><rect x="4" y="4" width="16" height="16" rx="4" /><path d="m8 12 2.5 2.5L16 9" /></svg>;
export const IconSettings = (p: P) => <svg {...base(p)}><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" /><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2.6h-4l-.4 2.4A7.6 7.6 0 0 0 7 6.5l-2.4-.9-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.4-.9c.8.7 1.6 1.2 2.6 1.5l.4 2.4h4l.4-2.4c1-.3 1.8-.8 2.6-1.5l2.3.9 2-3.4-2-1.5Z" /></svg>;
export const IconMore = (p: P) => <svg {...base(p)}><path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth="3" /></svg>;
export const IconClose = (p: P) => <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>;
export const IconMinus = (p: P) => <svg {...base(p)}><path d="M6 12h12" /></svg>;
export const IconSend = (p: P) => <svg {...base(p)}><path d="M12 19V5M6 11l6-6 6 6" /></svg>;
export const IconStop = (p: P) => <svg {...base(p)}><rect x="7" y="7" width="10" height="10" rx="2.2" fill="currentColor" stroke="none" /></svg>;
export const IconPlus = (p: P) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>;
export const IconRetry = (p: P) => <svg {...base(p)}><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4 4.5v4h4" /></svg>;
export const IconReply = (p: P) => <svg {...base(p)}><path d="M9 7 4 12l5 5" /><path d="M4 12h9a7 7 0 0 1 7 7" /></svg>;
export const IconChevron = (p: P) => <svg {...base(p)}><path d="m9 6 6 6-6 6" /></svg>;
export const IconPower = (p: P) => <svg {...base(p)}><path d="M12 3v8" /><path d="M6.3 6.7a8 8 0 1 0 11.4 0" /></svg>;
export const IconKey = (p: P) => <svg {...base(p)}><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2.5 2.5M14 9l2 2" /></svg>;
export const IconFolder = (p: P) => <svg {...base(p)}><path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" /></svg>;
export const IconSparkle = (p: P) => <svg {...base(p)}><path d="M12 3.5 13.8 10 20.5 12 13.8 14 12 20.5 10.2 14 3.5 12 10.2 10Z" fill="currentColor" stroke="none" /></svg>;
export const IconCopy = (p: P) => <svg {...base(p)}><rect x="8" y="8" width="12" height="12" rx="3" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>;
export const IconTerminal = (p: P) => <svg {...base(p)}><rect x="3" y="4.5" width="18" height="15" rx="3" /><path d="m7.5 10 2.5 2-2.5 2M12.5 14.5h4" /></svg>;
export const IconExternal = (p: P) => <svg {...base(p)}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg>;
