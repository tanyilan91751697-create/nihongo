/**
 * Add pitch accent data to the vocabulary table.
 *
 * Source is the kanjium accent database, a TSV of
 *   word <TAB> reading <TAB> downstep position(s)
 * where 0 means heiban (no downstep) and n means the pitch drops after the nth
 * mora. The pattern name is derived from the position relative to the mora
 * count of the reading.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { download, log } from './lib/http';
import { PITCH_ACCENT_SOURCE } from './lib/sources';

const DB_PATH = path.join(process.cwd(), 'db', 'nihongo.db');
const SEP = '\t';

/** Small kana do not form a mora of their own (きょ is one mora, not two). */
const SMALL_KANA = new Set(['ゃ', 'ゅ', 'ょ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ャ', 'ュ', 'ョ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ']);

export function moraCount(reading: string): number {
  let n = 0;
  for (const ch of reading) if (!SMALL_KANA.has(ch)) n += 1;
  return n;
}

export function accentPattern(position: number, mora: number): string {
  if (position === 0) return 'heiban';
  if (position === 1) return 'atamadaka';
  if (position >= mora) return 'odaka';
  return 'nakadaka';
}

export async function importPitchAccent(): Promise<number> {
  log('Importing pitch accent data');
  const file = await download(PITCH_ACCENT_SOURCE.url, PITCH_ACCENT_SOURCE.filename);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Index the dictionary once by "writing reading" and by reading alone.
  const byKey = new Map<string, number[]>();
  const push = (key: string, id: number) => {
    const arr = byKey.get(key);
    if (arr) arr.push(id);
    else byKey.set(key, [id]);
  };
  const rows = db.prepare('SELECT id, kanji_all, reading_all, reading FROM vocabulary').all() as {
    id: number;
    kanji_all: string | null;
    reading_all: string | null;
    reading: string;
  }[];
  for (const row of rows) {
    const kanjis = (row.kanji_all ?? '').split(SEP).filter(Boolean);
    const readings = (row.reading_all ?? row.reading).split(SEP).filter(Boolean);
    for (const r of readings) {
      push(`=${r}`, row.id);
      for (const k of kanjis) push(`${k}=${r}`, row.id);
    }
  }

  const update = db.prepare(
    'UPDATE vocabulary SET pitch_accent_pattern = ?, pitch_accent_position = ? WHERE id = ? AND pitch_accent_pattern IS NULL',
  );

  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let updated = 0;
  let matchedTerms = 0;

  const apply = db.transaction(() => {
    for (const line of lines) {
      if (!line.trim()) continue;
      const [word, reading, positions] = line.split(SEP);
      if (!word || !positions) continue;
      // Multiple accepted accents are comma separated; take the first.
      const position = Number(positions.split(',')[0]);
      if (!Number.isFinite(position)) continue;
      const kana = (reading || word).trim();
      const pattern = accentPattern(position, moraCount(kana));
      const ids = byKey.get(`${word}=${kana}`) ?? byKey.get(`=${kana}`);
      if (!ids?.length) continue;
      matchedTerms += 1;
      for (const id of ids) updated += update.run(pattern, position, id).changes;
    }
  });
  apply();

  db.prepare('INSERT INTO import_meta (dataset, source_url, row_count, notes) VALUES (?, ?, ?, ?)').run(
    'pitch-accent',
    PITCH_ACCENT_SOURCE.url,
    updated,
    `${matchedTerms} accent entries matched a dictionary row`,
  );
  const byPattern = db
    .prepare(
      'SELECT pitch_accent_pattern AS p, COUNT(*) AS n FROM vocabulary WHERE pitch_accent_pattern IS NOT NULL GROUP BY p ORDER BY n DESC',
    )
    .all() as { p: string; n: number }[];
  db.close();
  log(`Pitch accent import complete: ${updated.toLocaleString()} vocabulary rows updated`);
  for (const r of byPattern) log(`  ${r.p}: ${r.n.toLocaleString()}`);
  return updated;
}

if (process.argv[1] && process.argv[1].endsWith('import-pitch-accent.ts')) {
  importPitchAccent().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
