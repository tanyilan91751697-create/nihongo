import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const sort = searchParams.get('sort') === 'practiced' ? 'last_practiced_at DESC NULLS LAST' : 'created_at DESC';
  const islands = db
    .prepare(
      `SELECT i.*,
              (SELECT COUNT(*) FROM chunks c WHERE c.island_id = i.id) AS chunk_count,
              (SELECT COUNT(*) FROM communication_tools t WHERE t.island_id = i.id) AS tool_count,
              (SELECT COUNT(*) FROM speaking_sessions s WHERE s.island_id = i.id) AS session_count
       FROM islands i
       ${status && status !== 'all' ? 'WHERE i.status = @status' : ''}
       ORDER BY ${sort}`,
    )
    .all({ status });
  return NextResponse.json({ islands });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { topic?: string; register?: string; l1_script?: string };
  if (!body.topic?.trim()) return NextResponse.json({ error: 'topic is required' }, { status: 400 });
  const info = db
    .prepare('INSERT INTO islands (topic, register, l1_script) VALUES (?, ?, ?)')
    .run(body.topic.trim(), body.register ?? 'teineigo', body.l1_script ?? null);
  return NextResponse.json({
    island: db.prepare('SELECT * FROM islands WHERE id = ?').get(Number(info.lastInsertRowid)),
  });
}
