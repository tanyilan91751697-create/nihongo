import { NextResponse } from 'next/server';
import { db, logActivity, type Strand } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STRAND_BY_TYPE: Record<string, Strand> = {
  '432': 'fluency',
  shadowing: 'output',
  free: 'output',
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const id = searchParams.get('id');

  if (id) {
    const session = db.prepare('SELECT * FROM speaking_sessions WHERE id = ?').get(Number(id));
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const recordings = db
      .prepare('SELECT * FROM session_recordings WHERE session_id = ? ORDER BY phase')
      .all(Number(id));
    const metrics = db.prepare('SELECT * FROM fluency_metrics WHERE session_id = ? ORDER BY phase').all(Number(id));
    return NextResponse.json({ session, recordings, metrics });
  }

  const sessions = db
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM session_recordings r WHERE r.session_id = s.id) AS recording_count,
              (SELECT ROUND(AVG(wpm), 1) FROM fluency_metrics m WHERE m.session_id = s.id) AS avg_wpm
       FROM speaking_sessions s
       ${type && type !== 'all' ? 'WHERE s.session_type = @type' : ''}
       ORDER BY s.created_at DESC LIMIT 200`,
    )
    .all({ type });
  return NextResponse.json({ sessions });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    session_type: string;
    topic?: string;
    island_id?: number | null;
    plan_notes?: string;
    target_chunks?: unknown;
    material_title?: string;
    text_id?: number | null;
    ipom_stage?: string;
    reps?: number;
    duration_sec?: number;
    notes?: string;
  };
  if (!body.session_type) return NextResponse.json({ error: 'session_type is required' }, { status: 400 });

  const info = db
    .prepare(
      `INSERT INTO speaking_sessions
        (session_type, topic, island_id, plan_notes, target_chunks, material_title, text_id, ipom_stage, reps, duration_sec, notes)
       VALUES
        (@session_type, @topic, @island_id, @plan_notes, @target_chunks, @material_title, @text_id, @ipom_stage, @reps, @duration_sec, @notes)`,
    )
    .run({
      session_type: body.session_type,
      topic: body.topic ?? null,
      island_id: body.island_id ?? null,
      plan_notes: body.plan_notes ?? null,
      target_chunks: body.target_chunks ? JSON.stringify(body.target_chunks) : null,
      material_title: body.material_title ?? null,
      text_id: body.text_id ?? null,
      ipom_stage: body.ipom_stage ?? null,
      reps: body.reps ?? null,
      duration_sec: body.duration_sec ?? 0,
      notes: body.notes ?? null,
    });
  const id = Number(info.lastInsertRowid);

  if (body.island_id) {
    db.prepare("UPDATE islands SET last_practiced_at = datetime('now') WHERE id = ?").run(body.island_id);
  }

  logActivity({
    activity: `${body.session_type}_session`,
    strand: STRAND_BY_TYPE[body.session_type] ?? 'output',
    ref_table: 'speaking_sessions',
    ref_id: id,
    detail: body.topic ?? body.material_title ?? null,
    minutes: (body.duration_sec ?? 0) / 60,
  });

  return NextResponse.json({ session: db.prepare('SELECT * FROM speaking_sessions WHERE id = ?').get(id) });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as Record<string, unknown> & { id: number };
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const fields = [
    'topic',
    'plan_notes',
    'transcript',
    'corrections',
    'notes',
    'duration_sec',
    'material_title',
    'ipom_stage',
    'reps',
    'island_id',
    'text_id',
  ] as const;
  const updates = fields.filter((f) => body[f] !== undefined);
  if (!updates.length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  db.prepare(`UPDATE speaking_sessions SET ${updates.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`).run({
    id: body.id,
    ...Object.fromEntries(updates.map((f) => [f, body[f] ?? null])),
  });
  return NextResponse.json({ session: db.prepare('SELECT * FROM speaking_sessions WHERE id = ?').get(body.id) });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get('id'));
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  db.prepare('DELETE FROM speaking_sessions WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
