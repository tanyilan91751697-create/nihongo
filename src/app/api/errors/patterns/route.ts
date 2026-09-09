import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ErrorRow = {
  id: number;
  occurred_at: string;
  attempted: string;
  error_text: string | null;
  corrected: string;
  category: string;
  grammar_point_id: number | null;
  grammar_pattern: string | null;
};

/**
 * Particle confusions are the pattern worth naming precisely: knowing that
 * eight errors were "に vs で" is actionable in a way that "8 particle errors"
 * is not. This finds which particle was swapped for which by comparing the
 * attempt with the correction.
 */
const PARTICLES = ['は', 'が', 'を', 'に', 'で', 'へ', 'と', 'も', 'の', 'から', 'まで', 'より', 'ば', 'や'];

function particleSwap(row: ErrorRow): string | null {
  if (row.category !== 'particle') return null;
  const before = new Set(PARTICLES.filter((p) => row.attempted.includes(p)));
  const after = new Set(PARTICLES.filter((p) => row.corrected.includes(p)));
  const removed = [...before].filter((p) => !after.has(p));
  const added = [...after].filter((p) => !before.has(p));
  if (removed.length === 1 && added.length === 1) return `${removed[0]} → ${added[0]}`;
  if (removed.length === 1) return `dropped ${removed[0]}`;
  if (added.length === 1) return `missing ${added[0]}`;
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = Number(searchParams.get('days') ?? 14);

  const byCategory = db
    .prepare('SELECT category, COUNT(*) AS n FROM errors GROUP BY category ORDER BY n DESC')
    .all() as { category: string; n: number }[];

  const overTime = db
    .prepare(
      `SELECT date(occurred_at) AS day, category, COUNT(*) AS n
       FROM errors
       WHERE occurred_at >= datetime('now', '-60 days')
       GROUP BY day, category
       ORDER BY day`,
    )
    .all() as { day: string; category: string; n: number }[];

  const recent = db
    .prepare(
      `SELECT e.*, g.pattern AS grammar_pattern
       FROM errors e
       LEFT JOIN grammar_points g ON g.id = e.grammar_point_id
       WHERE e.occurred_at >= datetime('now', ?)
       ORDER BY e.occurred_at DESC`,
    )
    .all(`-${days} days`) as ErrorRow[];

  // Group the window into named patterns: particle swaps by the pair involved,
  // grammar-linked errors by the grammar point, everything else by category.
  const groups = new Map<string, { key: string; label: string; category: string; count: number; ids: number[] }>();
  for (const row of recent) {
    const swap = particleSwap(row);
    const key = swap
      ? `particle:${swap}`
      : row.grammar_pattern
        ? `grammar:${row.grammar_pattern}`
        : `category:${row.category}`;
    const label = swap
      ? `${swap} particle errors`
      : row.grammar_pattern
        ? `${row.grammar_pattern} errors`
        : `${row.category.replace('_', ' ')} errors`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.ids.push(row.id);
    } else {
      groups.set(key, { key, label, category: row.category, count: 1, ids: [row.id] });
    }
  }

  const patterns = [...groups.values()].sort((a, b) => b.count - a.count);

  const weekly = db
    .prepare(
      `SELECT e.*, g.pattern AS grammar_pattern
       FROM errors e
       LEFT JOIN grammar_points g ON g.id = e.grammar_point_id
       WHERE e.occurred_at >= datetime('now', '-7 days')
       ORDER BY e.category, e.occurred_at DESC`,
    )
    .all() as ErrorRow[];

  return NextResponse.json({
    days,
    byCategory,
    overTime,
    patterns,
    top: patterns.slice(0, 3),
    weekly,
    total: (db.prepare('SELECT COUNT(*) AS n FROM errors').get() as { n: number }).n,
  });
}

/** Turn a detected pattern into a focused set of drill cards. */
export async function POST(request: Request) {
  const body = (await request.json()) as { ids?: number[]; label?: string };
  if (!body.ids?.length) return NextResponse.json({ error: 'ids are required' }, { status: 400 });

  const placeholders = body.ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM errors WHERE id IN (${placeholders})`)
    .all(...body.ids) as ErrorRow[];

  const insert = db.prepare(
    `INSERT INTO srs_cards (card_type, node_type, ref_id, front, back, context_sentence, source, source_id, source_label)
     VALUES ('production', 'error', @ref_id, @front, @back, @context, 'error_log', @ref_id, @label)`,
  );
  const link = db.prepare('UPDATE errors SET srs_card_id = ? WHERE id = ? AND srs_card_id IS NULL');

  let created = 0;
  const apply = db.transaction(() => {
    for (const row of rows) {
      const existing = db
        .prepare("SELECT id FROM srs_cards WHERE node_type = 'error' AND ref_id = ? AND card_type = 'production'")
        .get(row.id) as { id: number } | undefined;
      if (existing) continue;
      const info = insert.run({
        ref_id: row.id,
        front: row.attempted,
        back: row.corrected,
        context: row.error_text,
        label: body.label ? `Micro-drill — ${body.label}` : 'Micro-drill',
      });
      link.run(Number(info.lastInsertRowid), row.id);
      created += 1;
    }
  });
  apply();

  return NextResponse.json({ created });
}
