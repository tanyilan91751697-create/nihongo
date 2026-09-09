/**
 * Load data/seed_chunks.json (built in Phase 0) into the chunks table.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { log, readJson } from './lib/http';

const DB_PATH = path.join(process.cwd(), 'db', 'nihongo.db');
const SOURCE = path.join(process.cwd(), 'data', 'seed_chunks.json');

type SeedChunk = {
  phrase: string;
  reading?: string;
  meaning?: string;
  jlpt_level?: string;
  topic_tags?: string[];
};

export function importChunks(): number {
  if (!fs.existsSync(SOURCE)) {
    throw new Error('data/seed_chunks.json is missing — run `npm run generate:chunks` first.');
  }
  const chunks = readJson<SeedChunk[]>(SOURCE);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  const stmt = db.prepare(`
    INSERT INTO chunks (phrase, reading, meaning, jlpt_level, topic_tags, source, island_id)
    VALUES (@phrase, @reading, @meaning, @jlpt_level, @topic_tags, 'seed', NULL)
    ON CONFLICT(phrase, source, island_id) DO UPDATE SET
      reading = excluded.reading, meaning = excluded.meaning,
      jlpt_level = excluded.jlpt_level, topic_tags = excluded.topic_tags
  `);
  const insertMany = db.transaction((rows: SeedChunk[]) => {
    for (const c of rows) {
      stmt.run({
        phrase: c.phrase,
        reading: c.reading ?? null,
        meaning: c.meaning ?? null,
        jlpt_level: c.jlpt_level ?? null,
        topic_tags: (c.topic_tags ?? []).join(','),
      });
    }
  });
  insertMany(chunks);
  db.prepare('INSERT INTO import_meta (dataset, source_url, row_count, notes) VALUES (?, ?, ?, ?)').run(
    'chunks',
    'data/seed_chunks.json',
    chunks.length,
    'seed collocations generated in Phase 0',
  );
  db.close();
  log(`Chunk import complete: ${chunks.length} chunks`);
  return chunks.length;
}

if (process.argv[1] && process.argv[1].endsWith('import-chunks.ts')) {
  importChunks();
}
