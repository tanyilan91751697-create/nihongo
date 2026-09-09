import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const text = db.prepare('SELECT * FROM texts WHERE id = ?').get(Number(id));
  if (!text) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ text });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  db.prepare('DELETE FROM texts WHERE id = ?').run(Number(id));
  return NextResponse.json({ ok: true });
}
