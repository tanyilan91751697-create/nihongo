import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json()) as {
    session_id: number;
    phase?: number;
    wpm?: number | null;
    pause_count?: number | null;
    word_count?: number | null;
    duration_sec?: number | null;
  };
  if (!body.session_id) return NextResponse.json({ error: 'session_id is required' }, { status: 400 });

  // One metric row per phase: re-saving the self-audit replaces the old values.
  db.prepare('DELETE FROM fluency_metrics WHERE session_id = ? AND phase = ?').run(
    body.session_id,
    body.phase ?? 1,
  );
  db.prepare(
    `INSERT INTO fluency_metrics (session_id, phase, wpm, pause_count, word_count, duration_sec)
     VALUES (@session_id, @phase, @wpm, @pause_count, @word_count, @duration_sec)`,
  ).run({
    session_id: body.session_id,
    phase: body.phase ?? 1,
    wpm: body.wpm ?? null,
    pause_count: body.pause_count ?? null,
    word_count: body.word_count ?? null,
    duration_sec: body.duration_sec ?? null,
  });
  return NextResponse.json({
    metrics: db.prepare('SELECT * FROM fluency_metrics WHERE session_id = ? ORDER BY phase').all(body.session_id),
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = Number(searchParams.get('session_id'));
  if (!sessionId) return NextResponse.json({ error: 'session_id is required' }, { status: 400 });
  return NextResponse.json({
    metrics: db.prepare('SELECT * FROM fluency_metrics WHERE session_id = ? ORDER BY phase').all(sessionId),
  });
}
