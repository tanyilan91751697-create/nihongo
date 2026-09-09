'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Library, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { AnalyzedText, LevelLegend, type GrammarHit } from '@/components/reader/analyzed-text';
import { WordPanel } from '@/components/reader/word-panel';
import type { AnalysisResult, AnalyzedToken } from '@/lib/reader';

const SAMPLE = `毎朝、私は六時に起きてコーヒーを飲みながらニュースを読みます。
仕事が始まる前に少し散歩をすることにしています。
天気がいい日は公園まで歩いて行きますが、雨の日は家で本を読んでいます。`;

function ReaderWorkspace() {
  const searchParams = useSearchParams();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFurigana, setShowFurigana] = useState(true);
  const [selectedToken, setSelectedToken] = useState<AnalyzedToken | null>(null);
  const [selectedGrammar, setSelectedGrammar] = useState<GrammarHit | null>(null);

  const analyze = useCallback(
    async (input: string, textTitle: string) => {
      const body = input.trim();
      if (!body) return;
      setLoading(true);
      setError(null);
      setSelectedToken(null);
      setSelectedGrammar(null);
      try {
        const response = await fetch('/api/reader/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: body, title: textTitle, save: true }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Analysis failed');
        setResult(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // /reader?text=<id> re-opens a saved text from the library.
  useEffect(() => {
    const id = searchParams.get('text');
    if (!id) return;
    fetch(`/api/reader/texts/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.text) return;
        setText(data.text.body);
        setTitle(data.text.title);
        try {
          setResult({
            tokens: JSON.parse(data.text.tokens_json ?? '[]'),
            grammar: JSON.parse(data.text.grammar_json ?? '[]'),
            sentences: [],
            levelSummary: JSON.parse(data.text.level_summary ?? '{}'),
            uniqueWords: data.text.unique_words,
            textId: data.text.id,
          });
        } catch {
          void analyze(data.text.body, data.text.title);
        }
      });
  }, [searchParams, analyze]);

  const sentenceFor = (token: AnalyzedToken | null) => {
    if (!token || !result) return '';
    if (result.sentences?.length) return result.sentences[token.sentenceIndex] ?? '';
    return result.tokens
      .filter((t) => t.sentenceIndex === token.sentenceIndex)
      .map((t) => t.surface)
      .join('');
  };

  const handleKnowledgeChange = (surface: string, status: string) => {
    setResult((prev) =>
      prev
        ? {
            ...prev,
            tokens: prev.tokens.map((t) => (t.dictionaryForm === surface ? { ...t, knowledge: status } : t)),
          }
        : prev,
    );
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Intelligent Reader</h1>
          <p className="text-xs text-muted-foreground">
            Paste Japanese text, then click any word for its entry, pitch accent and grammar notes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowFurigana((v) => !v)}>
            {showFurigana ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showFurigana ? 'Hide furigana' : 'Show furigana'}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/reader/library">
              <Library className="h-4 w-4" /> Library
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto scrollbar-thin p-6">
          <div className="mb-4 space-y-3">
            <Input
              placeholder="Title (optional)"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="max-w-md"
            />
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="ここに日本語のテキストを貼り付けてください…"
              className="jp min-h-[160px]"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => analyze(text, title)} disabled={loading || !text.trim()}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Analyze
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setText(SAMPLE);
                  setTitle('Sample paragraph');
                }}
              >
                Load a sample
              </Button>
              {error ? <span className="text-sm text-destructive">{error}</span> : null}
            </div>
          </div>

          {result ? (
            <div className="space-y-5">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {result.tokens.length} tokens · {result.uniqueWords} unique words ·{' '}
                    {result.grammar.length} grammar matches
                  </span>
                  {result.textId ? (
                    <span className="text-xs text-muted-foreground">saved as text #{result.textId}</span>
                  ) : null}
                </div>
                <LevelLegend summary={result.levelSummary} />
              </div>

              <div className="rounded-lg border border-border bg-card p-6">
                <AnalyzedText
                  tokens={result.tokens}
                  grammar={result.grammar as GrammarHit[]}
                  showFurigana={showFurigana}
                  selectedIndex={selectedToken?.index ?? null}
                  onSelectToken={setSelectedToken}
                  onSelectGrammar={setSelectedGrammar}
                />
              </div>

              {result.grammar.length ? (
                <div className="rounded-lg border border-border bg-card p-4">
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Grammar detected
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {[...new Map(result.grammar.map((g) => [g.slug, g])).values()].map((match) => (
                      <button
                        key={match.slug}
                        type="button"
                        onClick={() => setSelectedGrammar(match as GrammarHit)}
                        className="rounded-full border border-border px-3 py-1 text-sm transition-colors hover:border-primary hover:text-primary"
                      >
                        <span className="jp text-base">{match.pattern}</span>{' '}
                        <span className="text-xs text-muted-foreground">{match.level}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className="w-[26rem] shrink-0 overflow-y-auto scrollbar-thin border-l border-border bg-card/30">
          <WordPanel
            token={selectedToken}
            grammar={selectedGrammar}
            sentence={sentenceFor(selectedToken)}
            textId={result?.textId}
            textTitle={title || undefined}
            onKnowledgeChange={handleKnowledgeChange}
          />
        </aside>
      </div>
    </div>
  );
}

/**
 * useSearchParams needs a Suspense boundary: the workspace reads ?text=<id> to
 * reopen a saved analysis, which Next cannot prerender.
 */
export default function ReaderPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">Loading the reader…</div>
      }
    >
      <ReaderWorkspace />
    </Suspense>
  );
}
