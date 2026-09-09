import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createCardIfMissing, type NewCardInput } from '@/lib/srs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json()) as NewCardInput & { alsoProduction?: boolean };
  if (!body.front || !body.back) {
    return NextResponse.json({ error: 'front and back are required' }, { status: 400 });
  }
  const { card, created } = createCardIfMissing(body);
  let production = null;
  if (body.alsoProduction) {
    // The production card is the mirror image: prompt in English, answer in Japanese.
    const result = createCardIfMissing({
      ...body,
      card_type: 'production',
      front: body.back,
      back: body.front,
    });
    production = result.card;
  }
  return NextResponse.json({ card, created, production });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source');
  const stage = searchParams.get('stage');
  const clauses: string[] = [];
  if (source) clauses.push('source = @source');
  if (stage) clauses.push('stage = @stage');
  const rows = db
    .prepare(
      `SELECT * FROM srs_cards
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY created_at DESC LIMIT 500`,
    )
    .all({ source, stage });
  return NextResponse.json({ cards: rows });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get('id'));
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  db.prepare('DELETE FROM srs_cards WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
