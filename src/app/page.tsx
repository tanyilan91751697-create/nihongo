'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Flame, TrendingUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatDate, formatDateTime, levelBadgeClass, relativeDays } from '@/lib/utils';
import { statusClass } from '@/lib/islands';

type Dashboard = {
  streak: { current: number; longest: number; lastActive: string | null };
  suggestion: { due: number; suggested: string; neglectedStrand: string };
  coverage: {
    vocabByLevel: { level: string; total: number }[];
    studied: { level: string; status: string; n: number }[];
    grammarByLevel: { level: string; total: number }[];
    grammarSeen: { level: string; n: number }[];
    chunkTotal: number;
    chunkFromIslands: number;
  };
  fluency: {
    wpm: { day: string; wpm: number; samples: number }[];
    byPhase: { phase: number; wpm: number; pauses: number; samples: number }[];
    sessions: number;
    speakingMinutes: number;
  };
  strands: {
    byStrand: { strand: string; minutes: number; events: number; share: number }[];
    totalMinutes: number;
    underweight: string[];
  };
  islands: {
    byStatus: { status: string; n: number }[];
    stale: { id: number; topic: string; status: string; last_practiced_at: string | null }[];
  };
  errors: { byCategory: { category: string; n: number }[]; overTime: { day: string; n: number }[] };
  timeline: {
    id: number;
    activity: string;
    strand: string | null;
    detail: string | null;
    minutes: number;
    created_at: string;
  }[];
  trajectory: {
    learnedPerDay: number;
    projections: { level: string; total: number; covered: number; remaining: number; weeks: number | null }[];
  };
};

const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const;

const STRAND_LABEL: Record<string, string> = {
  input: 'Meaning-focused input',
  output: 'Meaning-focused output',
  language_focused: 'Language-focused learning',
  fluency: 'Fluency development',
};

const STRAND_COLOR: Record<string, string> = {
  input: 'hsl(var(--level-n3))',
  output: 'hsl(var(--level-n4))',
  language_focused: 'hsl(var(--level-n2))',
  fluency: 'hsl(var(--primary))',
};

const CHART_TOOLTIP = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  fontSize: 12,
};

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(new Error(d.error)))))
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="p-8">
        <h1 className="mb-2 text-lg font-semibold">Nihongo Hub</h1>
        <p className="text-sm text-destructive">{error}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          If the database is missing, run <code className="rounded bg-muted px-1">npm run setup</code> first.
        </p>
      </div>
    );
  }
  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading the dashboard…</div>;

  const coverageRows = LEVELS.map((level) => {
    const total = data.coverage.vocabByLevel.find((r) => r.level === level)?.total ?? 0;
    const known = data.coverage.studied
      .filter((r) => r.level === level && r.status === 'known')
      .reduce((s, r) => s + r.n, 0);
    const learning = data.coverage.studied
      .filter((r) => r.level === level && r.status === 'learning')
      .reduce((s, r) => s + r.n, 0);
    const encountered = data.coverage.studied
      .filter((r) => r.level === level && r.status === 'encountered')
      .reduce((s, r) => s + r.n, 0);
    return { level, total, known, learning, encountered };
  });

  const grammarRows = LEVELS.map((level) => ({
    level,
    total: data.coverage.grammarByLevel.find((r) => r.level === level)?.total ?? 0,
    seen: data.coverage.grammarSeen.find((r) => r.level === level)?.n ?? 0,
  }));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Progress</h1>
          <p className="text-sm text-muted-foreground">
            {data.streak.lastActive ? `Last active ${formatDate(data.streak.lastActive)}` : 'No activity recorded yet'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="gap-1">
            <Flame className="h-3 w-3" /> {data.streak.current} day streak
          </Badge>
          <Badge>longest {data.streak.longest}</Badge>
        </div>
      </header>

      {/* Today */}
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <div>
            <p className="text-sm text-muted-foreground">Today</p>
            <p className="text-2xl font-semibold">
              {data.suggestion.due} card{data.suggestion.due === 1 ? '' : 's'} due
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Suggested next: {data.suggestion.suggested}
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/srs">
                Review <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/reader">Read</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/studio">Speak</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {data.strands.underweight.length && data.strands.totalMinutes > 0 ? (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p>
            <span className="font-medium text-amber-300">Four Strands are out of balance.</span>{' '}
            {data.strands.underweight.map((s) => STRAND_LABEL[s] ?? s).join(' and ')}{' '}
            {data.strands.underweight.length === 1 ? 'is' : 'are'} under 15% of this week&apos;s study time.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Knowledge coverage — vocabulary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {coverageRows.map((row) => {
              const met = row.known + row.learning + row.encountered;
              return (
                <div key={row.level}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <Badge className={levelBadgeClass(row.level)}>{row.level}</Badge>
                    <span className="text-muted-foreground">
                      {met} met of {row.total} ({row.total ? Math.round((met / row.total) * 100) : 0}%)
                    </span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                    <div className="bg-emerald-500" style={{ width: `${(row.known / (row.total || 1)) * 100}%` }} />
                    <div className="bg-sky-500" style={{ width: `${(row.learning / (row.total || 1)) * 100}%` }} />
                    <div
                      className="bg-muted-foreground/50"
                      style={{ width: `${(row.encountered / (row.total || 1)) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <p className="pt-1 text-xs text-muted-foreground">
              <span className="mr-3">
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />
                known
              </span>
              <span className="mr-3">
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500" />
                learning
              </span>
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-muted-foreground/50" />
                encountered
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Chunk bank: {data.coverage.chunkTotal} chunks ({data.coverage.chunkFromIslands} from islands)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Knowledge coverage — grammar</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grammarRows} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="level" tick={{ fontSize: 11 }} width={30} />
                <RechartsTooltip contentStyle={CHART_TOOLTIP} />
                <Bar dataKey="total" fill="hsl(var(--muted))" radius={[0, 3, 3, 0]} name="points" />
                <Bar dataKey="seen" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} name="met in texts" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Fluency — WPM trend</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            {data.fluency.wpm.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.fluency.wpm}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} width={30} />
                  <RechartsTooltip contentStyle={CHART_TOOLTIP} />
                  <Line type="monotone" dataKey="wpm" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Record a 4/3/2 set and enter WPM in the self-audit to start this chart.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Four Strands, last 7 days</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            {data.strands.totalMinutes ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.strands.byStrand}
                    dataKey="minutes"
                    nameKey="strand"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                  >
                    {data.strands.byStrand.map((entry) => (
                      <Cell key={entry.strand} fill={STRAND_COLOR[entry.strand]} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={CHART_TOOLTIP}
                    formatter={(value: number, name: string) => [`${value} min`, STRAND_LABEL[name] ?? name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
                No study time logged this week yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Island portfolio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {data.islands.byStatus.length ? (
                data.islands.byStatus.map((row) => (
                  <Badge key={row.status} className={statusClass(row.status)}>
                    {row.status} · {row.n}
                  </Badge>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No islands yet.</p>
              )}
            </div>
            {data.islands.stale.length ? (
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-amber-400">
                  Stale — not practised in 14 days
                </p>
                <ul className="space-y-1">
                  {data.islands.stale.map((island) => (
                    <li key={island.id} className="text-sm">
                      <Link href={`/islands/${island.id}`} className="hover:text-primary">
                        {island.topic}
                      </Link>{' '}
                      <span className="text-xs text-muted-foreground">
                        {island.last_practiced_at
                          ? `${relativeDays(island.last_practiced_at)} days ago`
                          : 'never practised'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Error trends, last 30 days</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.errors.overTime}>
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} width={24} allowDecimals={false} />
                  <RechartsTooltip contentStyle={CHART_TOOLTIP} />
                  <Bar dataKey="n" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-2">
              {data.errors.byCategory.map((row) => (
                <Badge key={row.category}>
                  {row.category.replace('_', ' ')} · {row.n}
                </Badge>
              ))}
              {!data.errors.byCategory.length ? (
                <p className="text-xs text-muted-foreground">No errors logged in the last 30 days.</p>
              ) : null}
            </div>
            <Button variant="ghost" size="sm" asChild className="-ml-3">
              <Link href="/errors">
                Open the error log <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Trajectory</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {data.trajectory.learnedPerDay > 0
                ? `Adding ${data.trajectory.learnedPerDay} words a day over the last 30 days.`
                : 'No new words marked as learning or known in the last 30 days — the projection needs a pace to work from.'}
            </p>
            <ul className="space-y-1 text-sm">
              {data.trajectory.projections.map((row) => (
                <li key={row.level} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Badge className={levelBadgeClass(row.level)}>{row.level}</Badge>
                    <span className="text-muted-foreground">
                      {row.covered}/{row.total}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {row.weeks === null
                      ? '—'
                      : row.weeks === 0
                        ? 'covered'
                        : `~${row.weeks} weeks at this pace`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3" /> Straight-line projection from the last 30 days.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle>Activity, last 7 days</CardTitle>
          </CardHeader>
          <CardContent>
            {data.timeline.length ? (
              <ul className="space-y-2">
                {data.timeline.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 border-b border-border pb-2 text-sm last:border-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn('h-2 w-2 shrink-0 rounded-full')}
                        style={{ background: STRAND_COLOR[row.strand ?? ''] ?? 'hsl(var(--muted-foreground))' }}
                      />
                      <span className="truncate">
                        {row.activity.replace(/_/g, ' ')}
                        {row.detail ? <span className="text-muted-foreground"> — {row.detail}</span> : null}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {row.minutes ? `${Math.round(row.minutes)} min · ` : ''}
                      {formatDateTime(row.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing logged in the last week.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        {data.fluency.sessions} speaking sessions and {data.fluency.speakingMinutes} minutes of speech in the last 30
        days.
      </p>
    </div>
  );
}
