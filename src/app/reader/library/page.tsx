'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { formatDateTime } from '@/lib/utils';

type TextRow = {
  id: number;
  title: string;
  source_url: string | null;
  token_count: number;
  unique_words: number;
  level_summary: string;
  created_at: string;
  preview: string;
};

export default function LibraryPage() {
  const [texts, setTexts] = useState<TextRow[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'date' | 'title'>('date');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    params.set('sort', sort);
    fetch(`/api/reader/texts?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => setTexts(data.texts ?? []))
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [query, sort]);

  const totals = useMemo(() => {
    const tokens = texts.reduce((sum, t) => sum + t.token_count, 0);
    return { texts: texts.length, tokens };
  }, [texts]);

  async function remove(id: number) {
    await fetch(`/api/reader/texts/${id}`, { method: 'DELETE' });
    setTexts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-3 mb-1">
            <Link href="/reader">
              <ArrowLeft className="h-4 w-4" /> Reader
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">Text library</h1>
          <p className="text-xs text-muted-foreground">
            {totals.texts} texts · {totals.tokens.toLocaleString()} tokens analysed
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles and text…"
            className="pl-9"
          />
        </div>
        <Select value={sort} onChange={(event) => setSort(event.target.value as 'date' | 'title')} className="w-40">
          <option value="date">Newest first</option>
          <option value="title">By title</option>
        </Select>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      <ul className="space-y-3">
        {texts.map((text) => {
          let summary: Record<string, number> = {};
          try {
            summary = JSON.parse(text.level_summary ?? '{}');
          } catch {
            summary = {};
          }
          return (
            <li key={text.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link href={`/reader?text=${text.id}`} className="font-medium hover:text-primary">
                    {text.title}
                  </Link>
                  <p className="jp mt-1 truncate text-base text-muted-foreground">{text.preview}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatDateTime(text.created_at)} · {text.token_count} tokens · {text.unique_words} unique
                    {Object.keys(summary).length
                      ? ` · N5 ${summary.N5 ?? 0} / N4 ${summary.N4 ?? 0} / N3 ${summary.N3 ?? 0} / N2 ${summary.N2 ?? 0} / N1 ${summary.N1 ?? 0} / ? ${summary.unknown ?? 0}`
                      : ''}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(text.id)} aria-label="Delete text">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {!loading && !texts.length ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nothing analysed yet. Paste some Japanese into the Reader and it will show up here.
        </p>
      ) : null}
    </div>
  );
}
