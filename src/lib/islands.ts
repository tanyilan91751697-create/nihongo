/** Island lifecycle vocabulary shared by the list and detail views. */
export const STATUSES = ['draft', 'translated', 'verified', 'drilling', 'deployable'] as const;

export type IslandStatus = (typeof STATUSES)[number];

export function statusClass(status: string): string {
  switch (status) {
    case 'draft':
      return 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30';
    case 'translated':
      return 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30';
    case 'verified':
      return 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30';
    case 'drilling':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
    case 'deployable':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
    default:
      return '';
  }
}
