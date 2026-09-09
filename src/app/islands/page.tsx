'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn, formatDate, relativeDays } from '@/lib/utils';
import { STATUSES, statusClass } from '@/lib/islands';

type Island = {
  id: number;
  topic: string;
  status: 'draft' | 'translated' | 'verified' | 'drilling' | 'deployable';
  register: 'teineigo' | 'tameguchi';
  last_practiced_at: string | null;
  created_at: string;
  chunk_count: number;
  tool_count: number;
  session_count: number;
};

export default function IslandsPage() {
  const [islands, setIslands] = useState<Island[]>([]);
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<'created' | 'practiced'>('created');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ status, sort });
    const data = await fetch(`/api/islands?${params}`).then((r) => r.json());
    setIslands(data.islands ?? []);
    setLoading(false);
  }, [status, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Island Workshop</h1>
          <p className="text-sm text-muted-foreground">
            Rehearsed set-pieces, carried from a first draft through verification to something you can deploy.
          </p>
        </div>
        <NewIslandDialog onCreated={load} />
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button
          variant={status === 'all' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setStatus('all')}
        >
          All
        </Button>
        {STATUSES.map((s) => (
          <Button key={s} variant={status === s ? 'secondary' : 'ghost'} size="sm" onClick={() => setStatus(s)}>
            {s}
          </Button>
        ))}
        <Select
          value={sort}
          onChange={(event) => setSort(event.target.value as 'created' | 'practiced')}
          className="ml-auto w-48"
        >
          <option value="created">Newest first</option>
          <option value="practiced">Last practised</option>
        </Select>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {islands.map((island) => {
          const stale = relativeDays(island.last_practiced_at);
          return (
            <Link
              key={island.id}
              href={`/islands/${island.id}`}
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/60"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <h2 className="font-medium">{island.topic}</h2>
                <Badge className={cn('shrink-0', statusClass(island.status))}>{island.status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {island.register === 'teineigo' ? 'です・ます' : 'plain form'} · {island.chunk_count} chunks ·{' '}
                {island.tool_count} tools
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {island.last_practiced_at
                  ? `Practised ${formatDate(island.last_practiced_at)}${stale !== null && stale >= 14 ? ` — ${stale} days ago` : ''}`
                  : 'Never practised'}
              </p>
              {stale !== null && stale >= 14 ? (
                <p className="mt-2 text-xs text-amber-400">Stale — worth another run.</p>
              ) : null}
            </Link>
          );
        })}
      </div>

      {!loading && !islands.length ? (
        <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No islands yet. Start one with the script you keep needing and never quite have ready.
        </p>
      ) : null}
    </div>
  );
}

function NewIslandDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('');
  const [register, setRegister] = useState('teineigo');
  const [script, setScript] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!topic.trim()) return;
    setBusy(true);
    await fetch('/api/islands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, register, l1_script: script }),
    });
    setBusy(false);
    setTopic('');
    setScript('');
    setOpen(false);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" /> New island
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New island</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Topic — e.g. explaining what I do for work"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          />
          <Select value={register} onChange={(event) => setRegister(event.target.value)}>
            <option value="teineigo">丁寧語 — polite</option>
            <option value="tameguchi">タメ口 — casual</option>
          </Select>
          <Textarea
            placeholder="First draft in your own language…"
            value={script}
            onChange={(event) => setScript(event.target.value)}
            className="min-h-[140px]"
          />
          <Button onClick={submit} disabled={busy || !topic.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create island
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
