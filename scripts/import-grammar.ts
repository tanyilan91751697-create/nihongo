/**
 * Load data/grammar_points.json (built in Phase 0) into the grammar_points table.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { log, readJson } from './lib/http';

const DB_PATH = path.join(process.cwd(), 'db', 'nihongo.db');
const SOURCE = path.join(process.cwd(), 'data', 'grammar_points.json');

type GrammarPointFile = {
  id: string;
  level: string;
  pattern: string;
  term?: string;
  reading?: string;
  meaning_en?: string;
  meaning_ja?: string;
  formation?: string;
  explanation?: string;
  examples?: { japanese: string; reading: string; english: string }[];
  tags?: string[];
  sources?: string[];
};

export function importGrammar(): number {
  if (!fs.existsSync(SOURCE)) {
    throw new Error('data/grammar_points.json is missing — run `npm run acquire:grammar` first.');
  }
  const points = readJson<GrammarPointFile[]>(SOURCE);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  const stmt = db.prepare(`
    INSERT INTO grammar_points (slug, level, pattern, term, reading, meaning_en, meaning_ja, formation, explanation, examples_json, tags, sources)
    VALUES (@slug, @level, @pattern, @term, @reading, @meaning_en, @meaning_ja, @formation, @explanation, @examples_json, @tags, @sources)
    ON CONFLICT(slug) DO UPDATE SET
      level = excluded.level, pattern = excluded.pattern, term = excluded.term,
      reading = excluded.reading, meaning_en = excluded.meaning_en,
      meaning_ja = excluded.meaning_ja, formation = excluded.formation,
      explanation = excluded.explanation, examples_json = excluded.examples_json,
      tags = excluded.tags, sources = excluded.sources
  `);
  const insertMany = db.transaction((rows: GrammarPointFile[]) => {
    for (const p of rows) {
      stmt.run({
        slug: p.id,
        level: p.level,
        pattern: p.pattern,
        term: p.term ?? null,
        reading: p.reading ?? null,
        meaning_en: p.meaning_en ?? null,
        meaning_ja: p.meaning_ja ?? null,
        formation: p.formation ?? null,
        explanation: p.explanation ?? null,
        examples_json: JSON.stringify(p.examples ?? []),
        tags: (p.tags ?? []).join(','),
        sources: (p.sources ?? []).join(','),
      });
    }
  });
  insertMany(points);
  db.prepare('INSERT INTO import_meta (dataset, source_url, row_count, notes) VALUES (?, ?, ?, ?)').run(
    'grammar_points',
    'data/grammar_points.json',
    points.length,
    'merged from the Phase 0 grammar acquisition',
  );
  const byLevel = db
    .prepare('SELECT level, COUNT(*) AS n FROM grammar_points GROUP BY level ORDER BY level')
    .all() as { level: string; n: number }[];
  db.close();
  log(`Grammar import complete: ${points.length} points`);
  for (const r of byLevel) log(`  ${r.level}: ${r.n}`);
  return points.length;
}

if (process.argv[1] && process.argv[1].endsWith('import-grammar.ts')) {
  importGrammar();
}
