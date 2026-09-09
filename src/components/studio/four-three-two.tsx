'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { formatClock, useRecorder } from './recorder';
import { cn, levelBadgeClass } from '@/lib/utils';

/**
 * The 4/3/2 fluency drill: the same talk told three times, in four, three and
 * two minutes. The timer drives the whole thing — when a phase runs out the
 * take is saved automatically, a ten second break runs, and the next phase
 * starts on its own.
 */

const PHASES = [
  { phase: 1, minutes: 4 },
  { phase: 2, minutes: 3 },
  { phase: 3, minutes: 2 },
] as const;

const BREAK_SECONDS = 10;

const TOPICS = [
  'daily_life',
  'work',
  'food',
  'travel',
  'shopping',
  'health',
  'opinions',
  'emotions',
  'technology',
  'formal_situations',
];

type Chunk = { id: number; phrase: string; reading: string | null; meaning: string | null; jlpt_level: string | null };
type Recording = { id: number; phase: number; file_path: string; duration_sec: number };

export function FourThreeTwo({ onSaved }: { onSaved: () => void }) {
  const [topic, setTopic] = useState('');
  const [topicTag, setTopicTag] = useState('daily_life');
  const [plan, setPlan] = useState('');
  const [suggestions, setSuggestions] = useState<Chunk[]>([]);
  const [targetChunks, setTargetChunks] = useState<string[]>([]);

  const [sessionId, setSessionId] = useState<number | null>(null);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [remaining, setRemaining] = useState(PHASES[0].minutes * 60);
  const [running, setRunning] = useState(false);
  const [breakRemaining, setBreakRemaining] = useState(0);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [uploading, setUploading] = useState(false);

  const [transcript, setTranscript] = useState('');
  const [corrections, setCorrections] = useState('');
  const [metrics, setMetrics] = useState<Record<number, { wpm: string; pauses: string }>>({
    1: { wpm: '', pauses: '' },
    2: { wpm: '', pauses: '' },
    3: { wpm: '', pauses: '' },
  });
  const [saveState, setSaveState] = useState<string | null>(null);

  const phase = PHASES[phaseIndex];
  const autoAdvance = useRef(false);

  useEffect(() => {
    fetch(`/api/chunks?topic=${topicTag}&limit=12`)
      .then((r) => r.json())
      .then((data) => setSuggestions(data.chunks ?? []));
  }, [topicTag]);

  const uploadTake = useCallback(
    async (blob: Blob, durationSec: number, forSession: number, forPhase: number) => {
      setUploading(true);
      const form = new FormData();
      form.append('file', blob, `phase${forPhase}.webm`);
      form.append('sessionId', String(forSession));
      form.append('phase', String(forPhase));
      form.append('kind', '432');
      form.append('topic', topic || 'session');
      form.append('duration', String(Math.round(durationSec)));
      const response = await fetch('/api/studio/recordings', { method: 'POST', body: form });
      const data = await response.json();
      if (data.recording) setRecordings((prev) => [...prev.filter((r) => r.phase !== forPhase), data.recording]);
      setUploading(false);
    },
    [topic],
  );

  const phaseRef = useRef({ sessionId, phase: phase.phase });
  phaseRef.current = { sessionId, phase: phase.phase };

  const recorder = useRecorder((blob, duration) => {
    const { sessionId: id, phase: currentPhase } = phaseRef.current;
    if (id) void uploadTake(blob, duration, id, currentPhase);
  });

  /** Create the session row on the first Start so recordings have somewhere to go. */
  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId;
    const response = await fetch('/api/studio/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_type: '432',
        topic: topic || 'Untitled topic',
        plan_notes: plan,
        target_chunks: targetChunks,
        duration_sec: 0,
      }),
    });
    const data = await response.json();
    setSessionId(data.session.id);
    return data.session.id as number;
  }, [sessionId, topic, plan, targetChunks]);

  const startPhase = useCallback(async () => {
    await ensureSession();
    setRemaining(PHASES[phaseIndex].minutes * 60);
    setRunning(true);
    await recorder.start();
  }, [ensureSession, phaseIndex, recorder]);

  const stopPhase = useCallback(
    (advance: boolean) => {
      autoAdvance.current = advance;
      setRunning(false);
      recorder.stop();
      if (advance && phaseIndex < PHASES.length - 1) setBreakRemaining(BREAK_SECONDS);
    },
    [phaseIndex, recorder],
  );

  // Phase countdown: auto-stops the take and queues the break.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          clearInterval(timer);
          stopPhase(true);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [running, stopPhase]);

  // Break countdown between phases, then the next phase starts on its own.
  useEffect(() => {
    if (breakRemaining <= 0) return;
    const timer = setInterval(() => {
      setBreakRemaining((value) => {
        if (value <= 1) {
          clearInterval(timer);
          setPhaseIndex((index) => Math.min(index + 1, PHASES.length - 1));
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [breakRemaining]);

  // Auto-start the next phase once the break has elapsed.
  const previousPhaseIndex = useRef(phaseIndex);
  useEffect(() => {
    if (phaseIndex !== previousPhaseIndex.current) {
      previousPhaseIndex.current = phaseIndex;
      if (autoAdvance.current) {
        autoAdvance.current = false;
        void startPhase();
      }
    }
  }, [phaseIndex, startPhase]);

  const allPhasesRecorded = recordings.length >= 3;

  async function saveAudit() {
    if (!sessionId) return;
    setSaveState('saving');
    const totalDuration = recordings.reduce((sum, r) => sum + r.duration_sec, 0);
    await fetch('/api/studio/sessions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: sessionId,
        topic: topic || 'Untitled topic',
        plan_notes: plan,
        transcript,
        corrections,
        duration_sec: totalDuration,
      }),
    });
    for (const [phaseKey, value] of Object.entries(metrics)) {
      if (!value.wpm && !value.pauses) continue;
      await fetch('/api/studio/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          phase: Number(phaseKey),
          wpm: value.wpm ? Number(value.wpm) : null,
          pause_count: value.pauses ? Number(value.pauses) : null,
          duration_sec: PHASES[Number(phaseKey) - 1].minutes * 60,
        }),
      });
    }
    setSaveState('saved');
    onSaved();
    setTimeout(() => setSaveState(null), 2500);
  }

  function reset() {
    setSessionId(null);
    setPhaseIndex(0);
    setRemaining(PHASES[0].minutes * 60);
    setRecordings([]);
    setTranscript('');
    setCorrections('');
    setMetrics({ 1: { wpm: '', pauses: '' }, 2: { wpm: '', pauses: '' }, 3: { wpm: '', pauses: '' } });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Pre-task planning</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <Input
                placeholder="Topic — what are you going to talk about?"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                className="min-w-[16rem] flex-1"
              />
              <Select value={topicTag} onChange={(event) => setTopicTag(event.target.value)} className="w-52">
                {TOPICS.map((t) => (
                  <option key={t} value={t}>
                    {t.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </div>
            <Textarea
              placeholder="Content points, the shape of the story, chunks you want to land…"
              value={plan}
              onChange={(event) => setPlan(event.target.value)}
              className="min-h-[120px]"
            />
            {targetChunks.length ? (
              <div className="flex flex-wrap gap-2">
                {targetChunks.map((chunk) => (
                  <Badge key={chunk} className="jp">
                    {chunk}
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
                {breakRemaining > 0 ? 'Break' : `Phase ${phase.phase}: ${phase.minutes} minutes`}
              </p>
              <p
                className={cn(
                  'my-4 font-mono text-6xl tabular-nums',
                  running && remaining <= 30 ? 'text-destructive' : '',
                )}
              >
                {breakRemaining > 0 ? formatClock(breakRemaining) : formatClock(remaining)}
              </p>

              <div className="mb-4 flex justify-center gap-2">
                {PHASES.map((p, index) => (
                  <span
                    key={p.phase}
                    className={cn(
                      'h-1.5 w-16 rounded-full',
                      recordings.some((r) => r.phase === p.phase)
                        ? 'bg-emerald-500'
                        : index === phaseIndex
                          ? 'bg-primary'
                          : 'bg-muted',
                    )}
                  />
                ))}
              </div>

              {recorder.error ? <p className="mb-3 text-sm text-destructive">{recorder.error}</p> : null}

              <div className="flex justify-center gap-3">
                {!running ? (
                  <Button size="lg" onClick={startPhase} disabled={breakRemaining > 0}>
                    <Mic className="h-4 w-4" /> Start phase {phase.phase}
                  </Button>
                ) : (
                  <Button size="lg" variant="destructive" onClick={() => stopPhase(true)}>
                    <Square className="h-4 w-4" /> Stop and save
                  </Button>
                )}
                <Button size="lg" variant="ghost" onClick={reset}>
                  New session
                </Button>
              </div>
              {uploading ? (
                <p className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> saving take…
                </p>
              ) : null}
              {sessionId ? (
                <p className="mt-3 text-xs text-muted-foreground">session #{sessionId}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {recordings.length ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Self-audit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {recordings
                  .slice()
                  .sort((a, b) => a.phase - b.phase)
                  .map((recording) => (
                    <div key={recording.id} className="flex flex-wrap items-center gap-3">
                      <Badge>Phase {recording.phase}</Badge>
                      <audio
                        controls
                        className="h-8 flex-1"
                        src={`/api/studio/audio?path=${encodeURIComponent(recording.file_path)}`}
                      />
                      <Input
                        className="w-24"
                        placeholder="WPM"
                        inputMode="numeric"
                        value={metrics[recording.phase]?.wpm ?? ''}
                        onChange={(event) =>
                          setMetrics((prev) => ({
                            ...prev,
                            [recording.phase]: { ...prev[recording.phase], wpm: event.target.value },
                          }))
                        }
                      />
                      <Input
                        className="w-24"
                        placeholder="Pauses"
                        inputMode="numeric"
                        value={metrics[recording.phase]?.pauses ?? ''}
                        onChange={(event) =>
                          setMetrics((prev) => ({
                            ...prev,
                            [recording.phase]: { ...prev[recording.phase], pauses: event.target.value },
                          }))
                        }
                      />
                    </div>
                  ))}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Transcript</p>
                  <Textarea
                    className="jp min-h-[160px]"
                    placeholder="Paste the transcript from Whisper or another tool…"
                    value={transcript}
                    onChange={(event) => setTranscript(event.target.value)}
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Corrections</p>
                  <Textarea
                    className="jp min-h-[160px]"
                    placeholder="Paste the corrected version…"
                    value={corrections}
                    onChange={(event) => setCorrections(event.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={saveAudit} disabled={!sessionId || saveState === 'saving'}>
                  {saveState === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save session
                </Button>
                {saveState === 'saved' ? <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span> : null}
                {allPhasesRecorded ? null : (
                  <span className="text-xs text-muted-foreground">
                    {3 - recordings.length} phase(s) still to record.
                  </span>
                )}
              </div>

              {transcript && corrections ? (
                <ErrorHarvester
                  sessionId={sessionId}
                  transcript={transcript}
                  corrections={corrections}
                  onLogged={onSaved}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Paste both a transcript and its corrections to turn the differences into error-log entries.
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <aside className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Chunks for this topic</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {suggestions.map((chunk) => {
              const selected = targetChunks.includes(chunk.phrase);
              return (
                <button
                  key={chunk.id}
                  type="button"
                  onClick={() =>
                    setTargetChunks((prev) =>
                      selected ? prev.filter((p) => p !== chunk.phrase) : [...prev, chunk.phrase],
                    )
                  }
                  className={cn(
                    'w-full rounded-md border p-2 text-left transition-colors',
                    selected ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="jp text-base">{chunk.phrase}</span>
                    {chunk.jlpt_level ? (
                      <Badge className={cn('text-[10px]', levelBadgeClass(chunk.jlpt_level))}>
                        {chunk.jlpt_level}
                      </Badge>
                    ) : null}
                  </div>
                  {chunk.reading ? <p className="text-xs text-muted-foreground">{chunk.reading}</p> : null}
                  {chunk.meaning ? <p className="text-xs">{chunk.meaning}</p> : null}
                </button>
              );
            })}
            {!suggestions.length ? <p className="text-xs text-muted-foreground">No chunks for this topic yet.</p> : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

/**
 * Turns transcript/correction pairs into error-log entries. The user highlights
 * the line pairs they care about rather than the app guessing at a diff over
 * free-form speech.
 */
function ErrorHarvester({
  sessionId,
  transcript,
  corrections,
  onLogged,
}: {
  sessionId: number | null;
  transcript: string;
  corrections: string;
  onLogged: () => void;
}) {
  const transcriptLines = transcript.split('\n').map((l) => l.trim()).filter(Boolean);
  const correctionLines = corrections.split('\n').map((l) => l.trim()).filter(Boolean);
  const pairs = transcriptLines.map((line, index) => ({
    attempted: line,
    corrected: correctionLines[index] ?? '',
  }));
  const [selected, setSelected] = useState<number[]>([]);
  const [category, setCategory] = useState('particle');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  async function generate() {
    setBusy(true);
    let created = 0;
    for (const index of selected) {
      const pair = pairs[index];
      if (!pair?.corrected || pair.corrected === pair.attempted) continue;
      await fetch('/api/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attempted: pair.attempted,
          corrected: pair.corrected,
          category,
          source_activity: '432',
          source_id: sessionId,
          createCard: true,
        }),
      });
      created += 1;
    }
    setBusy(false);
    setDone(created);
    setSelected([]);
    onLogged();
  }

  return (
    <div className="rounded-md border border-border p-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
        Generate error entries — pick the lines that were corrected
      </p>
      <div className="max-h-56 space-y-2 overflow-y-auto scrollbar-thin">
        {pairs.map((pair, index) => {
          const changed = pair.corrected && pair.corrected !== pair.attempted;
          return (
            <label
              key={index}
              className={cn(
                'flex cursor-pointer gap-2 rounded border p-2 text-sm',
                selected.includes(index) ? 'border-primary bg-primary/5' : 'border-border',
                !changed && 'opacity-50',
              )}
            >
              <input
                type="checkbox"
                className="mt-1"
                disabled={!changed}
                checked={selected.includes(index)}
                onChange={(event) =>
                  setSelected((prev) =>
                    event.target.checked ? [...prev, index] : prev.filter((i) => i !== index),
                  )
                }
              />
              <span className="min-w-0">
                <span className="jp block text-base line-through decoration-destructive/60">{pair.attempted}</span>
                <span className="jp block text-base text-emerald-600 dark:text-emerald-400">{pair.corrected || '—'}</span>
              </span>
            </label>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select value={category} onChange={(event) => setCategory(event.target.value)} className="w-44">
          <option value="particle">particle</option>
          <option value="conjugation">conjugation</option>
          <option value="register">register</option>
          <option value="word_choice">word choice</option>
          <option value="pitch">pitch</option>
          <option value="other">other</option>
        </Select>
        <Button size="sm" onClick={generate} disabled={busy || !selected.length}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create {selected.length} error entries
        </Button>
        {done ? <span className="text-xs text-emerald-600 dark:text-emerald-400">{done} entries logged with cards.</span> : null}
      </div>
    </div>
  );
}
