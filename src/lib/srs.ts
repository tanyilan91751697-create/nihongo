import { fsrs, generatorParameters, createEmptyCard, Rating, State, type Card as FsrsCard } from 'ts-fsrs';
import { db, logActivity } from './db';

/**
 * FSRS scheduling.
 *
 * The scheduler state lives on the srs_cards row (stability, difficulty, reps,
 * lapses, due, stage) rather than in a separate table, so a review is a read of
 * those columns, one ts-fsrs call, and a write back plus a row in srs_reviews.
 */

const scheduler = fsrs(
  generatorParameters({
    enable_fuzz: true,
    maximum_interval: 365 * 4,
  }),
);

export type CardRow = {
  id: number;
  card_type: 'recognition' | 'production';
  node_type: string;
  ref_id: number | null;
  front: string;
  back: string;
  reading: string | null;
  context_sentence: string | null;
  context_translation: string | null;
  audio_path: string | null;
  source: string;
  source_id: number | null;
  source_label: string | null;
  stage: 'new' | 'learning' | 'review' | 'relearning';
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  last_review: string | null;
  suspended: number;
  created_at: string;
};

const STATE_TO_STAGE: Record<number, CardRow['stage']> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

const STAGE_TO_STATE: Record<CardRow['stage'], State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

/** SQLite stores timestamps as 'YYYY-MM-DD HH:MM:SS' in UTC. */
export function toSqlDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function fromSqlDate(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}${value.endsWith('Z') ? '' : 'Z'}`);
}

function rowToFsrsCard(row: CardRow): FsrsCard {
  return {
    due: fromSqlDate(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    state: STAGE_TO_STATE[row.stage],
    last_review: row.last_review ? fromSqlDate(row.last_review) : undefined,
    learning_steps: 0,
  } as FsrsCard;
}

export type NewCardInput = {
  card_type?: 'recognition' | 'production';
  node_type?: string;
  ref_id?: number | null;
  front: string;
  back: string;
  reading?: string | null;
  context_sentence?: string | null;
  context_translation?: string | null;
  audio_path?: string | null;
  source?: string;
  source_id?: number | null;
  source_label?: string | null;
};

export function createCard(input: NewCardInput): CardRow {
  const empty = createEmptyCard(new Date());
  const info = db
    .prepare(
      `INSERT INTO srs_cards
        (card_type, node_type, ref_id, front, back, reading, context_sentence, context_translation,
         audio_path, source, source_id, source_label, stage, due, stability, difficulty)
       VALUES
        (@card_type, @node_type, @ref_id, @front, @back, @reading, @context_sentence, @context_translation,
         @audio_path, @source, @source_id, @source_label, 'new', @due, @stability, @difficulty)`,
    )
    .run({
      card_type: input.card_type ?? 'recognition',
      node_type: input.node_type ?? 'vocabulary',
      ref_id: input.ref_id ?? null,
      front: input.front,
      back: input.back,
      reading: input.reading ?? null,
      context_sentence: input.context_sentence ?? null,
      context_translation: input.context_translation ?? null,
      audio_path: input.audio_path ?? null,
      source: input.source ?? 'manual',
      source_id: input.source_id ?? null,
      source_label: input.source_label ?? null,
      due: toSqlDate(empty.due),
      stability: empty.stability,
      difficulty: empty.difficulty,
    });
  return getCard(Number(info.lastInsertRowid))!;
}

export function getCard(id: number): CardRow | undefined {
  return db.prepare('SELECT * FROM srs_cards WHERE id = ?').get(id) as CardRow | undefined;
}

/** Cards whose due date has passed, hardest-first within a stage. */
export function dueCards(limit = 100): CardRow[] {
  return db
    .prepare(
      `SELECT * FROM srs_cards
       WHERE suspended = 0 AND due <= datetime('now')
       ORDER BY CASE stage WHEN 'relearning' THEN 0 WHEN 'learning' THEN 1 WHEN 'review' THEN 2 ELSE 3 END,
                due ASC
       LIMIT ?`,
    )
    .all(limit) as CardRow[];
}

export type ReviewOutcome = {
  card: CardRow;
  intervalDays: number;
  due: Date;
};

/** Preview what each rating would do, for the interval hints on the buttons. */
export function previewIntervals(card: CardRow, now = new Date()): Record<number, { due: Date; days: number }> {
  const log = scheduler.repeat(rowToFsrsCard(card), now);
  const out: Record<number, { due: Date; days: number }> = {};
  const grades = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;
  for (const rating of grades) {
    const next = log[rating].card;
    out[rating] = {
      due: new Date(next.due),
      days: next.scheduled_days,
    };
  }
  return out;
}

export function reviewCard(cardId: number, rating: 1 | 2 | 3 | 4, durationMs?: number): ReviewOutcome {
  const card = getCard(cardId);
  if (!card) throw new Error(`No SRS card with id ${cardId}`);
  const now = new Date();
  const grade = rating as Exclude<Rating, Rating.Manual>;
  const result = scheduler.repeat(rowToFsrsCard(card), now)[grade];
  const next = result.card;

  const apply = db.transaction(() => {
    db.prepare(
      `UPDATE srs_cards SET
         stage = @stage, due = @due, stability = @stability, difficulty = @difficulty,
         elapsed_days = @elapsed_days, scheduled_days = @scheduled_days,
         reps = @reps, lapses = @lapses, last_review = @last_review
       WHERE id = @id`,
    ).run({
      id: cardId,
      stage: STATE_TO_STAGE[next.state],
      due: toSqlDate(new Date(next.due)),
      stability: next.stability,
      difficulty: next.difficulty,
      elapsed_days: next.elapsed_days,
      scheduled_days: next.scheduled_days,
      reps: next.reps,
      lapses: next.lapses,
      last_review: toSqlDate(now),
    });
    db.prepare(
      `INSERT INTO srs_reviews (card_id, rating, state, reviewed_at, elapsed_days, scheduled_days, stability, difficulty, duration_ms)
       VALUES (@card_id, @rating, @state, @reviewed_at, @elapsed_days, @scheduled_days, @stability, @difficulty, @duration_ms)`,
    ).run({
      card_id: cardId,
      rating,
      state: STATE_TO_STAGE[next.state],
      reviewed_at: toSqlDate(now),
      elapsed_days: next.elapsed_days,
      scheduled_days: next.scheduled_days,
      stability: next.stability,
      difficulty: next.difficulty,
      duration_ms: durationMs ?? null,
    });
  });
  apply();

  logActivity({
    activity: 'srs_review',
    strand: 'language_focused',
    ref_table: 'srs_cards',
    ref_id: cardId,
    detail: `rating ${rating}`,
    minutes: durationMs ? durationMs / 60000 : 0.25,
  });

  return { card: getCard(cardId)!, intervalDays: next.scheduled_days, due: new Date(next.due) };
}

/**
 * Create a card only if an equivalent one is not already scheduled — the Reader
 * and the Island Workshop both add cards for the same word otherwise.
 */
export function createCardIfMissing(input: NewCardInput): { card: CardRow; created: boolean } {
  const existing = db
    .prepare(
      `SELECT * FROM srs_cards
       WHERE card_type = ? AND node_type = ? AND front = ?
       LIMIT 1`,
    )
    .get(input.card_type ?? 'recognition', input.node_type ?? 'vocabulary', input.front) as CardRow | undefined;
  if (existing) return { card: existing, created: false };
  return { card: createCard(input), created: true };
}

export function srsStats() {
  const byStage = db
    .prepare('SELECT stage, COUNT(*) AS n FROM srs_cards GROUP BY stage')
    .all() as { stage: string; n: number }[];
  const bySource = db
    .prepare('SELECT source, COUNT(*) AS n FROM srs_cards GROUP BY source ORDER BY n DESC')
    .all() as { source: string; n: number }[];
  const due = (
    db
      .prepare("SELECT COUNT(*) AS n FROM srs_cards WHERE suspended = 0 AND due <= datetime('now')")
      .get() as { n: number }
  ).n;
  const total = (db.prepare('SELECT COUNT(*) AS n FROM srs_cards').get() as { n: number }).n;
  const mature = (
    db.prepare("SELECT COUNT(*) AS n FROM srs_cards WHERE stage = 'review' AND stability >= 21").get() as {
      n: number;
    }
  ).n;
  const daily = db
    .prepare(
      `SELECT date(reviewed_at) AS day, COUNT(*) AS n
       FROM srs_reviews
       WHERE reviewed_at >= datetime('now', '-30 days')
       GROUP BY day ORDER BY day`,
    )
    .all() as { day: string; n: number }[];
  const upcoming = db
    .prepare(
      `SELECT date(due) AS day, COUNT(*) AS n
       FROM srs_cards
       WHERE suspended = 0 AND due <= datetime('now', '+14 days')
       GROUP BY day ORDER BY day`,
    )
    .all() as { day: string; n: number }[];
  return { byStage, bySource, due, total, mature, daily, upcoming };
}

export { Rating };
