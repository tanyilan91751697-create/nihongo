'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Mic, Square } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select, Textarea } from '@/components/ui/input';
import { FourThreeTwo } from '@/components/studio/four-three-two';
import { formatClock, useRecorder } from '@/components/studio/recorder';
import { formatDateTime } from '@/lib/utils';

type Session = {
  id: number;
  session_type: string;
  topic: string | null;
  material_title: string | null;
  ipom_stage: string | null;
  reps: number | null;
  duration_sec: number;
  notes: string | null;
  transcript: string | null;
  created_at: string;
  recording_count: number;
  avg_wpm: number | null;
  island_id: number | null;
  text_id: number | null;
};

export default function StudioPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetch('/api/studio/sessions').then((r) => r.json());
    setSessions(data.sessions ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-lg font-semibold">Oral Studio</h1>
        <p className="text-sm text-muted-foreground">
          Fluency drills, shadowing logs and free speaking — recorded locally, never uploaded anywhere.
        </p>
      </header>

      <Tabs defaultValue="432">
        <TabsList>
          <TabsTrigger value="432">4/3/2 session</TabsTrigger>
          <TabsTrigger value="shadowing">Shadowing log</TabsTrigger>
          <TabsTrigger value="free">Free speaking</TabsTrigger>
          <TabsTrigger value="history">Session history</TabsTrigger>
        </TabsList>

        <TabsContent value="432">
          <FourThreeTwo onSaved={load} />
        </TabsContent>

        <TabsContent value="shadowing">
          <ShadowingLog sessions={sessions.filter((s) => s.session_type === 'shadowing')} onSaved={load} />
        </TabsContent>

        <TabsContent value="free">
          <FreeSpeaking onSaved={load} />
        </TabsContent>

        <TabsContent value="history">
          <SessionHistory sessions={sessions} loading={loading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ShadowingLog({ sessions, onSaved }: { sessions: Session[]; onSaved: () => void }) {
  const [material, setMaterial] = useState('');
  const [stage, setStage] = useState('scripted');
  const [reps, setReps] = useState('');
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [textId, setTextId] = useState('');
  const [texts, setTexts] = useState<{ id: number; title: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/reader/texts')
      .then((r) => r.json())
      .then((data) => setTexts(data.texts ?? []));
  }, []);

  async function submit() {
    if (!material.trim()) return;
    setBusy(true);
    await fetch('/api/studio/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_type: 'shadowing',
        material_title: material,
        ipom_stage: stage,
        reps: reps ? Number(reps) : null,
        duration_sec: duration ? Number(duration) * 60 : 0,
        notes,
        text_id: textId ? Number(textId) : null,
      }),
    });
    setBusy(false);
    setMaterial('');
    setReps('');
    setDuration('');
    setNotes('');
    onSaved();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[24rem_minmax(0,1fr)]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Log a shadowing session</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Material title" value={material} onChange={(e) => setMaterial(e.target.value)} />
          <Select value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="scripted">IPOM — scripted</option>
            <option value="prosodic">IPOM — prosodic</option>
            <option value="content">IPOM — content</option>
          </Select>
          <div className="flex gap-3">
            <Input placeholder="Reps" inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} />
            <Input
              placeholder="Minutes"
              inputMode="numeric"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
          <Select value={textId} onChange={(e) => setTextId(e.target.value)}>
            <option value="">Link to a text in the Reader (optional)</option>
            {texts.map((text) => (
              <option key={text.id} value={text.id}>
                {text.title}
              </option>
            ))}
          </Select>
          <Textarea placeholder="Notes — what was hard, what improved…" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button onClick={submit} disabled={busy || !material.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Log session
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {sessions.map((session) => (
          <div key={session.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{session.material_title}</span>
              <span className="text-xs text-muted-foreground">{formatDateTime(session.created_at)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {session.ipom_stage ? <Badge>{session.ipom_stage}</Badge> : null}
              {session.reps ? <Badge>{session.reps} reps</Badge> : null}
              {session.duration_sec ? <Badge>{Math.round(session.duration_sec / 60)} min</Badge> : null}
              {session.text_id ? (
                <Link href={`/reader?text=${session.text_id}`} className="text-primary hover:underline">
                  open text
                </Link>
              ) : null}
            </div>
            {session.notes ? <p className="mt-2 text-sm text-muted-foreground">{session.notes}</p> : null}
          </div>
        ))}
        {!sessions.length ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No shadowing sessions logged yet.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function FreeSpeaking({ onSaved }: { onSaved: () => void }) {
  const [topic, setTopic] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const recorder = useRecorder(async (blob, duration) => {
    const response = await fetch('/api/studio/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_type: 'free',
        topic: topic || 'Free speaking',
        duration_sec: Math.round(duration),
      }),
    });
    const data = await response.json();
    const id = data.session.id as number;
    setSessionId(id);

    const form = new FormData();
    form.append('file', blob, 'free.webm');
    form.append('sessionId', String(id));
    form.append('phase', '1');
    form.append('kind', 'free');
    form.append('topic', topic || 'free');
    form.append('duration', String(Math.round(duration)));
    await fetch('/api/studio/recordings', { method: 'POST', body: form });
    setSaved(`Saved as session #${id} (${formatClock(duration)})`);
    onSaved();
  });

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  return (
    <Card className="mx-auto max-w-xl">
      <CardContent className="space-y-4 pt-6 text-center">
        <Input
          placeholder="Topic label"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          className="mx-auto max-w-sm"
        />
        <p className="font-mono text-5xl tabular-nums">{formatClock(elapsed)}</p>
        {recorder.error ? <p className="text-sm text-destructive">{recorder.error}</p> : null}
        {running ? (
          <Button
            size="lg"
            variant="destructive"
            onClick={() => {
              setRunning(false);
              recorder.stop();
            }}
          >
            <Square className="h-4 w-4" /> Stop
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={async () => {
              setSaved(null);
              setElapsed(0);
              setSessionId(null);
              await recorder.start();
              setRunning(true);
            }}
          >
            <Mic className="h-4 w-4" /> Start recording
          </Button>
        )}
        {saved ? <p className="text-sm text-emerald-400">{saved}</p> : null}
        {sessionId ? <p className="text-xs text-muted-foreground">session #{sessionId}</p> : null}
      </CardContent>
    </Card>
  );
}

function SessionHistory({ sessions, loading }: { sessions: Session[]; loading: boolean }) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!sessions.length) {
    return (
      <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No sessions yet. Record a 4/3/2 set or log some shadowing to fill this in.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {sessions.map((session) => (
        <div key={session.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge>{session.session_type === '432' ? '4/3/2' : session.session_type}</Badge>
              <span className="font-medium">{session.topic ?? session.material_title ?? 'Untitled'}</span>
            </div>
            <span className="text-xs text-muted-foreground">{formatDateTime(session.created_at)}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {session.duration_sec ? <span>{Math.round(session.duration_sec / 60)} min</span> : null}
            {session.recording_count ? <span>{session.recording_count} recordings</span> : null}
            {session.avg_wpm ? <span>{session.avg_wpm} WPM average</span> : null}
            {session.transcript ? <span>transcript saved</span> : null}
            {session.island_id ? (
              <Link href={`/islands/${session.island_id}`} className="text-primary hover:underline">
                island
              </Link>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
