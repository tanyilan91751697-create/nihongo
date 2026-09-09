'use client';

import { useEffect, useState } from 'react';
import { BookmarkPlus, Check, Loader2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, levelBadgeClass } from '@/lib/utils';
import type { AnalyzedToken } from '@/lib/reader';
import type { GrammarHit } from './analyzed-text';

type WordDetail = {
  surface: string;
  entries: {
    id: number;
    kanji: string | null;
    reading: string;
    glosses: string;
    pos: string | null;
    jlpt_level: string | null;
    pitch_accent_pattern: string | null;
    pitch_accent_position: number | null;
    is_common: number;
  }[];
  kanji: { character: string; meanings: string | null; on_readings: string | null; kun_readings: string | null; stroke_count: number | null; jlpt_level: string | null }[];
  knowledge: { status: string; encounters: number } | null;
  grammarExamples: { slug: string; level: string; pattern: string; japanese: string; english: string }[];
  cards: { id: number; card_type: string; stage: string; due: string }[];
  encounters: { sentence: string; text_id: number; title: string }[];
};

const PITCH_LABEL: Record<string, string> = {
  heiban: 'heiban (flat)',
  atamadaka: 'atamadaka (drop after mora 1)',
  nakadaka: 'nakadaka (drop mid-word)',
  odaka: 'odaka (drop after the word)',
};

export function WordPanel({
  token,
  grammar,
  sentence,
  textId,
  textTitle,
  onKnowledgeChange,
}: {
  token: AnalyzedToken | null;
  grammar: GrammarHit | null;
  sentence: string;
  textId?: number;
  textTitle?: string;
  onKnowledgeChange?: (surface: string, status: string) => void;
}) {
  const [detail, setDetail] = useState<WordDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [grammarPoint, setGrammarPoint] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ surface: token.dictionaryForm });
    if (token.reading) params.set('reading', token.reading);
    fetch(`/api/word?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!grammar) {
      setGrammarPoint(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/grammar/${grammar.slug}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setGrammarPoint(data.point ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [grammar]);

  const primary = detail?.entries[0];

  async function markKnowledge(status: string) {
    if (!token) return;
    setBusy(status);
    await fetch('/api/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        surface: token.dictionaryForm,
        reading: token.reading || null,
        ref_id: token.vocabularyId,
        status,
      }),
    });
    setBusy(null);
    setFlash(`Marked as ${status}`);
    onKnowledgeChange?.(token.dictionaryForm, status);
    setTimeout(() => setFlash(null), 1800);
  }

  async function addToSrs(alsoProduction: boolean) {
    if (!token || !primary) return;
    setBusy('srs');
    const front = primary.kanji ?? primary.reading;
    await fetch('/api/srs/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        node_type: 'vocabulary',
        ref_id: primary.id,
        front,
        back: primary.glosses.split('\n').slice(0, 3).join('; '),
        reading: primary.reading,
        context_sentence: sentence,
        source: 'reader',
        source_id: textId ?? null,
        source_label: textTitle ?? 'Reader',
        alsoProduction,
      }),
    });
    await markKnowledge('learning');
    setBusy(null);
    setFlash(alsoProduction ? 'Recognition + production cards added' : 'Recognition card added');
    setTimeout(() => setFlash(null), 2200);
  }

  if (!token && !grammar) {
    return (
      <div className="p-5 text-sm text-muted-foreground">
        <p className="mb-2 font-medium text-foreground">Nothing selected</p>
        <p>Click any word in the analysed text to see its dictionary entry, pitch accent and example sentences.</p>
        <p className="mt-3">Words with a dashed underline carry a detected grammar pattern — click those for the grammar note.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-5">
      {grammar && grammarPoint ? (
        <section className="rounded-lg border border-primary/40 bg-primary/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Badge className={levelBadgeClass(String(grammarPoint.level))}>{String(grammarPoint.level)}</Badge>
            <span className="jp font-medium">{String(grammarPoint.pattern)}</span>
          </div>
          {grammarPoint.meaning_en ? <p className="text-sm">{String(grammarPoint.meaning_en)}</p> : null}
          {grammarPoint.formation ? (
            <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Formation: </span>
              {String(grammarPoint.formation)}
            </p>
          ) : null}
          {grammarPoint.explanation && grammarPoint.explanation !== grammarPoint.meaning_en ? (
            <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{String(grammarPoint.explanation)}</p>
          ) : null}
          {Array.isArray(grammarPoint.examples) && grammarPoint.examples.length ? (
            <ul className="mt-3 space-y-2">
              {(grammarPoint.examples as { japanese: string; english: string }[]).slice(0, 3).map((ex, i) => (
                <li key={i} className="border-l-2 border-primary/40 pl-3">
                  <p className="jp text-base">{ex.japanese}</p>
                  {ex.english ? <p className="text-xs text-muted-foreground">{ex.english}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-[11px] text-muted-foreground">Matched: {grammar.matchedText}</p>
        </section>
      ) : null}

      {token ? (
        <section>
          <div className="mb-1 flex items-baseline gap-3">
            <h2 className="jp-display font-semibold">{token.surface}</h2>
            {token.reading && token.reading !== token.surface ? (
              <span className="jp text-muted-foreground">{token.reading}</span>
            ) : null}
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {token.dictionaryForm !== token.surface ? <span>dictionary form: {token.dictionaryForm}</span> : null}
            <span>{token.pos}{token.posDetail ? ` · ${token.posDetail}` : ''}</span>
            {token.conjugatedForm ? <span>· {token.conjugatedForm}</span> : null}
          </div>

          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Looking up…
            </p>
          ) : null}

          {primary ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {primary.jlpt_level ? (
                  <Badge className={levelBadgeClass(primary.jlpt_level)}>{primary.jlpt_level}</Badge>
                ) : (
                  <Badge className={levelBadgeClass(null)}>not on a JLPT list</Badge>
                )}
                {primary.is_common ? <Badge>common</Badge> : null}
                {primary.pos ? <Badge className="font-normal">{primary.pos}</Badge> : null}
              </div>

              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {primary.glosses.split('\n').slice(0, 8).map((gloss, i) => (
                  <li key={i}>{gloss}</li>
                ))}
              </ol>

              {primary.pitch_accent_pattern ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">Pitch: </span>
                  {PITCH_LABEL[primary.pitch_accent_pattern] ?? primary.pitch_accent_pattern}
                  {primary.pitch_accent_position !== null ? ` [${primary.pitch_accent_position}]` : ''}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => markKnowledge('encountered')}>
                  <BookmarkPlus className="h-4 w-4" /> Mark encountered
                </Button>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => markKnowledge('known')}>
                  <Check className="h-4 w-4" /> Known
                </Button>
                <Button size="sm" disabled={busy !== null} onClick={() => addToSrs(false)}>
                  <Plus className="h-4 w-4" /> Add to SRS
                </Button>
                <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => addToSrs(true)}>
                  + production card
                </Button>
              </div>
              {flash ? <p className="text-xs text-emerald-400">{flash}</p> : null}
              {detail?.knowledge ? (
                <p className="text-xs text-muted-foreground">
                  Knowledge graph: {detail.knowledge.status} · seen {detail.knowledge.encounters}×
                </p>
              ) : null}
              {detail?.cards?.length ? (
                <p className="text-xs text-muted-foreground">
                  Already in SRS: {detail.cards.map((c) => `${c.card_type} (${c.stage})`).join(', ')}
                </p>
              ) : null}
            </div>
          ) : !loading ? (
            <p className="text-sm text-muted-foreground">No dictionary entry found for this form.</p>
          ) : null}

          {detail?.entries && detail.entries.length > 1 ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {detail.entries.length - 1} other dictionary entries
              </summary>
              <ul className="mt-2 space-y-2">
                {detail.entries.slice(1, 6).map((entry) => (
                  <li key={entry.id} className="rounded border border-border p-2 text-sm">
                    <span className="jp">{entry.kanji ?? entry.reading}</span>{' '}
                    <span className="text-muted-foreground">{entry.reading}</span>
                    <p className="text-xs text-muted-foreground">{entry.glosses.split('\n')[0]}</p>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {sentence ? (
            <div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">In this text</p>
              <p className="jp text-base">{sentence}</p>
            </div>
          ) : null}

          {detail?.kanji?.length ? (
            <div className="mt-4 space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Kanji</p>
              {detail.kanji.map((k) => (
                <div key={k.character} className="flex gap-3 rounded-md border border-border p-2">
                  <span className="jp-display leading-none">{k.character}</span>
                  <div className="min-w-0 text-xs">
                    <p className="truncate">{k.meanings}</p>
                    <p className="truncate text-muted-foreground">
                      {k.on_readings} {k.kun_readings ? `· ${k.kun_readings}` : ''}
                    </p>
                    <p className="text-muted-foreground">
                      {k.stroke_count ?? '?'} strokes{k.jlpt_level ? ` · ${k.jlpt_level}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {detail?.grammarExamples?.length ? (
            <div className="mt-4 space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Grammar examples containing this word
              </p>
              {detail.grammarExamples.map((ex, i) => (
                <div key={i} className="rounded-md border border-border p-2">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge className={cn('text-[10px]', levelBadgeClass(ex.level))}>{ex.level}</Badge>
                    <span className="jp text-sm">{ex.pattern}</span>
                  </div>
                  <p className="jp text-base">{ex.japanese}</p>
                  {ex.english ? <p className="text-xs text-muted-foreground">{ex.english}</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          {detail?.encounters?.length ? (
            <div className="mt-4 space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Previously seen in</p>
              {detail.encounters.map((e, i) => (
                <div key={i} className="rounded-md border border-border p-2 text-xs">
                  <p className="mb-1 text-muted-foreground">{e.title}</p>
                  <p className="jp text-sm">{e.sentence}</p>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
