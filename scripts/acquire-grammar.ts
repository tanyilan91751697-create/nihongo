/**
 * Phase 0a — build data/grammar_points.json from open-source JLPT grammar sets.
 *
 * Three community datasets are merged, each contributing what it is good at:
 *
 *   nihongo-kyoushi  495 entries, JLPT-tagged, Japanese explanations + examples
 *   e de wakaru      927 entries, JLPT-tagged, formation notes + examples
 *   DOJG             535 entries, English explanations + translated examples
 *
 * The first two supply JLPT levels and Japanese-language detail; DOJG supplies
 * the English meaning and the only bilingual example sentences in the set.
 * Entries are keyed on a normalised pattern so the same grammar point coming
 * from two sources lands in one record.
 */
import path from 'node:path';
import fs from 'node:fs';
import { download, log, readJson, writeJson } from './lib/http';
import { GRAMMAR_SOURCES } from './lib/sources';

const DATA_DIR = path.join(process.cwd(), 'data');
const OUT_FILE = path.join(DATA_DIR, 'grammar_points.json');
const GAPS_FILE = path.join(DATA_DIR, 'grammar_gaps.txt');

export type GrammarExample = { japanese: string; reading: string; english: string };
export type GrammarPoint = {
  id: string;
  level: string;
  pattern: string;
  term: string;
  reading: string;
  meaning_en: string;
  meaning_ja: string;
  formation: string;
  explanation: string;
  examples: GrammarExample[];
  tags: string[];
  sources: string[];
};

const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const;

/** Strip the decorations different sources put around the same pattern. */
function normaliseKey(pattern: string): string {
  return pattern
    .replace(/[〜～~・…\s]/g, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[「」『』【】\[\]]/g, '')
    .replace(/。$/, '')
    .trim();
}

function cleanPattern(pattern: string): string {
  return pattern.replace(/^[・\s]+/, '').replace(/[\s]+$/, '').trim();
}

/** Full-width digits appear in scraped level labels (ＪＬＰＴ　Ｎ１文法). */
function normaliseLevel(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const ascii = raw.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).toUpperCase();
  const m = ascii.match(/N\s*([1-5])/);
  return m ? `N${m[1]}` : null;
}

// ---------------------------------------------------------------------------
// Source 1: nihongo-kyoushi (already normalised into a by-level object)
// ---------------------------------------------------------------------------

type KyoushiEntry = {
  id: string;
  term: string;
  reading: string;
  pattern: string;
  jlpt_level: string;
  meaning: string;
  connection: string;
  notes: string;
  examples: string[];
};

function parseKyoushi(file: string): GrammarPoint[] {
  const raw = readJson<{ by_level: Record<string, KyoushiEntry[]>; non_jlpt?: KyoushiEntry[] }>(file);
  const out: GrammarPoint[] = [];
  for (const [level, entries] of Object.entries(raw.by_level ?? {})) {
    const lv = normaliseLevel(level);
    if (!lv) continue;
    for (const e of entries) {
      out.push({
        id: '',
        level: lv,
        pattern: cleanPattern(e.pattern || e.term),
        term: e.term ?? '',
        reading: e.reading ?? '',
        meaning_en: (e.notes ?? '').trim(),
        meaning_ja: (e.meaning ?? '').trim(),
        formation: (e.connection ?? '').trim(),
        explanation: (e.meaning ?? '').trim(),
        examples: (e.examples ?? []).slice(0, 8).map((j) => ({ japanese: j, reading: '', english: '' })),
        tags: [],
        sources: ['nihongo-kyoushi'],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source 2: e de wakaru (Yomichan structured-content term bank)
// ---------------------------------------------------------------------------

type YomiTerm = [string, string, string, string, number, unknown[], number, string];

/** Yomichan structured content is a tree of strings and {content} nodes. */
function flattenContent(node: unknown, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') {
    acc.push(node);
    return acc;
  }
  if (Array.isArray(node)) {
    for (const child of node) flattenContent(child, acc);
    return acc;
  }
  if (typeof node === 'object') {
    const obj = node as { content?: unknown; tag?: string };
    if (obj.tag === 'br') acc.push('\n');
    if (obj.content !== undefined) flattenContent(obj.content, acc);
  }
  return acc;
}

function sectionOf(text: string, label: string): string {
  // Sections are delimited by 【...】 headers.
  const re = new RegExp(`【${label}】([\\s\\S]*?)(?=【|$)`);
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

function parseEdewakaru(files: string[]): GrammarPoint[] {
  const out: GrammarPoint[] = [];
  for (const file of files) {
    const terms = readJson<YomiTerm[]>(file);
    for (const t of terms) {
      const [term, reading, pattern, , , content] = t;
      const text = flattenContent(content).join('');
      const firstLine = text.split('\n')[0] ?? '';
      const level = normaliseLevel(firstLine);
      if (!level) continue;
      const meaning = sectionOf(text, '意味');
      const formation = sectionOf(text, '接続');
      const examplesRaw = sectionOf(text, '例文');
      const examples = examplesRaw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^[①-⑳]/.test(l))
        .map((l) => l.replace(/^[①-⑳]\s*/, ''))
        .filter(Boolean)
        .slice(0, 8)
        .map((japanese) => ({ japanese, reading: '', english: '' }));
      out.push({
        id: '',
        level,
        pattern: cleanPattern(pattern || term),
        term: term ?? '',
        reading: reading ?? '',
        meaning_en: '',
        meaning_ja: meaning,
        formation,
        explanation: meaning,
        examples,
        tags: [],
        sources: ['e-de-wakaru'],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source 3: DOJG (plain-text term bank, English explanations + translations)
// ---------------------------------------------------------------------------

function parseDojg(files: string[]): GrammarPoint[] {
  const out: GrammarPoint[] = [];
  for (const file of files) {
    const terms = readJson<YomiTerm[]>(file);
    for (const t of terms) {
      const [term, reading, , , , content] = t;
      const text = flattenContent(content).join('');
      const bracket = (label: string) => {
        const re = new RegExp(`\\[${label}\\]([\\s\\S]*?)(?=\\n\\s*\\[|$)`);
        const m = text.match(re);
        return m ? m[1].trim() : '';
      };
      const explanation = bracket('解説');
      const meaning = bracket('意味');
      const formation = bracket('接続');
      // Examples come as a Japanese line immediately followed by its English.
      const exampleText = [bracket('例文A'), bracket('例文B')].join('\n');
      const lines = exampleText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const examples: GrammarExample[] = [];
      for (let i = 0; i < lines.length; i += 1) {
        const jp = lines[i].replace(/^\([a-z]+\)[.．]?\s*/i, '').trim();
        if (!/[ぁ-んァ-ン一-龯]/.test(jp)) continue;
        const next = lines[i + 1];
        if (next && !/[ぁ-んァ-ン一-龯]/.test(next)) {
          examples.push({ japanese: jp, reading: '', english: next });
          i += 1;
        } else {
          examples.push({ japanese: jp, reading: '', english: '' });
        }
        if (examples.length >= 8) break;
      }
      const pattern = cleanPattern(term);
      if (!pattern) continue;
      out.push({
        id: '',
        level: '',
        pattern,
        term: term ?? '',
        reading: reading ?? '',
        meaning_en: meaning,
        meaning_ja: '',
        formation,
        explanation,
        examples,
        tags: ['dojg'],
        sources: ['dojg'],
      });
    }
  }
  return out;
}


// ---------------------------------------------------------------------------
// Source 4: curated supplement (data/grammar_supplement.json)
//
// The open-source sets are thin at N5 — the basics (は/が/を, ています, counters)
// are so fundamental that the scraped sites assume them. This hand-written file
// fills those in with bilingual examples and is merged first so its levels and
// English meanings win over the scraped material.
// ---------------------------------------------------------------------------

type SupplementEntry = {
  level: string;
  pattern: string;
  term?: string;
  reading?: string;
  meaning_en: string;
  formation?: string;
  explanation?: string;
  examples?: GrammarExample[];
  tags?: string[];
};

function parseSupplement(file: string): GrammarPoint[] {
  if (!fs.existsSync(file)) return [];
  return readJson<SupplementEntry[]>(file).map((e) => ({
    id: '',
    level: normaliseLevel(e.level) ?? '',
    pattern: cleanPattern(e.pattern),
    term: e.term ?? e.pattern,
    reading: e.reading ?? '',
    meaning_en: e.meaning_en,
    meaning_ja: '',
    formation: e.formation ?? '',
    explanation: e.explanation ?? '',
    examples: e.examples ?? [],
    tags: e.tags ?? [],
    sources: ['curated-supplement'],
  }));
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

function mergeInto(target: GrammarPoint, extra: GrammarPoint) {
  if (!target.level && extra.level) target.level = extra.level;
  if (!target.meaning_en && extra.meaning_en) target.meaning_en = extra.meaning_en;
  if (!target.meaning_ja && extra.meaning_ja) target.meaning_ja = extra.meaning_ja;
  if (!target.formation && extra.formation) target.formation = extra.formation;
  if (extra.explanation && extra.explanation.length > target.explanation.length) {
    target.explanation = extra.explanation;
  }
  // Prefer examples that carry an English translation.
  const seen = new Set(target.examples.map((e) => e.japanese));
  for (const ex of extra.examples) {
    if (seen.has(ex.japanese)) continue;
    seen.add(ex.japanese);
    target.examples.push(ex);
  }
  target.examples.sort((a, b) => Number(Boolean(b.english)) - Number(Boolean(a.english)));
  target.examples = target.examples.slice(0, 10);
  for (const s of extra.sources) if (!target.sources.includes(s)) target.sources.push(s);
  for (const tag of extra.tags) if (!target.tags.includes(tag)) target.tags.push(tag);
}

/** Rough topical tags derived from the pattern itself — used by the UI filters. */
function inferTags(p: GrammarPoint): string[] {
  const tags = new Set(p.tags);
  const pat = p.pattern;
  if (/です|だ$|である/.test(pat)) tags.add('copula');
  if (/は/.test(pat)) tags.add('topic-marker');
  if (/たら|ば|なら|と$/.test(pat)) tags.add('conditional');
  if (/たい|ほしい|つもり/.test(pat)) tags.add('desire-intent');
  if (/れる|られる/.test(pat)) tags.add('passive-potential');
  if (/せる|させる/.test(pat)) tags.add('causative');
  if (/そう|よう|らしい|みたい/.test(pat)) tags.add('conjecture');
  if (/ため|ので|から/.test(pat)) tags.add('cause-reason');
  if (/けど|が|のに|ても/.test(pat)) tags.add('concession');
  if (/ながら|つつ|うちに|間/.test(pat)) tags.add('simultaneity');
  if (/敬語|ございます|いたし|なさ/.test(pat)) tags.add('keigo');
  return [...tags];
}

async function main() {
  log('Phase 0a — acquiring JLPT grammar points');
  const kyoushiFile = await download(GRAMMAR_SOURCES.nihongoKyoushi.url, GRAMMAR_SOURCES.nihongoKyoushi.filename);
  const edeFiles: string[] = [];
  for (const s of GRAMMAR_SOURCES.edewakaru) {
    try {
      edeFiles.push(await download(s.url, s.filename));
    } catch (err) {
      log(`  ✗ ${s.label}: ${(err as Error).message}`);
    }
  }
  const dojgFiles: string[] = [];
  for (const s of GRAMMAR_SOURCES.dojg) {
    try {
      dojgFiles.push(await download(s.url, s.filename));
    } catch (err) {
      log(`  ✗ ${s.label}: ${(err as Error).message}`);
    }
  }

  const supplement = parseSupplement(path.join(DATA_DIR, 'grammar_supplement.json'));
  const kyoushi = parseKyoushi(kyoushiFile);
  const ede = parseEdewakaru(edeFiles);
  const dojg = parseDojg(dojgFiles);
  log(
    `parsed  supplement=${supplement.length} nihongo-kyoushi=${kyoushi.length} ` +
      `e-de-wakaru=${ede.length} dojg=${dojg.length}`,
  );

  const byKey = new Map<string, GrammarPoint>();
  const add = (points: GrammarPoint[]) => {
    for (const p of points) {
      if (!p.pattern) continue;
      const key = normaliseKey(p.pattern) || normaliseKey(p.term);
      if (!key) continue;
      const existing = byKey.get(key);
      if (existing) mergeInto(existing, p);
      else byKey.set(key, { ...p, examples: [...p.examples] });
    }
  };
  // Order matters: the curated set defines levels and English meanings, the
  // JLPT-tagged scrapes come next, and DOJG only enriches what is already there.
  add(supplement);
  add(kyoushi);
  add(ede);
  add(dojg);

  const all = [...byKey.values()];
  const levelled = all.filter((p) => LEVELS.includes(p.level as (typeof LEVELS)[number]));
  const unlevelled = all.filter((p) => !LEVELS.includes(p.level as (typeof LEVELS)[number]));

  // Stable ids, numbered per level in pattern order.
  const counters: Record<string, number> = {};
  const ordered = [...levelled].sort((a, b) => {
    const li = LEVELS.indexOf(a.level as (typeof LEVELS)[number]) - LEVELS.indexOf(b.level as (typeof LEVELS)[number]);
    return li !== 0 ? li : a.pattern.localeCompare(b.pattern, 'ja');
  });
  for (const p of ordered) {
    const lv = p.level.toLowerCase();
    counters[lv] = (counters[lv] ?? 0) + 1;
    p.id = `${lv}_${String(counters[lv]).padStart(3, '0')}`;
    p.tags = inferTags(p);
  }
  for (const [i, p] of unlevelled.entries()) {
    p.level = 'NA';
    p.id = `na_${String(i + 1).padStart(3, '0')}`;
    p.tags = inferTags(p);
  }

  const final = [...ordered, ...unlevelled];
  writeJson(OUT_FILE, final);

  // --- gap report -----------------------------------------------------------
  const counts: Record<string, number> = {};
  for (const p of final) counts[p.level] = (counts[p.level] ?? 0) + 1;
  const targets: Record<string, number> = { N5: 75, N4: 150, N3: 200, N2: 250, N1: 300 };
  const noEnglish = final.filter((p) => !p.meaning_en);
  const noExamples = final.filter((p) => p.examples.length === 0);
  const noTranslatedExamples = final.filter((p) => p.examples.length > 0 && !p.examples.some((e) => e.english));

  const lines = [
    'Grammar data gaps — generated by scripts/acquire-grammar.ts',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Sources merged:',
    '  - data/grammar_supplement.json (hand-written, ships with the repo)',
    `  - ${GRAMMAR_SOURCES.nihongoKyoushi.label}`,
    `    ${GRAMMAR_SOURCES.nihongoKyoushi.url}`,
    ...GRAMMAR_SOURCES.edewakaru.map((s) => `  - ${s.label}\n    ${s.url}`),
    ...GRAMMAR_SOURCES.dojg.map((s) => `  - ${s.label}\n    ${s.url}`),
    '',
    'Coverage vs. target:',
    ...LEVELS.map((lv) => {
      const have = counts[lv] ?? 0;
      const want = targets[lv];
      const delta = have - want;
      return `  ${lv}: ${have} / ~${want} (${delta >= 0 ? '+' : ''}${delta})`;
    }),
    `  Unclassified (DOJG-only, no JLPT tag upstream): ${counts.NA ?? 0}`,
    `  TOTAL: ${final.length}`,
    '',
    'Known gaps to fill in by hand:',
    `  - ${noEnglish.length} points have no English meaning (Japanese-only upstream source).`,
    `  - ${noExamples.length} points have no example sentences at all.`,
    `  - ${noTranslatedExamples.length} points have examples but no English translations.`,
    '  - Example sentences carry no kana readings; the Reader generates furigana',
    '    on the fly with kuromoji, so this only matters for printed study lists.',
    '',
    'Points with no examples:',
    ...noExamples.slice(0, 200).map((p) => `  ${p.id}  ${p.level}  ${p.pattern}`),
    noExamples.length > 200 ? `  ... and ${noExamples.length - 200} more` : '',
    '',
    'Points with no English meaning (first 200):',
    ...noEnglish.slice(0, 200).map((p) => `  ${p.id}  ${p.level}  ${p.pattern}`),
    noEnglish.length > 200 ? `  ... and ${noEnglish.length - 200} more` : '',
    '',
  ];
  fs.writeFileSync(GAPS_FILE, lines.filter((l) => l !== undefined).join('\n'), 'utf8');
  log(`wrote   data/grammar_gaps.txt`);

  log('--- grammar acquisition summary ---');
  for (const lv of [...LEVELS, 'NA']) log(`  ${lv}: ${counts[lv] ?? 0}`);
  log(`  total: ${final.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
