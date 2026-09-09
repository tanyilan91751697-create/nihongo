import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const;
export type JlptLevel = (typeof JLPT_LEVELS)[number];

/** Tailwind classes for a JLPT badge, shared by every page that shows a level. */
export function levelBadgeClass(level?: string | null): string {
  switch (level) {
    case 'N5':
      return 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30';
    case 'N4':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
    case 'N3':
      return 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30';
    case 'N2':
      return 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30';
    case 'N1':
      return 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30';
    default:
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
  }
}

export function formatDate(value?: string | Date | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z')) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z')) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relativeDays(value?: string | null): number | null {
  if (!value) return null;
  const date = new Date(value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

export function formatInterval(days: number): string {
  if (days <= 0) return '<10m';
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(1)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
