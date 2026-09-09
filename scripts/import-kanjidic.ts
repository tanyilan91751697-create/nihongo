/**
 * Import KANJIDIC2 into the kanji table.
 *
 * As with JMdict the canonical source is EDRDG; when that host is unreachable
 * the importer falls back to a KANJIDIC-derived JSON mirror that additionally
 * carries modern (post-2010) JLPT levels.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import sax from 'sax';
import Database from 'better-sqlite3';
import { download, log, readJson } from './lib/http';
import { stripCustomEntities } from './lib/xml';
import { KANJIDIC_SOURCES, KANJIDIC_MIRROR } from './lib/sources';

const DB_PATH = path.join(process.cwd(), 'db', 'nihongo.db');

type KanjiRow = {
  character: string;
  on_readings: string | null;
  kun_readings: string | null;
  meanings: string | null;
  stroke_count: number | null;
  jlpt_level: string | null;
  grade: number | null;
  frequency: number | null;
  radical: string | null;
  source: string;
};

/** KANJIDIC ships the pre-2010 four-level JLPT scale; map it onto N5..N1. */
const OLD_JLPT_TO_NEW: Record<string, string> = { '4': 'N5', '3': 'N4', '2': 'N2', '1': 'N1' };

function openDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

function makeInserter(db: Database.Database) {
  const stmt = db.prepare(`
    INSERT INTO kanji (character, on_readings, kun_readings, meanings, stroke_count, jlpt_level, grade, frequency, radical, source)
    VALUES (@character, @on_readings, @kun_readings, @meanings, @stroke_count, @jlpt_level, @grade, @frequency, @radical, @source)
    ON CONFLICT(character) DO UPDATE SET
      on_readings = excluded.on_readings, kun_readings = excluded.kun_readings,
      meanings = excluded.meanings, stroke_count = excluded.stroke_count,
      jlpt_level = COALESCE(excluded.jlpt_level, kanji.jlpt_level),
      grade = excluded.grade, frequency = excluded.frequency,
      radical = excluded.radical, source = excluded.source
  `);
  return db.transaction((rows: KanjiRow[]) => {
    for (const row of rows) stmt.run(row);
  });
}

async function importFromXml(file: string, sourceUrl: string): Promise<number> {
  const db = openDb();
  const insertMany = makeInserter(db);
  let count = 0;
  let batch: KanjiRow[] = [];

  let literal = '';
  let on: string[] = [];
  let kun: string[] = [];
  let meanings: string[] = [];
  let strokes: number | null = null;
  let grade: number | null = null;
  let freq: number | null = null;
  let jlpt: string | null = null;
  let radical: string | null = null;
  let text = '';
  let readingType = '';
  let meaningLang = '';
  let radType = '';

  const parser = sax.createStream(false, { trim: true, lowercase: true });

  parser.on('opentag', (node) => {
    text = '';
    const attrs = node.attributes as Record<string, string>;
    if (node.name === 'character') {
      literal = '';
      on = [];
      kun = [];
      meanings = [];
      strokes = grade = freq = null;
      jlpt = null;
      radical = null;
    } else if (node.name === 'reading') {
      readingType = attrs.r_type ?? '';
    } else if (node.name === 'meaning') {
      meaningLang = attrs.m_lang ?? 'en';
    } else if (node.name === 'rad_value') {
      radType = attrs.rad_type ?? '';
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
      case 'literal':
        literal = value;
        break;
      case 'reading':
        if (readingType === 'ja_on' && value) on.push(value);
        else if (readingType === 'ja_kun' && value) kun.push(value);
        break;
      case 'meaning':
        if (meaningLang === 'en' && value) meanings.push(value);
        break;
      case 'stroke_count':
        if (strokes === null) strokes = Number(value) || null;
        break;
      case 'grade':
        grade = Number(value) || null;
        break;
      case 'freq':
        freq = Number(value) || null;
        break;
      case 'jlpt':
        jlpt = OLD_JLPT_TO_NEW[value] ?? null;
        break;
      case 'rad_value':
        if (radType === 'classical' && !radical) radical = value;
        break;
      case 'character':
        if (literal) {
          batch.push({
            character: literal,
            on_readings: on.join(',') || null,
            kun_readings: kun.join(',') || null,
            meanings: meanings.join(', ') || null,
            stroke_count: strokes,
            jlpt_level: jlpt,
            grade,
            frequency: freq,
            radical,
            source: 'kanjidic2',
          });
          count += 1;
        }
        if (batch.length >= 1000) {
          insertMany(batch);
          batch = [];
          log(`  … ${count.toLocaleString()} kanji`);
        }
        break;
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
    'kanjidic2',
    sourceUrl,
    count,
    'streaming XML import; JLPT levels mapped from the old four-level scale',
  );
  db.close();
  return count;
}

type MirrorKanji = {
  strokes?: number;
  grade?: number;
  freq?: number;
  jlpt_old?: number;
  jlpt_new?: number;
  meanings?: string[];
  readings_on?: string[];
  readings_kun?: string[];
};

async function importFromMirror(): Promise<number> {
  const db = openDb();
  const insertMany = makeInserter(db);
  const file = await download(KANJIDIC_MIRROR.url, KANJIDIC_MIRROR.filename);
  const data = readJson<Record<string, MirrorKanji>>(file);
  const rows: KanjiRow[] = [];
  for (const [character, k] of Object.entries(data)) {
    rows.push({
      character,
      on_readings: (k.readings_on ?? []).join(',') || null,
      kun_readings: (k.readings_kun ?? []).join(',') || null,
      meanings: (k.meanings ?? []).join(', ') || null,
      stroke_count: k.strokes ?? null,
      jlpt_level: k.jlpt_new ? `N${k.jlpt_new}` : k.jlpt_old ? OLD_JLPT_TO_NEW[String(k.jlpt_old)] ?? null : null,
      grade: k.grade ?? null,
      frequency: k.freq ?? null,
      radical: null,
      source: 'kanji-data-mirror',
    });
  }
  insertMany(rows);
  db.prepare('INSERT INTO import_meta (dataset, source_url, row_count, notes) VALUES (?, ?, ?, ?)').run(
    'kanjidic2',
    KANJIDIC_MIRROR.url,
    rows.length,
    'KANJIDIC-derived JSON mirror (EDRDG host unreachable); carries modern JLPT levels',
  );
  db.close();
  return rows.length;
}

export async function importKanjidic(): Promise<{ count: number; source: string }> {
  log('Importing KANJIDIC2');
  for (const source of KANJIDIC_SOURCES) {
    try {
      const file = await download(source.url, source.filename);
      const count = await importFromXml(file, source.url);
      log(`KANJIDIC import complete: ${count.toLocaleString()} kanji from ${source.label}`);
      return { count, source: source.label };
    } catch (err) {
      log(`  ✗ ${source.label}: ${(err as Error).message}`);
    }
  }
  log('  EDRDG unreachable — falling back to the KANJIDIC-derived JSON mirror');
  const count = await importFromMirror();
  log(`KANJIDIC import complete: ${count.toLocaleString()} kanji from the mirror`);
  return { count, source: KANJIDIC_MIRROR.label };
}

if (process.argv[1] && process.argv[1].endsWith('import-kanjidic.ts')) {
  importKanjidic().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
