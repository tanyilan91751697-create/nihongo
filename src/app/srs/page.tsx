'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, RotateCcw } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn, formatInterval } from '@/lib/utils';

type DueCard = {
  id: number;
  card_type: 'recognition' | 'production';
  front: string;
  back: string;
  reading: string | null;
  context_sentence: string | null;
  context_translation: string | null;
  audio_path: string | null;
  source: string;
  source_id: number | null;
  source_label: string | null;
  stage: string;
  reps: number;
  lapses: number;
  intervals: Record<string, { due: string; days: number }>;
};

type Stats = {
  byStage: { stage: string; n: number }[];
  bySource: { source: string; n: number }[];
  due: number;
  total: number;
  mature: number;
  daily: { day: string; n: number }[];
  upcoming: { day: string; n: number }[];
};

const RATINGS = [
  { value: 1, label: 'Again', hint: 'forgot it', className: 'bg-rose-600 hover:bg-rose-600/90 text-white' },
  { value: 2, label: 'Hard', hint: 'slow, with effort', className: 'bg-amber-600 hover:bg-amber-600/90 text-white' },
  { value: 3, label: 'Good', hint: 'recalled it', className: 'bg-emerald-600 hover:bg-emerald-600/90 text-white' },
  { value: 4, label: 'Easy', hint: 'instant', className: 'bg-sky-600 hover:bg-sky-600/90 text-white' },
] as const;

/** Where a card came from, as a link back to the source when there is one. */
function SourceLink({ card }: { card: DueCard }) {
  const label = card.source_label ?? card.source;
  if (card.source === 'reader' && card.source_id) {
    return (
      <Link href={`/reader?text=${card.source_id}`} className="hover:text-primary">
        From: {label}
      </Link>
    );
  }
  if (card.source === 'island' && card.source_id) {
    return (
      <Link href={`/islands/${card.source_id}`} className="hover:text-primary">
        From: {label}
      </Link>
    );
  }
  if (card.source === 'error_log') {
    return (
      <Link href="/errors" className="hover:text-primary">
        From: Error Log
      </Link>
    );
  }
  return <span>From: {label}</span>;
}

export default function SrsPage() {
  const [queue, setQueue] = useState<DueCard[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reviewed, setReviewed] = useState(0);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [shownAt, setShownAt] = useState<number>(Date.now());

  const card = queue[0] ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    const [dueResponse, statsResponse] = await Promise.all([
      fetch('/api/srs/due?limit=80').then((r) => r.json()),
      fetch('/api/srs/stats').then((r) => r.json()),
    ]);
    setQueue(dueResponse.cards ?? []);
    setStats(statsResponse);
    setRevealed(false);
    setShownAt(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rate = useCallback(
    async (rating: number) => {
      if (!card) return;
      const durationMs = Date.now() - shownAt;
      const response = await fetch('/api/srs/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: card.id, rating, durationMs }),
      });
      const data = await response.json();
      setLastResult(
        data.intervalDays !== undefined
          ? `${card.front} → next in ${formatInterval(data.intervalDays)}`
          : null,
      );
      setQueue((prev) => prev.slice(1));
      setRevealed(false);
      setReviewed((n) => n + 1);
      setShownAt(Date.now());
      // Refresh the panel every few reviews rather than on every rating.
      if ((reviewed + 1) % 5 === 0) {
        fetch('/api/srs/stats')
          .then((r) => r.json())
          .then(setStats);
      }
    },
    [card, reviewed, shownAt],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (!card) return;
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (!revealed) setRevealed(true);
        else void rate(3);
        return;
      }
      if (revealed && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        void rate(Number(event.key));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, revealed, rate]);

  const stageCounts = useMemo(() => {
    const map: Record<string, number> = { new: 0, learning: 0, review: 0, relearning: 0 };
    for (const row of stats?.byStage ?? []) map[row.stage] = row.n;
    return map;
  }, [stats]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Contextual SRS</h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? 'Loading the queue…'
              : queue.length
                ? `${queue.length} cards due for review${reviewed ? ` · ${reviewed} done this session` : ''}`
                : reviewed
                  ? `Queue cleared — ${reviewed} reviews done. Well played.`
                  : 'Nothing due right now.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ManualCardDialog onCreated={load} />
          <Button variant="outline" size="sm" onClick={load}>
            <RotateCcw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section>
          {card ? (
            <div className="rounded-lg border border-border bg-card p-8">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Badge>{card.card_type}</Badge>
                  <Badge>{card.stage}</Badge>
                  {card.lapses ? <Badge>{card.lapses} lapses</Badge> : null}
                </div>
                <SourceLink card={card} />
              </div>

              <div className="min-h-[10rem] text-center">
                {card.card_type === 'recognition' ? (
                  <p className="jp-display font-semibold">{card.front}</p>
                ) : (
                  <div>
                    <p className="text-2xl font-medium">{card.front}</p>
                    {card.context_sentence ? (
                      <p className="mt-3 text-sm text-muted-foreground">Hint: {card.context_sentence}</p>
                    ) : null}
                    <p className="mt-4 text-sm text-muted-foreground">Say it aloud in Japanese, then reveal.</p>
                  </div>
                )}

                {revealed ? (
                  <div className="mt-6 space-y-3 border-t border-border pt-6">
                    {card.card_type === 'recognition' ? (
                      <>
                        {card.reading ? <p className="jp text-xl text-muted-foreground">{card.reading}</p> : null}
                        <p className="text-lg">{card.back}</p>
                      </>
                    ) : (
                      <>
                        <p className="jp-display">{card.back}</p>
                        {card.reading ? <p className="jp text-muted-foreground">{card.reading}</p> : null}
                      </>
                    )}
                    {card.context_sentence && card.card_type === 'recognition' ? (
                      <div className="mx-auto max-w-xl rounded-md bg-muted/50 p-3 text-left">
                        <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                          Where you met it
                        </p>
                        <p className="jp text-base">{card.context_sentence}</p>
                        {card.context_translation ? (
                          <p className="text-xs text-muted-foreground">{card.context_translation}</p>
                        ) : null}
                      </div>
                    ) : null}
                    {card.audio_path ? (
                      <audio controls src={`/api/studio/audio?path=${encodeURIComponent(card.audio_path)}`} className="mx-auto" />
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="mt-8">
                {!revealed ? (
                  <Button size="lg" className="w-full" onClick={() => setRevealed(true)}>
                    Show answer <span className="ml-2 text-xs opacity-70">space</span>
                  </Button>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {RATINGS.map((rating) => {
                      const preview = card.intervals?.[String(rating.value)];
                      return (
                        <button
                          key={rating.value}
                          type="button"
                          onClick={() => rate(rating.value)}
                          className={cn(
                            'rounded-md px-3 py-3 text-sm font-medium transition-colors',
                            rating.className,
                          )}
                        >
                          <span className="block">{rating.label}</span>
                          <span className="block text-xs opacity-80">
                            {preview ? formatInterval(preview.days) : rating.hint}
                          </span>
                          <span className="block text-[10px] opacity-60">{rating.value}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-12 text-center">
              <p className="mb-2 text-sm text-muted-foreground">
                {loading ? 'Loading…' : 'No cards are due. Add words from the Reader, or create one by hand.'}
              </p>
              {lastResult ? <p className="text-xs text-muted-foreground">Last: {lastResult}</p> : null}
            </div>
          )}

          {lastResult && card ? <p className="mt-3 text-center text-xs text-muted-foreground">{lastResult}</p> : null}
        </section>

        <aside className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Queue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Due now</span>
                <span className="font-medium">{stats?.due ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total cards</span>
                <span>{stats?.total ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mature (21d+)</span>
                <span>{stats?.mature ?? 0}</span>
              </div>
              <div className="mt-3 space-y-1 border-t border-border pt-3">
                {(['new', 'learning', 'review', 'relearning'] as const).map((stage) => (
                  <div key={stage} className="flex justify-between text-xs">
                    <span className="capitalize text-muted-foreground">{stage}</span>
                    <span>{stageCounts[stage] ?? 0}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>By source</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs">
              {stats?.bySource.length ? (
                stats.bySource.map((row) => (
                  <div key={row.source} className="flex justify-between">
                    <span className="capitalize text-muted-foreground">{row.source.replace('_', ' ')}</span>
                    <span>{row.n}</span>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">No cards yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Reviews, last 30 days</CardTitle>
            </CardHeader>
            <CardContent className="h-40 px-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats?.daily ?? []}>
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
                  <Bar dataKey="n" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Upcoming 14 days</CardTitle>
            </CardHeader>
            <CardContent className="h-32 px-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats?.upcoming ?? []}>
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
                  <Bar dataKey="n" fill="hsl(var(--level-n3))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function ManualCardDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [front, setFront] = useState('');
  const [reading, setReading] = useState('');
  const [back, setBack] = useState('');
  const [context, setContext] = useState('');
  const [cardType, setCardType] = useState<'recognition' | 'production'>('recognition');

  async function submit() {
    if (!front.trim() || !back.trim()) return;
    setBusy(true);
    await fetch('/api/srs/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_type: cardType,
        front: cardType === 'recognition' ? front : back,
        back: cardType === 'recognition' ? back : front,
        reading: reading || null,
        context_sentence: context || null,
        source: 'manual',
        source_label: 'Manual entry',
      }),
    });
    setBusy(false);
    setFront('');
    setBack('');
    setReading('');
    setContext('');
    setOpen(false);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" /> New card
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a card by hand</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={cardType} onChange={(event) => setCardType(event.target.value as 'recognition' | 'production')}>
            <option value="recognition">Recognition (Japanese → meaning)</option>
            <option value="production">Production (meaning → Japanese)</option>
          </Select>
          <Input className="jp" placeholder="Japanese" value={front} onChange={(e) => setFront(e.target.value)} />
          <Input className="jp" placeholder="Reading (optional)" value={reading} onChange={(e) => setReading(e.target.value)} />
          <Input placeholder="Meaning" value={back} onChange={(e) => setBack(e.target.value)} />
          <Textarea
            className="jp"
            placeholder="Context sentence (optional)"
            value={context}
            onChange={(e) => setContext(e.target.value)}
          />
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create card
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
