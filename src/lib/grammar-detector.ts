import fs from 'node:fs';
import path from 'node:path';
import type { Token } from './tokenizer';

/**
 * Grammar detection.
 *
 * Rules match against kuromoji's token stream rather than raw text, which is
 * what makes 〜てから distinguishable from a 〜て clause followed by から as a
 * reason marker: the token before から has to be a verb in 連用形 plus て.
 *
 * A rule is a sequence of token specs. Every field in a spec is optional and
 * all present fields must hold (AND); a field holding a list matches if any of
 * its values matches (OR). `optional: true` lets a spec be skipped, and
 * `repeat` allows a spec to consume several tokens.
 */

export type RuleTokenSpec = {
  surface?: string[];
  basicForm?: string[];
  reading?: string[];
  pos?: string[];
  posDetail?: string[];
  conjugatedForm?: string[];
  conjugatedType?: string[];
  notSurface?: string[];
  notPos?: string[];
  optional?: boolean;
  repeat?: { min: number; max: number };
};

export type DetectionRule = {
  slug: string;
  grammarId?: number;
  level: string;
  pattern: string;
  label?: string;
  note?: string;
  tokens: RuleTokenSpec[];
};

export type GrammarMatch = {
  slug: string;
  grammarId?: number;
  level: string;
  pattern: string;
  startIndex: number;
  endIndex: number;
  matchedText: string;
  sentenceIndex: number;
};

const RULES_PATH = path.join(process.cwd(), 'data', 'grammar_detection_rules.json');

declare global {
  // eslint-disable-next-line no-var
  var __grammarRules: { mtime: number; rules: DetectionRule[] } | undefined;
}

/** Rules are hot-reloaded when the file changes so the set can grow by hand. */
export function loadRules(): DetectionRule[] {
  if (!fs.existsSync(RULES_PATH)) return [];
  const mtime = fs.statSync(RULES_PATH).mtimeMs;
  if (globalThis.__grammarRules?.mtime === mtime) return globalThis.__grammarRules.rules;
  const parsed = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8')) as { rules: DetectionRule[] } | DetectionRule[];
  const rules = Array.isArray(parsed) ? parsed : parsed.rules;
  globalThis.__grammarRules = { mtime, rules };
  return rules;
}

function matchesSpec(spec: RuleTokenSpec, token: Token): boolean {
  if (spec.surface && !spec.surface.includes(token.surface)) return false;
  if (spec.notSurface && spec.notSurface.includes(token.surface)) return false;
  if (spec.basicForm && !spec.basicForm.includes(token.dictionaryForm)) return false;
  if (spec.reading && !spec.reading.includes(token.reading)) return false;
  if (spec.pos && !spec.pos.includes(token.pos)) return false;
  if (spec.notPos && spec.notPos.includes(token.pos)) return false;
  if (spec.posDetail && !spec.posDetail.some((d) => token.posDetail.includes(d))) return false;
  if (spec.conjugatedForm && !spec.conjugatedForm.includes(token.conjugatedForm)) return false;
  if (spec.conjugatedType && !spec.conjugatedType.some((t) => token.conjugatedType.includes(t))) return false;
  return true;
}

/**
 * Try to match `specs` starting at `start`. Returns the index one past the last
 * consumed token, or -1. Optional and repeated specs backtrack, so a rule like
 * [verb, optional(auxiliary), から] still matches 食べてから.
 */
function matchFrom(specs: RuleTokenSpec[], tokens: Token[], start: number, specIndex = 0): number {
  if (specIndex >= specs.length) return start;
  const spec = specs[specIndex];
  const max = spec.repeat?.max ?? 1;
  const min = spec.optional ? 0 : spec.repeat?.min ?? 1;

  // Greedy: consume as many as allowed, then give tokens back on failure.
  let consumed = 0;
  while (consumed < max && start + consumed < tokens.length && matchesSpec(spec, tokens[start + consumed])) {
    consumed += 1;
  }
  for (let take = consumed; take >= min; take -= 1) {
    if (take > 0 && !tokens[start + take - 1]) continue;
    const next = matchFrom(specs, tokens, start + take, specIndex + 1);
    if (next !== -1) return next;
  }
  return -1;
}

export function detectGrammar(tokens: Token[], rules: DetectionRule[] = loadRules()): GrammarMatch[] {
  const matches: GrammarMatch[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    for (const rule of rules) {
      if (!rule.tokens?.length) continue;
      const end = matchFrom(rule.tokens, tokens, i);
      if (end === -1 || end === i) continue;
      // A match may not straddle a sentence boundary.
      if (tokens[end - 1].sentenceIndex !== tokens[i].sentenceIndex) continue;
      matches.push({
        slug: rule.slug,
        grammarId: rule.grammarId,
        level: rule.level,
        pattern: rule.pattern,
        startIndex: i,
        endIndex: end - 1,
        matchedText: tokens
          .slice(i, end)
          .map((t) => t.surface)
          .join(''),
        sentenceIndex: tokens[i].sentenceIndex,
      });
    }
  }
  // Prefer the longest match when several rules cover the same span start.
  matches.sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex);
  const kept: GrammarMatch[] = [];
  for (const m of matches) {
    const duplicate = kept.some(
      (k) => k.slug === m.slug && k.startIndex <= m.startIndex && k.endIndex >= m.endIndex,
    );
    if (!duplicate) kept.push(m);
  }
  return kept;
}
