import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as { kind?: string; phrase?: string; reading?: string; meaning?: string };
  if (!body.phrase?.trim()) return NextResponse.json({ error: 'phrase is required' }, { status: 400 });
  const info = db
    .prepare('INSERT INTO communication_tools (island_id, kind, phrase, reading, meaning) VALUES (?, ?, ?, ?, ?)')
    .run(Number(id), body.kind ?? 'linking', body.phrase.trim(), body.reading ?? null, body.meaning ?? null);
  return NextResponse.json({
    tool: db.prepare('SELECT * FROM communication_tools WHERE id = ?').get(Number(info.lastInsertRowid)),
  });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as { id: number; kind?: string; phrase?: string; reading?: string; meaning?: string };
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const fields = ['kind', 'phrase', 'reading', 'meaning'] as const;
  const updates = fields.filter((f) => body[f] !== undefined);
  if (!updates.length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  db.prepare(`UPDATE communication_tools SET ${updates.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`).run({
    id: body.id,
    ...Object.fromEntries(updates.map((f) => [f, body[f] ?? null])),
  });
  return NextResponse.json({ tool: db.prepare('SELECT * FROM communication_tools WHERE id = ?').get(body.id) });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const toolId = Number(searchParams.get('tool_id'));
  if (!toolId) return NextResponse.json({ error: 'tool_id is required' }, { status: 400 });
  db.prepare('DELETE FROM communication_tools WHERE id = ?').run(toolId);
  return NextResponse.json({ ok: true });
}
