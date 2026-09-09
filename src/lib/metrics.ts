import { db } from './db';

/**
 * Dashboard calculations.
 *
 * Everything here reads from the activity log and the domain tables; nothing is
 * cached, because the whole database is a few hundred megabytes on local disk
 * and these queries run in single-digit milliseconds.
 */

export type Strand = 'input' | 'output' | 'language_focused' | 'fluency';

export const STRANDS: Strand[] = ['input', 'output', 'language_focused', 'fluency'];

export function knowledgeCoverage() {
  const vocabByLevel = db
    .prepare(
      `SELECT jlpt_level AS level, COUNT(*) AS total
       FROM vocabulary WHERE jlpt_level IS NOT NULL
       GROUP BY jlpt_level`,
    )
    .all() as { level: string; total: number }[];

  // How many words at each level the learner has actually met, by status.
  //
  // Nodes usually carry the dictionary row id, but a word the Reader could not
  // resolve is stored with ref_id NULL — match those on the written form so
  // they still count towards coverage.
  const studied = db
    .prepare(
      `SELECT v.jlpt_level AS level, k.status, COUNT(DISTINCT k.id) AS n
       FROM knowledge_nodes k
       JOIN vocabulary v
         ON v.id = k.ref_id
         OR (k.ref_id IS NULL AND (v.kanji = k.surface OR v.reading = k.surface))
       WHERE k.node_type = 'vocabulary' AND v.jlpt_level IS NOT NULL
       GROUP BY v.jlpt_level, k.status`,
    )
    .all() as { level: string; status: string; n: number }[];

  const grammarByLevel = db
    .prepare("SELECT level, COUNT(*) AS total FROM grammar_points WHERE level != 'NA' GROUP BY level")
    .all() as { level: string; total: number }[];

  const grammarSeen = db
    .prepare(
      `SELECT g.level, COUNT(DISTINCT g.id) AS n
       FROM text_grammar_encounters e
       JOIN grammar_points g ON g.id = e.grammar_point_id
       GROUP BY g.level`,
    )
    .all() as { level: string; n: number }[];

  const chunkTotal = (db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n;
  const chunkFromIslands = (
    db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE source = 'island'").get() as { n: number }
  ).n;

  return { vocabByLevel, studied, grammarByLevel, grammarSeen, chunkTotal, chunkFromIslands };
}

export function fluencyTrend(days = 30) {
  const wpm = db
    .prepare(
      `SELECT date(s.created_at) AS day, ROUND(AVG(m.wpm), 1) AS wpm, COUNT(*) AS samples
       FROM fluency_metrics m
       JOIN speaking_sessions s ON s.id = m.session_id
       WHERE m.wpm IS NOT NULL AND s.created_at >= datetime('now', ?)
       GROUP BY day ORDER BY day`,
    )
    .all(`-${days} days`) as { day: string; wpm: number; samples: number }[];

  const byPhase = db
    .prepare(
      `SELECT m.phase, ROUND(AVG(m.wpm), 1) AS wpm, ROUND(AVG(m.pause_count), 1) AS pauses, COUNT(*) AS samples
       FROM fluency_metrics m
       WHERE m.wpm IS NOT NULL
       GROUP BY m.phase ORDER BY m.phase`,
    )
    .all() as { phase: number; wpm: number; pauses: number; samples: number }[];

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(duration_sec), 0) AS seconds
       FROM speaking_sessions WHERE created_at >= datetime('now', ?)`,
    )
    .get(`-${days} days`) as { sessions: number; seconds: number };

  return { wpm, byPhase, sessions: totals.sessions, speakingMinutes: Math.round(totals.seconds / 60) };
}

/**
 * The Four Strands audit: Nation's claim is that a course should spend roughly
 * equal time on meaning-focused input, meaning-focused output, language-focused
 * learning and fluency development. Anything under 15% of the week gets a flag.
 */
export function fourStrands(days = 7) {
  const rows = db
    .prepare(
      `SELECT strand, ROUND(SUM(minutes), 1) AS minutes, COUNT(*) AS events
       FROM activity_log
       WHERE strand IS NOT NULL AND created_at >= datetime('now', ?)
       GROUP BY strand`,
    )
    .all(`-${days} days`) as { strand: Strand; minutes: number; events: number }[];

  const total = rows.reduce((sum, row) => sum + row.minutes, 0);
  const byStrand = STRANDS.map((strand) => {
    const row = rows.find((r) => r.strand === strand);
    const minutes = row?.minutes ?? 0;
    return {
      strand,
      minutes,
      events: row?.events ?? 0,
      share: total ? minutes / total : 0,
    };
  });
  const underweight = total > 0 ? byStrand.filter((s) => s.share < 0.15).map((s) => s.strand) : [];
  return { byStrand, totalMinutes: Math.round(total), underweight };
}

export function streak(): { current: number; longest: number; lastActive: string | null } {
  const days = db
    .prepare("SELECT DISTINCT date(created_at) AS day FROM activity_log ORDER BY day DESC")
    .all() as { day: string }[];
  if (!days.length) return { current: 0, longest: 0, lastActive: null };

  const dayNumbers = days.map((d) => Math.floor(new Date(`${d.day}T00:00:00Z`).getTime() / 86400000));
  const today = Math.floor(Date.now() / 86400000);

  let current = 0;
  // A streak survives "yesterday but not yet today"; it breaks after that.
  if (dayNumbers[0] === today || dayNumbers[0] === today - 1) {
    current = 1;
    for (let i = 1; i < dayNumbers.length; i += 1) {
      if (dayNumbers[i - 1] - dayNumbers[i] === 1) current += 1;
      else break;
    }
  }

  let longest = 1;
  let run = 1;
  for (let i = 1; i < dayNumbers.length; i += 1) {
    if (dayNumbers[i - 1] - dayNumbers[i] === 1) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  return { current, longest, lastActive: days[0].day };
}

export function activityTimeline(days = 7) {
  return db
    .prepare(
      `SELECT id, activity, strand, ref_table, ref_id, detail, minutes, created_at
       FROM activity_log
       WHERE created_at >= datetime('now', ?)
       ORDER BY created_at DESC LIMIT 60`,
    )
    .all(`-${days} days`) as {
    id: number;
    activity: string;
    strand: string | null;
    ref_table: string | null;
    ref_id: number | null;
    detail: string | null;
    minutes: number;
    created_at: string;
  }[];
}

export function islandPortfolio() {
  const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM islands GROUP BY status').all() as {
    status: string;
    n: number;
  }[];
  const stale = db
    .prepare(
      `SELECT id, topic, status, last_practiced_at
       FROM islands
       WHERE last_practiced_at IS NULL OR last_practiced_at < datetime('now', '-14 days')
       ORDER BY last_practiced_at IS NULL DESC, last_practiced_at ASC
       LIMIT 10`,
    )
    .all() as { id: number; topic: string; status: string; last_practiced_at: string | null }[];
  return { byStatus, stale };
}

export function errorTrends(days = 30) {
  const byCategory = db
    .prepare(
      `SELECT category, COUNT(*) AS n FROM errors
       WHERE occurred_at >= datetime('now', ?)
       GROUP BY category ORDER BY n DESC`,
    )
    .all(`-${days} days`) as { category: string; n: number }[];
  const overTime = db
    .prepare(
      `SELECT date(occurred_at) AS day, COUNT(*) AS n FROM errors
       WHERE occurred_at >= datetime('now', ?)
       GROUP BY day ORDER BY day`,
    )
    .all(`-${days} days`) as { day: string; n: number }[];
  return { byCategory, overTime };
}

/**
 * Straight-line projection of when the current pace reaches full coverage of a
 * JLPT level's vocabulary. Deliberately simple: it extrapolates the last 30
 * days of new "learning or known" words and says so in the label.
 */
export function trajectory() {
  const learnedPerDay = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM knowledge_nodes
         WHERE node_type = 'vocabulary' AND status IN ('learning', 'known')
           AND first_seen_at >= datetime('now', '-30 days')`,
      )
      .get() as { n: number }
  ).n / 30;

  const totals = db
    .prepare(
      "SELECT jlpt_level AS level, COUNT(*) AS total FROM vocabulary WHERE jlpt_level IS NOT NULL GROUP BY jlpt_level",
    )
    .all() as { level: string; total: number }[];

  // Counted over distinct dictionary rows, so two knowledge nodes pointing at
  // the same word (different readings, say) do not inflate the coverage.
  const covered = db
    .prepare(
      `SELECT v.jlpt_level AS level, COUNT(DISTINCT v.id) AS covered
       FROM knowledge_nodes k
       JOIN vocabulary v
         ON v.id = k.ref_id
         OR (k.ref_id IS NULL AND (v.kanji = k.surface OR v.reading = k.surface))
       WHERE k.node_type = 'vocabulary'
         AND k.status IN ('learning', 'known')
         AND v.jlpt_level IS NOT NULL
       GROUP BY v.jlpt_level`,
    )
    .all() as { level: string; covered: number }[];

  const levels = totals.map((row) => ({
    level: row.level,
    total: row.total,
    covered: covered.find((c) => c.level === row.level)?.covered ?? 0,
  }));

  return {
    learnedPerDay: Number(learnedPerDay.toFixed(2)),
    projections: levels
      .map((row) => {
        const remaining = Math.max(0, row.total - (row.covered ?? 0));
        const weeks = learnedPerDay > 0 ? Math.ceil(remaining / (learnedPerDay * 7)) : null;
        return { level: row.level, total: row.total, covered: row.covered ?? 0, remaining, weeks };
      })
      .sort((a, b) => a.level.localeCompare(b.level)),
  };
}

/**
 * What to do next: the strand and activity that have gone longest without
 * attention, plus whatever the SRS queue demands.
 */
export function suggestion() {
  const due = (
    db.prepare("SELECT COUNT(*) AS n FROM srs_cards WHERE suspended = 0 AND due <= datetime('now')").get() as {
      n: number;
    }
  ).n;

  const lastByStrand = db
    .prepare(
      `SELECT strand, MAX(created_at) AS last FROM activity_log WHERE strand IS NOT NULL GROUP BY strand`,
    )
    .all() as { strand: Strand; last: string }[];

  const neglected = STRANDS.map((strand) => {
    const row = lastByStrand.find((r) => r.strand === strand);
    const last = row ? new Date(`${row.last.replace(' ', 'T')}Z`).getTime() : 0;
    return { strand, last };
  }).sort((a, b) => a.last - b.last)[0];

  const label: Record<Strand, string> = {
    input: 'Read something new in the Reader',
    output: 'Run an island or a free speaking take',
    language_focused: 'Work the error log or add cards',
    fluency: 'Do a 4/3/2 set in the Oral Studio',
  };

  return {
    due,
    suggested: due > 20 ? 'Clear the SRS queue first' : label[neglected.strand],
    neglectedStrand: neglected.strand,
  };
}

export function dashboard() {
  return {
    streak: streak(),
    suggestion: suggestion(),
    coverage: knowledgeCoverage(),
    fluency: fluencyTrend(30),
    strands: fourStrands(7),
    islands: islandPortfolio(),
    errors: errorTrends(30),
    timeline: activityTimeline(7),
    trajectory: trajectory(),
  };
}
