import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

/**
 * Single SQLite connection for the whole app.
 *
 * Next.js reloads modules on every edit in dev, so the handle is cached on
 * globalThis — otherwise each reload would leak another open file descriptor.
 */
const DB_PATH = process.env.NIHONGO_DB ?? path.join(process.cwd(), 'db', 'nihongo.db');

declare global {
  // eslint-disable-next-line no-var
  var __nihongoDb: Database.Database | undefined;
}

function open(): Database.Database {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(
      `No database at ${DB_PATH}. Run \`npm run setup\` to build it from the bundled data files.`,
    );
  }
  const database = new Database(DB_PATH);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  return database;
}

export const db: Database.Database = globalThis.__nihongoDb ?? (globalThis.__nihongoDb = open());

export type VocabularyRow = {
  id: number;
  ent_seq: number | null;
  kanji: string | null;
  kanji_all: string | null;
  reading: string;
  reading_all: string | null;
  glosses: string;
  pos: string | null;
  priority: string | null;
  is_common: number;
  jlpt_level: string | null;
  pitch_accent_pattern: string | null;
  pitch_accent_position: number | null;
};

export type KanjiRow = {
  id: number;
  character: string;
  on_readings: string | null;
  kun_readings: string | null;
  meanings: string | null;
  stroke_count: number | null;
  jlpt_level: string | null;
  grade: number | null;
  frequency: number | null;
};

export type GrammarPointRow = {
  id: number;
  slug: string;
  level: string;
  pattern: string;
  term: string | null;
  reading: string | null;
  meaning_en: string | null;
  meaning_ja: string | null;
  formation: string | null;
  explanation: string | null;
  examples_json: string;
  tags: string | null;
  sources: string | null;
};

export type ChunkRow = {
  id: number;
  phrase: string;
  reading: string | null;
  meaning: string | null;
  jlpt_level: string | null;
  topic_tags: string | null;
  source: string;
  island_id: number | null;
  created_at: string;
};

export type KnowledgeNodeRow = {
  id: number;
  node_type: string;
  ref_id: number | null;
  surface: string;
  reading: string | null;
  status: 'encountered' | 'learning' | 'known' | 'ignored';
  encounters: number;
  first_seen_at: string;
  last_seen_at: string;
  notes: string | null;
};

// ---------------------------------------------------------------------------
// Dictionary lookup
// ---------------------------------------------------------------------------

const SEP = '\t';

/**
 * Look a word up by its dictionary form and, when available, its reading.
 *
 * Ranked so the most plausible entry comes first: an exact writing+reading
 * match beats a writing-only match, common words beat rare ones, and entries
 * with a JLPT level beat untagged ones.
 */
export function lookupWord(surface: string, reading?: string | null, limit = 8): VocabularyRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM vocabulary
       WHERE kanji = @surface
          OR reading = @surface
          OR kanji_all LIKE @like
          OR reading_all LIKE @like
       LIMIT 60`,
    )
    .all({ surface, like: `%${surface}%` }) as VocabularyRow[];

  const scored = rows
    .map((row) => {
      const writings = (row.kanji_all ?? '').split(SEP).filter(Boolean);
      const readings = (row.reading_all ?? row.reading).split(SEP).filter(Boolean);
      const writingHit = row.kanji === surface || writings.includes(surface);
      const readingHit = row.reading === surface || readings.includes(surface);
      if (!writingHit && !readingHit) return null;
      let score = 0;
      if (writingHit) score += 40;
      if (readingHit) score += 30;
      if (reading && readings.includes(reading)) score += 30;
      if (row.is_common) score += 15;
      if (row.jlpt_level) score += 10;
      if (row.ent_seq) score += 2;
      return { row, score };
    })
    .filter((x): x is { row: VocabularyRow; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.row);
}

export function searchVocabulary(query: string, limit = 30): VocabularyRow[] {
  return db
    .prepare(
      `SELECT * FROM vocabulary
       WHERE kanji LIKE @q OR reading LIKE @q OR glosses LIKE @q
       ORDER BY is_common DESC, jlpt_level IS NULL, length(reading) ASC
       LIMIT @limit`,
    )
    .all({ q: `%${query}%`, limit }) as VocabularyRow[];
}

export function kanjiInfo(character: string): KanjiRow | undefined {
  return db.prepare('SELECT * FROM kanji WHERE character = ?').get(character) as KanjiRow | undefined;
}

/** Grammar examples that happen to contain a given word — used by the Reader sidebar. */
export function grammarExamplesContaining(word: string, limit = 5) {
  const rows = db
    .prepare(
      `SELECT id, slug, level, pattern, meaning_en, examples_json
       FROM grammar_points
       WHERE examples_json LIKE ?
       LIMIT ?`,
    )
    .all(`%${word}%`, limit * 4) as Pick<
    GrammarPointRow,
    'id' | 'slug' | 'level' | 'pattern' | 'meaning_en' | 'examples_json'
  >[];
  const out: {
    grammar_id: number;
    slug: string;
    level: string;
    pattern: string;
    meaning_en: string | null;
    japanese: string;
    english: string;
  }[] = [];
  for (const row of rows) {
    let examples: { japanese: string; english: string }[] = [];
    try {
      examples = JSON.parse(row.examples_json);
    } catch {
      examples = [];
    }
    for (const ex of examples) {
      if (ex.japanese?.includes(word)) {
        out.push({
          grammar_id: row.id,
          slug: row.slug,
          level: row.level,
          pattern: row.pattern,
          meaning_en: row.meaning_en,
          japanese: ex.japanese,
          english: ex.english,
        });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Knowledge graph
// ---------------------------------------------------------------------------

export function getKnowledgeNode(nodeType: string, surface: string, reading?: string | null) {
  return db
    .prepare(
      'SELECT * FROM knowledge_nodes WHERE node_type = ? AND surface = ? AND (reading IS ? OR reading = ?)',
    )
    .get(nodeType, surface, reading ?? null, reading ?? null) as KnowledgeNodeRow | undefined;
}

export function upsertKnowledgeNode(input: {
  node_type: string;
  ref_id?: number | null;
  surface: string;
  reading?: string | null;
  status?: string;
}) {
  const status = input.status ?? 'encountered';
  db.prepare(
    `INSERT INTO knowledge_nodes (node_type, ref_id, surface, reading, status)
     VALUES (@node_type, @ref_id, @surface, @reading, @status)
     ON CONFLICT(node_type, surface, reading) DO UPDATE SET
       encounters = knowledge_nodes.encounters + 1,
       last_seen_at = datetime('now'),
       ref_id = COALESCE(excluded.ref_id, knowledge_nodes.ref_id),
       status = CASE WHEN @force_status = 1 THEN excluded.status ELSE knowledge_nodes.status END`,
  ).run({
    node_type: input.node_type,
    ref_id: input.ref_id ?? null,
    surface: input.surface,
    reading: input.reading ?? null,
    status,
    force_status: input.status ? 1 : 0,
  });
  return getKnowledgeNode(input.node_type, input.surface, input.reading ?? null);
}

/** Status for many surfaces at once — the Reader needs one call per analysis. */
export function knowledgeStatusMap(surfaces: string[]): Record<string, string> {
  if (!surfaces.length) return {};
  const unique = [...new Set(surfaces)];
  const out: Record<string, string> = {};
  const chunkSize = 400;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const slice = unique.slice(i, i + chunkSize);
    const placeholders = slice.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT surface, status FROM knowledge_nodes WHERE surface IN (${placeholders})`)
      .all(...slice) as { surface: string; status: string }[];
    for (const row of rows) out[row.surface] = row.status;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Activity log — feeds the dashboard's streak, timeline and Four Strands audit
// ---------------------------------------------------------------------------

export type Strand = 'input' | 'output' | 'language_focused' | 'fluency';

export function logActivity(input: {
  activity: string;
  strand?: Strand | null;
  ref_table?: string | null;
  ref_id?: number | null;
  detail?: string | null;
  minutes?: number;
}) {
  db.prepare(
    `INSERT INTO activity_log (activity, strand, ref_table, ref_id, detail, minutes)
     VALUES (@activity, @strand, @ref_table, @ref_id, @detail, @minutes)`,
  ).run({
    activity: input.activity,
    strand: input.strand ?? null,
    ref_table: input.ref_table ?? null,
    ref_id: input.ref_id ?? null,
    detail: input.detail ?? null,
    minutes: input.minutes ?? 0,
  });
}

export function getSetting(key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, value);
}
