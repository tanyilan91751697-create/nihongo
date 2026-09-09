'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Zap } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { cn, formatDate } from '@/lib/utils';

type ErrorRow = {
  id: number;
  occurred_at: string;
  source_activity: string;
  attempted: string;
  error_text: string | null;
  corrected: string;
  category: string;
  notes: string | null;
  srs_card_id: number | null;
  grammar_pattern: string | null;
};

type Patterns = {
  byCategory: { category: string; n: number }[];
  overTime: { day: string; category: string; n: number }[];
  patterns: { key: string; label: string; category: string; count: number; ids: number[] }[];
  top: { key: string; label: string; count: number; ids: number[] }[];
  weekly: ErrorRow[];
  total: number;
};

const CATEGORIES = ['particle', 'conjugation', 'register', 'word_choice', 'pitch', 'other'] as const;

const CATEGORY_COLOR: Record<string, string> = {
  particle: 'hsl(var(--level-n3))',
  conjugation: 'hsl(var(--level-n4))',
  register: 'hsl(var(--level-n2))',
  word_choice: 'hsl(var(--level-n1))',
  pitch: 'hsl(var(--level-unknown))',
  other: 'hsl(var(--muted-foreground))',
};

export default function ErrorsPage() {
  const [errors, setErrors] = useState<ErrorRow[]>([]);
  const [patterns, setPatterns] = useState<Patterns | null>(null);
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [drilling, setDrilling] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (category !== 'all') params.set('category', category);
    const [errorData, patternData] = await Promise.all([
      fetch(`/api/errors?${params}`).then((r) => r.json()),
      fetch('/api/errors/patterns?days=14').then((r) => r.json()),
    ]);
    setErrors(errorData.errors ?? []);
    setPatterns(patternData);
    setLoading(false);
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createDrill(pattern: { key: string; label: string; ids: number[] }) {
    setDrilling(pattern.key);
    const response = await fetch('/api/errors/patterns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: pattern.ids, label: pattern.label }),
    });
    const data = await response.json();
    setDrilling(null);
    setMessage(`${data.created} drill cards created for ${pattern.label}.`);
    void load();
    setTimeout(() => setMessage(null), 4000);
  }

  // Recharts wants one row per day with a column per category.
  const timeSeries = (() => {
    const byDay = new Map<string, Record<string, number | string>>();
    for (const row of patterns?.overTime ?? []) {
      const existing = byDay.get(row.day) ?? { day: row.day };
      existing[row.category] = row.n;
      byDay.set(row.day, existing);
    }
    return [...byDay.values()];
  })();

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-lg font-semibold">Error Log</h1>
        <p className="text-sm text-muted-foreground">
          {patterns?.total ?? 0} errors recorded — the point is the pattern, not the individual slip.
        </p>
      </header>

      <QuickAddError onCreated={load} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button variant={category === 'all' ? 'secondary' : 'ghost'} size="sm" onClick={() => setCategory('all')}>
              All
            </Button>
            {CATEGORIES.map((c) => (
              <Button key={c} variant={category === c ? 'secondary' : 'ghost'} size="sm" onClick={() => setCategory(c)}>
                {c.replace('_', ' ')}
              </Button>
            ))}
          </div>

          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {message ? <p className="mb-3 text-sm text-emerald-400">{message}</p> : null}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">Date</th>
                  <th className="p-2 font-medium">Source</th>
                  <th className="p-2 font-medium">What I tried</th>
                  <th className="p-2 font-medium">Corrected</th>
                  <th className="p-2 font-medium">Category</th>
                  <th className="p-2 font-medium">Card</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {errors.map((row) => (
                  <tr key={row.id} className="border-t border-border align-top">
                    <td className="whitespace-nowrap p-2 text-xs text-muted-foreground">
                      {formatDate(row.occurred_at)}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">{row.source_activity}</td>
                    <td className="jp max-w-[16rem] p-2 text-base text-destructive">{row.attempted}</td>
                    <td className="jp max-w-[16rem] p-2 text-base text-emerald-400">{row.corrected}</td>
                    <td className="p-2">
                      <Badge>{row.category.replace('_', ' ')}</Badge>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">{row.srs_card_id ? `#${row.srs_card_id}` : '—'}</td>
                    <td className="p-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={async () => {
                          await fetch(`/api/errors?id=${row.id}`, { method: 'DELETE' });
                          void load();
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !errors.length ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                No errors logged yet. They arrive from the Oral Studio self-audit, island verification, or the quick-add
                modal.
              </p>
            ) : null}
          </div>
        </section>

        <aside className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>By category</CardTitle>
            </CardHeader>
            <CardContent className="h-52">
              {patterns?.byCategory.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={patterns.byCategory}
                      dataKey="n"
                      nameKey="category"
                      innerRadius={35}
                      outerRadius={65}
                      paddingAngle={2}
                    >
                      {patterns.byCategory.map((entry) => (
                        <Cell key={entry.category} fill={CATEGORY_COLOR[entry.category] ?? 'hsl(var(--primary))'} />
                      ))}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <RechartsTooltip
                      contentStyle={{
                        background: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="pt-8 text-center text-xs text-muted-foreground">Nothing to chart yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Top patterns, last 14 days</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {patterns?.top.length ? (
                patterns.top.map((pattern) => (
                  <div key={pattern.key} className="rounded-md border border-border p-3">
                    <p className="jp text-base">{pattern.label}</p>
                    <p className="mb-2 text-xs text-muted-foreground">
                      {pattern.count} occurrence{pattern.count === 1 ? '' : 's'} in the last 14 days
                    </p>
                    <Button size="sm" variant="outline" onClick={() => createDrill(pattern)} disabled={drilling === pattern.key}>
                      {drilling === pattern.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                      Create micro-drill
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">
                  No repeated patterns yet — log a few corrections and they will surface here.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Errors over time</CardTitle>
            </CardHeader>
            <CardContent className="h-40 px-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} width={24} allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  {CATEGORIES.map((c) => (
                    <Bar key={c} dataKey={c} stackId="a" fill={CATEGORY_COLOR[c]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Weekly audit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {patterns?.weekly.length ? (
                CATEGORIES.map((c) => {
                  const rows = patterns.weekly.filter((row) => row.category === c);
                  if (!rows.length) return null;
                  return (
                    <details key={c} className="rounded border border-border p-2">
                      <summary className="cursor-pointer text-xs">
                        <span className="capitalize">{c.replace('_', ' ')}</span>{' '}
                        <span className="text-muted-foreground">({rows.length})</span>
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {rows.map((row) => (
                          <li key={row.id} className="text-xs">
                            <span className={cn('jp text-sm text-destructive line-through')}>{row.attempted}</span>{' '}
                            <span className="jp text-sm text-emerald-400">{row.corrected}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  );
                })
              ) : (
                <p className="text-xs text-muted-foreground">Nothing logged in the last seven days.</p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function QuickAddError({ onCreated }: { onCreated: () => void }) {
  const [attempted, setAttempted] = useState('');
  const [corrected, setCorrected] = useState('');
  const [category, setCategory] = useState('particle');
  const [source, setSource] = useState('manual');
  const [notes, setNotes] = useState('');
  const [makeCard, setMakeCard] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!attempted.trim() || !corrected.trim()) return;
    setBusy(true);
    await fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attempted,
        corrected,
        category,
        source_activity: source,
        notes,
        createCard: makeCard,
      }),
    });
    setBusy(false);
    setAttempted('');
    setCorrected('');
    setNotes('');
    onCreated();
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Quick add</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2">
          <Textarea
            className="jp"
            placeholder="What I tried to say…"
            value={attempted}
            onChange={(event) => setAttempted(event.target.value)}
          />
          <Textarea
            className="jp"
            placeholder="The corrected version…"
            value={corrected}
            onChange={(event) => setCorrected(event.target.value)}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Select value={category} onChange={(event) => setCategory(event.target.value)} className="w-44">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace('_', ' ')}
              </option>
            ))}
          </Select>
          <Select value={source} onChange={(event) => setSource(event.target.value)} className="w-44">
            <option value="manual">manual</option>
            <option value="432">4/3/2</option>
            <option value="shadowing">shadowing</option>
            <option value="free">free speaking</option>
            <option value="island">island</option>
            <option value="reader">reader</option>
          </Select>
          <Input
            placeholder="Notes (optional)"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="min-w-[12rem] flex-1"
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={makeCard} onChange={(event) => setMakeCard(event.target.checked)} />
            create an SRS card
          </label>
          <Button onClick={submit} disabled={busy || !attempted.trim() || !corrected.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Log error
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
