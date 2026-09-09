'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { AnalyzedToken } from '@/lib/reader';
import type { GrammarMatch } from '@/lib/grammar-detector';

/**
 * Renders the analysed text: furigana in <ruby>, a JLPT tint per word, a
 * knowledge dot, and an underline under every detected grammar pattern.
 */

export type GrammarHit = GrammarMatch & { meaning?: string | null };

const KNOWLEDGE_DOT: Record<string, string> = {
  known: 'bg-emerald-400',
  learning: 'bg-sky-400',
  encountered: 'bg-muted-foreground',
  ignored: 'bg-transparent',
};

function levelClass(token: AnalyzedToken): string {
  if (!token.isContent) return '';
  if (!token.level) return 'level-unknown';
  if (token.level === 'N5') return '';
  return `level-${token.level}`;
}

export function AnalyzedText({
  tokens,
  grammar,
  showFurigana,
  selectedIndex,
  onSelectToken,
  onSelectGrammar,
}: {
  tokens: AnalyzedToken[];
  grammar: GrammarHit[];
  showFurigana: boolean;
  selectedIndex: number | null;
  onSelectToken: (token: AnalyzedToken) => void;
  onSelectGrammar: (match: GrammarHit) => void;
}) {
  // Map every token index to the grammar matches that cover it, so the
  // underline can be drawn on the individual tokens rather than as an overlay.
  const grammarByToken = useMemo(() => {
    const map = new Map<number, GrammarHit[]>();
    for (const match of grammar) {
      for (let i = match.startIndex; i <= match.endIndex; i += 1) {
        const list = map.get(i);
        if (list) list.push(match);
        else map.set(i, [match]);
      }
    }
    return map;
  }, [grammar]);

  return (
    <div className={cn('jp-study leading-loose', !showFurigana && 'furigana-off')}>
      {tokens.map((token) => {
        const hits = grammarByToken.get(token.index);
        const isSelected = selectedIndex === token.index;
        const clickable = token.isContent;

        const content = token.furigana.some((s) => s.ruby) ? (
          <>
            {token.furigana.map((segment, i) =>
              segment.ruby ? (
                <ruby key={i}>
                  {segment.text}
                  <rt>{segment.ruby}</rt>
                </ruby>
              ) : (
                <span key={i}>{segment.text}</span>
              ),
            )}
          </>
        ) : (
          token.surface
        );

        return (
          <span
            key={token.index}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={() => {
              if (hits?.length) onSelectGrammar(hits[0]);
              if (clickable) onSelectToken(token);
            }}
            onKeyDown={(event) => {
              if (clickable && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                onSelectToken(token);
              }
            }}
            className={cn(
              'relative rounded-sm px-[1px] transition-colors',
              levelClass(token),
              clickable && 'cursor-pointer hover:bg-primary/20',
              isSelected && 'bg-primary/30 ring-1 ring-primary',
              hits?.length && 'border-b-2 border-dashed border-primary/70',
            )}
            title={
              hits?.length
                ? `${hits.map((h) => h.pattern).join(', ')} — click for the grammar note`
                : token.gloss ?? undefined
            }
          >
            {content}
            {token.knowledge && token.knowledge !== 'ignored' ? (
              <span
                className={cn(
                  'absolute -top-0.5 right-0 h-1.5 w-1.5 rounded-full',
                  KNOWLEDGE_DOT[token.knowledge] ?? 'bg-muted-foreground',
                )}
                aria-hidden
              />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

export function LevelLegend({ summary }: { summary: Record<string, number> }) {
  const total = Object.values(summary).reduce((a, b) => a + b, 0) || 1;
  const items = [
    { key: 'N5', label: 'N5', className: 'bg-slate-400/60' },
    { key: 'N4', label: 'N4', className: 'bg-emerald-500/60' },
    { key: 'N3', label: 'N3', className: 'bg-sky-500/60' },
    { key: 'N2', label: 'N2', className: 'bg-orange-500/60' },
    { key: 'N1', label: 'N1', className: 'bg-rose-500/60' },
    { key: 'unknown', label: 'Unlisted', className: 'bg-amber-400/60' },
  ];
  return (
    <div className="space-y-2">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {items.map((item) => {
          const value = summary[item.key] ?? 0;
          if (!value) return null;
          return (
            <div
              key={item.key}
              className={item.className}
              style={{ width: `${(value / total) * 100}%` }}
              title={`${item.label}: ${value}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {items.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', item.className)} />
            {item.label} {summary[item.key] ?? 0}
          </span>
        ))}
      </div>
    </div>
  );
}
