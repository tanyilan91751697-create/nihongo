'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Check, Loader2, Plus, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { STATUSES, statusClass } from '@/lib/islands';
import { cn, formatDateTime, levelBadgeClass } from '@/lib/utils';
import { extractChanges, diffChars, type DiffOp } from '@/lib/diff';

type IslandDetail = {
  island: {
    id: number;
    topic: string;
    status: string;
    register: string;
    l1_script: string | null;
    l2_translation: string | null;
    verified_version: string | null;
    notes: string | null;
    last_practiced_at: string | null;
  };
  drills: {
    id: number;
    step: number;
    l1_back_translation: string | null;
    l2_reconstruction: string | null;
    diff_json: string | null;
    available_at: string | null;
    created_at: string;
  }[];
  tools: { id: number; kind: string; phrase: string; reading: string | null; meaning: string | null }[];
  chunks: { id: number; phrase: string; reading: string | null; meaning: string | null; jlpt_level: string | null }[];
  sessions: { id: number; session_type: string; topic: string | null; created_at: string; duration_sec: number }[];
};

export default function IslandDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Number(params.id);
  const [data, setData] = useState<IslandDetail | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const [l1, setL1] = useState('');
  const [l2, setL2] = useState('');
  const [verified, setVerified] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    const detail = await fetch(`/api/islands/${id}`).then((r) => r.json());
    if (detail.island) {
      setData(detail);
      setL1(detail.island.l1_script ?? '');
      setL2(detail.island.l2_translation ?? '');
      setVerified(detail.island.verified_version ?? '');
      setNotes(detail.island.notes ?? '');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (payload: Record<string, unknown>, label: string) => {
      setSaving(label);
      await fetch(`/api/islands/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await load();
      setSaving(null);
    },
    [id, load],
  );

  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading island…</div>;
  const island = data.island;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Button variant="ghost" size="sm" asChild className="-ml-3 mb-2">
        <Link href="/islands">
          <ArrowLeft className="h-4 w-4" /> Islands
        </Link>
      </Button>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{island.topic}</h1>
          <p className="text-xs text-muted-foreground">
            {island.register === 'teineigo' ? '丁寧語 (polite)' : 'タメ口 (casual)'} ·{' '}
            {island.last_practiced_at ? `last practised ${formatDateTime(island.last_practiced_at)}` : 'never practised'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={island.register}
            onChange={(event) => patch({ register: event.target.value }, 'register')}
            className="w-36"
          >
            <option value="teineigo">丁寧語</option>
            <option value="tameguchi">タメ口</option>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            onClick={async () => {
              if (!confirm('Delete this island and everything attached to it?')) return;
              await fetch(`/api/islands/${id}`, { method: 'DELETE' });
              router.push('/islands');
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Status pipeline */}
      <div className="mb-8 flex flex-wrap items-center gap-2">
        {STATUSES.map((status, index) => {
          const currentIndex = STATUSES.indexOf(island.status as (typeof STATUSES)[number]);
          const reached = index <= currentIndex;
          return (
            <button
              key={status}
              type="button"
              onClick={() => patch({ status }, 'status')}
              className={cn(
                'flex-1 rounded-md border px-3 py-2 text-xs transition-colors',
                reached ? statusClass(status) : 'border-border text-muted-foreground hover:border-primary/50',
              )}
            >
              {index + 1}. {status}
            </button>
          );
        })}
        {saving === 'status' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>L1 script</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea value={l1} onChange={(event) => setL1(event.target.value)} className="min-h-[140px]" />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => patch({ l1_script: l1 }, 'l1')} disabled={saving === 'l1'}>
                {saving === 'l1' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save script
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>L2 translation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              value={l2}
              onChange={(event) => setL2(event.target.value)}
              className="jp min-h-[140px]"
              placeholder="Paste the Japanese translation here…"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => patch({ l2_translation: l2, status: island.status === 'draft' ? 'translated' : island.status }, 'l2')}
                disabled={saving === 'l2'}
              >
                {saving === 'l2' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save translation
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!l2.trim()}
                onClick={async () => {
                  const response = await fetch('/api/reader/analyze', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: l2, title: `Island — ${island.topic}`, save: true }),
                  });
                  const result = await response.json();
                  if (result.textId) router.push(`/reader?text=${result.textId}`);
                }}
              >
                Send to Reader
              </Button>
            </div>
          </CardContent>
        </Card>

        <VerificationSection
          island={island}
          verified={verified}
          setVerified={setVerified}
          onSave={(value) => patch({ verified_version: value, status: 'verified' }, 'verified')}
          saving={saving === 'verified'}
          onReload={load}
        />

        <DrillSection island={island} drills={data.drills} onChanged={load} />

        <ToolsSection islandId={id} tools={data.tools} onChanged={load} />

        <ChunkBank islandId={id} chunks={data.chunks} island={island} onChanged={load} />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Practice log</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.sessions.length ? (
              data.sessions.map((session) => (
                <div key={session.id} className="flex items-center justify-between rounded border border-border p-2 text-sm">
                  <span>
                    <Badge className="mr-2">{session.session_type === '432' ? '4/3/2' : session.session_type}</Badge>
                    {session.topic ?? 'Session'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(session.created_at)} · {Math.round(session.duration_sec / 60)} min
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No practice yet. Run this island in a 4/3/2 session from the Oral Studio.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
            <Button size="sm" variant="outline" onClick={() => patch({ notes }, 'notes')}>
              Save notes
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DiffView({ ops }: { ops: DiffOp[] }) {
  return (
    <p className="jp rounded-md border border-border bg-muted/30 p-3 text-base leading-relaxed">
      {ops.map((op, index) => (
        <span
          key={index}
          className={cn(
            op.type === 'delete' && 'bg-destructive/20 text-destructive line-through',
            op.type === 'insert' && 'bg-emerald-500/20 text-emerald-300',
          )}
        >
          {op.value}
        </span>
      ))}
    </p>
  );
}

function VerificationSection({
  island,
  verified,
  setVerified,
  onSave,
  saving,
  onReload,
}: {
  island: IslandDetail['island'];
  verified: string;
  setVerified: (value: string) => void;
  onSave: (value: string) => void;
  saving: boolean;
  onReload: () => void;
}) {
  const base = island.l2_translation ?? '';
  const changes = base && verified ? extractChanges(base, verified) : [];
  const [logged, setLogged] = useState<number[]>([]);
  const [category, setCategory] = useState('word_choice');

  async function logChange(index: number) {
    const change = changes[index];
    if (!change) return;
    await fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attempted: change.before || '(nothing)',
        corrected: change.after || '(removed)',
        error_text: change.context,
        category,
        source_activity: 'island',
        source_id: island.id,
        createCard: true,
      }),
    });
    setLogged((prev) => [...prev, index]);
    onReload();
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Verification</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={verified}
          onChange={(event) => setVerified(event.target.value)}
          className="jp min-h-[140px]"
          placeholder="Paste the version a native speaker corrected…"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => onSave(verified)} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save verified version
          </Button>
          <Select value={category} onChange={(event) => setCategory(event.target.value)} className="w-44">
            <option value="particle">particle</option>
            <option value="conjugation">conjugation</option>
            <option value="register">register</option>
            <option value="word_choice">word choice</option>
            <option value="pitch">pitch</option>
            <option value="other">other</option>
          </Select>
        </div>

        {base && verified ? (
          <>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Diff against the AI translation
            </p>
            <DiffView ops={diffChars(base, verified)} />

            {changes.length ? (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {changes.length} changes — turn any into an error entry with a card
                </p>
                {changes.map((change, index) => (
                  <div key={index} className="flex items-center justify-between gap-3 rounded border border-border p-2">
                    <div className="min-w-0 text-sm">
                      <span className="jp text-destructive line-through">{change.before || '—'}</span>
                      <span className="mx-2 text-muted-foreground">→</span>
                      <span className="jp text-emerald-600 dark:text-emerald-400">{change.after || '—'}</span>
                      <p className="jp mt-1 truncate text-xs text-muted-foreground">…{change.context}…</p>
                    </div>
                    <Button
                      size="sm"
                      variant={logged.includes(index) ? 'ghost' : 'outline'}
                      disabled={logged.includes(index)}
                      onClick={() => logChange(index)}
                    >
                      {logged.includes(index) ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      {logged.includes(index) ? 'Logged' : 'Log'}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">The verified version matches the translation exactly.</p>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DrillSection({
  island,
  drills,
  onChanged,
}: {
  island: IslandDetail['island'];
  drills: IslandDetail['drills'];
  onChanged: () => void;
}) {
  const [back, setBack] = useState('');
  const [reconstruction, setReconstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const target = island.verified_version || island.l2_translation || '';
  const openDrill = drills.find((d) => d.step === 1);
  const unlocked = openDrill?.available_at ? new Date(openDrill.available_at.replace(' ', 'T') + 'Z') <= new Date() : false;

  async function saveStep1() {
    if (!back.trim()) return;
    setBusy(true);
    await fetch(`/api/islands/${island.id}/drills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 1, l1_back_translation: back }),
    });
    setBack('');
    setBusy(false);
    onChanged();
  }

  async function saveStep2() {
    if (!openDrill || !reconstruction.trim()) return;
    setBusy(true);
    await fetch(`/api/islands/${island.id}/drills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 2, drill_id: openDrill.id, l2_reconstruction: reconstruction }),
    });
    setReconstruction('');
    setBusy(false);
    onChanged();
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Double translation drill</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!target ? (
          <p className="text-sm text-muted-foreground">Add a Japanese version first — the drill works from it.</p>
        ) : !openDrill ? (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Step 1 — translate back into your language</p>
            <p className="jp rounded-md border border-border bg-muted/30 p-3 text-base">{target}</p>
            <Textarea
              value={back}
              onChange={(event) => setBack(event.target.value)}
              placeholder="Your back-translation…"
              className="min-h-[120px]"
            />
            <Button size="sm" onClick={saveStep1} disabled={busy || !back.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save step 1
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Step 2 — reconstruct the Japanese from your own words
            </p>
            <p className="rounded-md border border-border bg-muted/30 p-3 text-sm">{openDrill.l1_back_translation}</p>
            {unlocked ? (
              <>
                <Textarea
                  value={reconstruction}
                  onChange={(event) => setReconstruction(event.target.value)}
                  placeholder="Rebuild the Japanese without looking…"
                  className="jp min-h-[120px]"
                />
                <Button size="sm" onClick={saveStep2} disabled={busy || !reconstruction.trim()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Compare with the verified version
                </Button>
              </>
            ) : (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Step 2 unlocks {openDrill.available_at ? formatDateTime(openDrill.available_at) : 'in 24 hours'} — the
                delay is what makes the drill work.
              </p>
            )}
          </div>
        )}

        {drills
          .filter((d) => d.step === 2 && d.diff_json)
          .map((drill) => {
            let ops: DiffOp[] = [];
            try {
              ops = JSON.parse(drill.diff_json ?? '[]');
            } catch {
              ops = [];
            }
            return (
              <div key={drill.id} className="space-y-2 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">Attempt from {formatDateTime(drill.created_at)}</p>
                <DiffView ops={ops} />
              </div>
            );
          })}
      </CardContent>
    </Card>
  );
}

function ToolsSection({
  islandId,
  tools,
  onChanged,
}: {
  islandId: number;
  tools: IslandDetail['tools'];
  onChanged: () => void;
}) {
  const [phrase, setPhrase] = useState('');
  const [meaning, setMeaning] = useState('');
  const [kind, setKind] = useState('linking');

  async function add() {
    if (!phrase.trim()) return;
    await fetch(`/api/islands/${islandId}/tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, phrase, meaning }),
    });
    setPhrase('');
    setMeaning('');
    onChanged();
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Communication tools</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Select value={kind} onChange={(event) => setKind(event.target.value)} className="w-40">
            <option value="linking">linking</option>
            <option value="shifting">shifting</option>
            <option value="embellishing">embellishing</option>
          </Select>
          <Input
            className="jp min-w-[12rem] flex-1"
            placeholder="Phrase"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
          />
          <Input
            className="min-w-[12rem] flex-1"
            placeholder="Meaning"
            value={meaning}
            onChange={(event) => setMeaning(event.target.value)}
          />
          <Button size="sm" onClick={add} disabled={!phrase.trim()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>

        {(['linking', 'shifting', 'embellishing'] as const).map((group) => {
          const items = tools.filter((t) => t.kind === group);
          if (!items.length) return null;
          return (
            <div key={group}>
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{group}</p>
              <ul className="space-y-1">
                {items.map((tool) => (
                  <li key={tool.id} className="flex items-center justify-between rounded border border-border px-2 py-1">
                    <span>
                      <span className="jp text-base">{tool.phrase}</span>
                      {tool.meaning ? <span className="ml-2 text-xs text-muted-foreground">{tool.meaning}</span> : null}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={async () => {
                        await fetch(`/api/islands/${islandId}/tools?tool_id=${tool.id}`, { method: 'DELETE' });
                        onChanged();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {!tools.length ? (
          <p className="text-sm text-muted-foreground">
            No tools yet — the phrases you use to link ideas, change direction and add colour live here.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ChunkBank({
  islandId,
  chunks,
  island,
  onChanged,
}: {
  islandId: number;
  chunks: IslandDetail['chunks'];
  island: IslandDetail['island'];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function extract() {
    setBusy(true);
    const response = await fetch(`/api/islands/${islandId}/chunks`, { method: 'POST' });
    const data = await response.json();
    setBusy(false);
    setMessage(data.error ?? `Extracted ${data.extracted} chunks.`);
    onChanged();
  }

  async function toSrs(chunk: IslandDetail['chunks'][number]) {
    await fetch('/api/srs/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        node_type: 'chunk',
        ref_id: chunk.id,
        front: chunk.phrase,
        back: chunk.meaning ?? island.topic,
        reading: chunk.reading,
        source: 'island',
        source_id: islandId,
        source_label: `Island — ${island.topic}`,
      }),
    });
    setMessage(`${chunk.phrase} added to the SRS.`);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Chunk bank</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={extract} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Extract from the
            Japanese text
          </Button>
          {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {chunks.map((chunk) => (
            <button
              key={chunk.id}
              type="button"
              onClick={() => toSrs(chunk)}
              title="Add to SRS"
              className="rounded-full border border-border px-3 py-1 text-left transition-colors hover:border-primary"
            >
              <span className="jp text-base">{chunk.phrase}</span>
              {chunk.jlpt_level ? (
                <Badge className={cn('ml-2 text-[10px]', levelBadgeClass(chunk.jlpt_level))}>{chunk.jlpt_level}</Badge>
              ) : null}
              {chunk.meaning ? <span className="ml-2 text-xs text-muted-foreground">{chunk.meaning}</span> : null}
            </button>
          ))}
        </div>
        {!chunks.length ? (
          <p className="text-sm text-muted-foreground">
            Nothing extracted yet. Run the extractor once this island has Japanese text.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
