import { NextResponse } from 'next/server';
import { db, logActivity } from '@/lib/db';
import { createCardIfMissing } from '@/lib/srs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type ErrorInput = {
  attempted: string;
  corrected: string;
  error_text?: string | null;
  category?: string;
  source_activity?: string;
  source_id?: number | null;
  notes?: string | null;
  grammar_point_id?: number | null;
  createCard?: boolean;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const source = searchParams.get('source');
  const since = searchParams.get('since');
  const clauses: string[] = [];
  if (category && category !== 'all') clauses.push('category = @category');
  if (source && source !== 'all') clauses.push('source_activity = @source');
  if (since) clauses.push("occurred_at >= datetime('now', @since)");
  const rows = db
    .prepare(
      `SELECT e.*, g.pattern AS grammar_pattern, g.level AS grammar_level
       FROM errors e
       LEFT JOIN grammar_points g ON g.id = e.grammar_point_id
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY occurred_at DESC LIMIT 500`,
    )
    .all({ category, source, since });
  return NextResponse.json({ errors: rows });
}

export async function POST(request: Request) {
  const body = (await request.json()) as ErrorInput;
  if (!body.attempted?.trim() || !body.corrected?.trim()) {
    return NextResponse.json({ error: 'attempted and corrected are required' }, { status: 400 });
  }
  const info = db
    .prepare(
      `INSERT INTO errors (source_activity, source_id, attempted, error_text, corrected, category, grammar_point_id, notes)
       VALUES (@source_activity, @source_id, @attempted, @error_text, @corrected, @category, @grammar_point_id, @notes)`,
    )
    .run({
      source_activity: body.source_activity ?? 'manual',
      source_id: body.source_id ?? null,
      attempted: body.attempted.trim(),
      error_text: body.error_text?.trim() || null,
      corrected: body.corrected.trim(),
      category: body.category ?? 'other',
      grammar_point_id: body.grammar_point_id ?? null,
      notes: body.notes?.trim() || null,
    });
  const id = Number(info.lastInsertRowid);

  let card = null;
  if (body.createCard) {
    // A production card: the prompt is what you meant to say, the answer is the
    // corrected Japanese, so the drill rehearses the fix rather than the error.
    const result = createCardIfMissing({
      card_type: 'production',
      node_type: 'error',
      ref_id: id,
      front: body.attempted.trim(),
      back: body.corrected.trim(),
      context_sentence: body.notes ?? null,
      source: 'error_log',
      source_id: id,
      source_label: `Error Log — ${body.category ?? 'other'}`,
    });
    card = result.card;
    db.prepare('UPDATE errors SET srs_card_id = ? WHERE id = ?').run(card.id, id);
  }

  logActivity({
    activity: 'error_logged',
    strand: 'language_focused',
    ref_table: 'errors',
    ref_id: id,
    detail: body.category ?? 'other',
    minutes: 1,
  });

  const row = db.prepare('SELECT * FROM errors WHERE id = ?').get(id);
  return NextResponse.json({ error: row, card });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as Partial<ErrorInput> & { id: number };
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const fields = ['attempted', 'corrected', 'error_text', 'category', 'notes', 'grammar_point_id'] as const;
  const updates = fields.filter((f) => body[f] !== undefined);
  if (!updates.length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  db.prepare(`UPDATE errors SET ${updates.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`).run({
    id: body.id,
    ...Object.fromEntries(updates.map((f) => [f, body[f] ?? null])),
  });
  return NextResponse.json({ error: db.prepare('SELECT * FROM errors WHERE id = ?').get(body.id) });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get('id'));
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  db.prepare('DELETE FROM errors WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
