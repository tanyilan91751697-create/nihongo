import { NextResponse } from 'next/server';
import { db, logActivity } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const islandId = Number(id);
  const island = db.prepare('SELECT * FROM islands WHERE id = ?').get(islandId);
  if (!island) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    island,
    drills: db.prepare('SELECT * FROM island_drills WHERE island_id = ? ORDER BY created_at DESC').all(islandId),
    tools: db.prepare('SELECT * FROM communication_tools WHERE island_id = ? ORDER BY kind, id').all(islandId),
    chunks: db.prepare('SELECT * FROM chunks WHERE island_id = ? ORDER BY id').all(islandId),
    sessions: db
      .prepare('SELECT * FROM speaking_sessions WHERE island_id = ? ORDER BY created_at DESC')
      .all(islandId),
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const islandId = Number(id);
  const body = (await request.json()) as Record<string, unknown>;
  const fields = [
    'topic',
    'status',
    'register',
    'l1_script',
    'l2_translation',
    'verified_version',
    'notes',
    'last_practiced_at',
  ] as const;
  const updates = fields.filter((f) => body[f] !== undefined);
  if (!updates.length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  db.prepare(
    `UPDATE islands SET ${updates.map((f) => `${f} = @${f}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`,
  ).run({ id: islandId, ...Object.fromEntries(updates.map((f) => [f, body[f] ?? null])) });

  if (body.status) {
    logActivity({
      activity: 'island_stage',
      strand: 'output',
      ref_table: 'islands',
      ref_id: islandId,
      detail: String(body.status),
      minutes: 5,
    });
  }
  return NextResponse.json({ island: db.prepare('SELECT * FROM islands WHERE id = ?').get(islandId) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  db.prepare('DELETE FROM islands WHERE id = ?').run(Number(id));
  return NextResponse.json({ ok: true });
}
