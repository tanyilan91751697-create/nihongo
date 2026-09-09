/**
 * Second pass over the vocabulary table: tag entries with their JLPT level.
 *
 * The JLPT list gives word -> {reading, level}. Matching is done on the kanji
 * writing *and* the kana reading, because a list entry written in kanji has to
 * find the dictionary row whose reading agrees, and kana-only words have no
 * kanji writing at all. Where several dictionary rows match, all of them are
 * tagged: JMdict splits senses that the JLPT lists treat as one word.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { download, log, readJson } from './lib/http';
import { JLPT_VOCAB_SOURCE } from './lib/sources';

const DB_PATH = path.join(process.cwd(), 'db', 'nihongo.db');
const DATA_DIR = path.join(process.cwd(), 'data');
const SEP = '\t';

type JlptList = Record<string, { reading: string; level: number }[]>;

export async function importJlptVocab(): Promise<{ tagged: number; unmatched: number }> {
  log('Tagging vocabulary with JLPT levels');
  const file = await download(JLPT_VOCAB_SOURCE.url, JLPT_VOCAB_SOURCE.filename);
  const list = readJson<JlptList>(file);

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Cheaper than a query per candidate: pull the id/kanji/reading triples once
  // and index them in memory.
  const byKanjiReading = new Map<string, number[]>();
  const byForm = new Map<string, number[]>();
  const push = (map: Map<string, number[]>, key: string, id: number) => {
    const arr = map.get(key);
    if (arr) arr.push(id);
    else map.set(key, [id]);
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
    for (const r of readings) push(byForm, r, row.id);
    for (const k of kanjis) {
      push(byForm, k, row.id);
      for (const r of readings) push(byKanjiReading, `${k} ${r}`, row.id);
    }
  }

  // `jlpt_level > ?` keeps the easiest level when two lists disagree: level
  // strings sort so that 'N5' > 'N1', so a smaller string always wins.
  const update = db.prepare(
    'UPDATE vocabulary SET jlpt_level = ? WHERE id = ? AND (jlpt_level IS NULL OR jlpt_level > ?)',
  );
  const unmatched: string[] = [];
  let tagged = 0;

  const apply = db.transaction(() => {
    for (const [word, entries] of Object.entries(list)) {
      for (const entry of entries) {
        const level = `N${entry.level}`;
        const reading = entry.reading?.trim();
        let ids = reading ? byKanjiReading.get(`${word} ${reading}`) : undefined;
        if (!ids) ids = byForm.get(word);
        if (!ids && reading) ids = byForm.get(reading);
        if (!ids || !ids.length) {
          unmatched.push(`${word} (${reading ?? ''}) ${level}`);
          continue;
        }
        for (const id of ids) tagged += update.run(level, id, level).changes;
      }
    }
  });
  apply();

  db.prepare('INSERT INTO import_meta (dataset, source_url, row_count, notes) VALUES (?, ?, ?, ?)').run(
    'jlpt-vocab',
    JLPT_VOCAB_SOURCE.url,
    tagged,
    `${unmatched.length} list entries had no dictionary match`,
  );

  const byLevel = db
    .prepare(
      'SELECT jlpt_level AS level, COUNT(*) AS n FROM vocabulary WHERE jlpt_level IS NOT NULL GROUP BY jlpt_level ORDER BY jlpt_level DESC',
    )
    .all() as { level: string; n: number }[];
  db.close();

  if (unmatched.length) {
    fs.writeFileSync(path.join(DATA_DIR, 'jlpt_vocab_unmatched.txt'), unmatched.join('\n') + '\n', 'utf8');
    log(`  ${unmatched.length} unmatched entries written to data/jlpt_vocab_unmatched.txt`);
  }
  log(`JLPT tagging complete: ${tagged.toLocaleString()} vocabulary rows updated`);
  for (const r of byLevel) log(`  ${r.level}: ${r.n.toLocaleString()} entries`);
  return { tagged, unmatched: unmatched.length };
}

if (process.argv[1] && process.argv[1].endsWith('import-jlpt-vocab.ts')) {
  importJlptVocab().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
