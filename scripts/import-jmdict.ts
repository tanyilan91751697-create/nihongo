/**
 * Import JMdict into the vocabulary table.
 *
 * Primary source is the canonical JMdict_e.gz from EDRDG, parsed as a stream
 * (the file is ~60 MB gzipped and does not fit comfortably in memory). When
 * that host is unreachable — some networks and CI sandboxes block it — the
 * importer falls back to a JMdict-derived JSON mirror so `npm run setup` still
 * produces a usable dictionary.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import sax from 'sax';
import Database from 'better-sqlite3';
import { download, log, readJson } from './lib/http';
import { stripCustomEntities } from './lib/xml';
import { JMDICT_SOURCES, JMDICT_MIRROR_PARTS } from './lib/sources';

const DB_PATH = path.join(process.cwd(), 'db', 'nihongo.db');

export type VocabRow = {
  ent_seq: number | null;
  kanji: string | null;
  kanji_all: string | null;
  reading: string;
  reading_all: string | null;
  glosses: string;
  pos: string | null;
  priority: string | null;
  is_common: number;
  source: string;
};

function openDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = OFF');
  return db;
}

function makeInserter(db: Database.Database, sourceLabel: string) {
  const stmt = db.prepare(`
    INSERT INTO vocabulary (ent_seq, kanji, kanji_all, reading, reading_all, glosses, pos, priority, is_common, source)
    VALUES (@ent_seq, @kanji, @kanji_all, @reading, @reading_all, @glosses, @pos, @priority, @is_common, @source)
    ON CONFLICT(ent_seq) DO UPDATE SET
      kanji = excluded.kanji, kanji_all = excluded.kanji_all,
      reading = excluded.reading, reading_all = excluded.reading_all,
      glosses = excluded.glosses, pos = excluded.pos,
      priority = excluded.priority, is_common = excluded.is_common,
      source = excluded.source
  `);
  const insertMany = db.transaction((rows: VocabRow[]) => {
    for (const row of rows) stmt.run({ ...row, source: sourceLabel });
  });
  return insertMany;
}

// ---------------------------------------------------------------------------
// Canonical path: streaming JMdict XML
// ---------------------------------------------------------------------------

async function importFromXml(file: string, sourceUrl: string): Promise<number> {
  const db = openDb();
  const insertMany = makeInserter(db, `jmdict:${path.basename(sourceUrl)}`);

  let count = 0;
  let batch: VocabRow[] = [];

  // Per-entry accumulators.
  let entSeq: number | null = null;
  let kebs: string[] = [];
  let rebs: string[] = [];
  let glosses: string[] = [];
  let pos = new Set<string>();
  let priorities = new Set<string>();
  let text = '';

  const parser = sax.createStream(false, { trim: true, lowercase: true });

  parser.on('opentag', (node) => {
    text = '';
    if (node.name === 'entry') {
      entSeq = null;
      kebs = [];
      rebs = [];
      glosses = [];
      pos = new Set();
      priorities = new Set();
    }
  });

  parser.on('text', (t) => {
    text += t;
  });
  parser.on('cdata', (t) => {
    text += t;
  });

  parser.on('closetag', (name) => {
    const value = text.trim();
    switch (name) {
      case 'ent_seq':
        entSeq = Number(value) || null;
        break;
      case 'keb':
        if (value) kebs.push(value);
        break;
      case 'reb':
        if (value) rebs.push(value);
        break;
      case 'gloss':
        if (value) glosses.push(value);
        break;
      case 'pos':
        if (value) pos.add(value);
        break;
      case 'ke_pri':
      case 're_pri':
        if (value) priorities.add(value);
        break;
      case 'entry': {
        if (rebs.length && glosses.length) {
          const priority = [...priorities].join(',');
          batch.push({
            ent_seq: entSeq,
            kanji: kebs[0] ?? null,
            kanji_all: kebs.length ? kebs.join('\t') : null,
            reading: rebs[0],
            reading_all: rebs.join('\t'),
            glosses: glosses.join('\n'),
            pos: [...pos].join(',') || null,
            priority: priority || null,
            is_common: /news1|ichi1|spec1|spec2|gai1/.test(priority) ? 1 : 0,
            source: '',
          });
          count += 1;
        }
        if (batch.length >= 2000) {
          insertMany(batch);
          batch = [];
          if (count % 20000 === 0) log(`  … ${count.toLocaleString()} entries`);
        }
        break;
      }
      default:
        break;
    }
    text = '';
  });

  await new Promise<void>((resolve, reject) => {
    parser.on('error', reject);
    parser.on('end', resolve);
    fs.createReadStream(file)
      .pipe(zlib.createGunzip())
      .pipe(stripCustomEntities())
      .pipe(parser)
      .on('error', reject);
  });

  if (batch.length) insertMany(batch);
  db.prepare('INSERT INTO import_meta (dataset, source_url, row_count, notes) VALUES (?, ?, ?, ?)').run(
    'jmdict',
    sourceUrl,
    count,
    'streaming XML import',
  );
  db.close();
  return count;
}

// ---------------------------------------------------------------------------
// Fallback path: JMdict-derived JSON mirror
// ---------------------------------------------------------------------------

type MirrorEntry = {
  kanji: string;
  reading: string;
  pos: string;
  glossary_en: string[];
  sequence: number;
};

const HAS_JAPANESE = /[぀-ヿ㐀-䶿一-鿿]/;

async function importFromMirror(): Promise<number> {
  const db = openDb();
  const insertMany = makeInserter(db, 'jmdict-mirror');
  let count = 0;
  const seen = new Set<number>();

  for (const part of JMDICT_MIRROR_PARTS) {
    const file = await download(part.url, part.filename);
    const entries = readJson<MirrorEntry[]>(file);
    const rows: VocabRow[] = [];
    for (const e of entries) {
      const reading = (e.reading || e.kanji || '').trim();
      if (!reading) continue;
      // The mirror mixes Tatoeba example pairs into the gloss array as a
      // Japanese sentence followed by its English translation. Drop both: a
      // sentence is not a gloss, and its translation would read as one.
      const glosses: string[] = [];
      let skipTranslation = false;
      for (const gloss of e.glossary_en ?? []) {
        if (!gloss) continue;
        if (HAS_JAPANESE.test(gloss)) {
          skipTranslation = true;
          continue;
        }
        if (skipTranslation) {
          skipTranslation = false;
          continue;
        }
        glosses.push(gloss);
      }
      if (!glosses.length) continue;
      const seq = Number(e.sequence) || null;
      if (seq !== null) {
        if (seen.has(seq)) continue;
        seen.add(seq);
      }
      // "1 n" → part of speech marker with a sense number prefix.
      const posTag = (e.pos ?? '').replace(/^\d+\s*/, '').trim();
      rows.push({
        ent_seq: seq,
        kanji: e.kanji && e.kanji !== reading ? e.kanji : null,
        kanji_all: e.kanji && e.kanji !== reading ? e.kanji : null,
        reading,
        reading_all: reading,
        glosses: glosses.join('\n'),
        pos: posTag || null,
        priority: null,
        is_common: 0,
        source: '',
      });
      count += 1;
      if (rows.length >= 5000) {
        insertMany(rows.splice(0, rows.length));
        log(`  … ${count.toLocaleString()} entries`);
      }
    }
    if (rows.length) insertMany(rows);
  }

  db.prepare('INSERT INTO import_meta (dataset, source_url, row_count, notes) VALUES (?, ?, ?, ?)').run(
    'jmdict',
    JMDICT_MIRROR_PARTS[0].url,
    count,
    'JMdict-derived JSON mirror (EDRDG host unreachable)',
  );
  db.close();
  return count;
}

export async function importJmdict(): Promise<{ count: number; source: string }> {
  log('Importing JMdict — this takes a few minutes');
  for (const source of JMDICT_SOURCES) {
    try {
      const file = await download(source.url, source.filename);
      const count = await importFromXml(file, source.url);
      log(`JMdict import complete: ${count.toLocaleString()} entries from ${source.label}`);
      return { count, source: source.label };
    } catch (err) {
      log(`  ✗ ${source.label}: ${(err as Error).message}`);
    }
  }
  log('  EDRDG unreachable — falling back to the JMdict-derived JSON mirror');
  const count = await importFromMirror();
  log(`JMdict import complete: ${count.toLocaleString()} entries from the mirror`);
  return { count, source: 'jmdict-mirror' };
}

if (process.argv[1] && process.argv[1].endsWith('import-jmdict.ts')) {
  importJmdict().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
