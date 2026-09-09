import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dueCards, previewIntervals } from '@/lib/srs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') ?? 60);
  const cards = dueCards(limit);

  // Pitch accent lives on the dictionary row, not the card, so it stays correct
  // when the pitch data is reimported.
  const vocabIds = [...new Set(cards.filter((c) => c.node_type === 'vocabulary' && c.ref_id).map((c) => c.ref_id))];
  const pitch = new Map<number, { pattern: string | null; position: number | null }>();
  if (vocabIds.length) {
    const rows = db
      .prepare(
        `SELECT id, pitch_accent_pattern, pitch_accent_position
         FROM vocabulary WHERE id IN (${vocabIds.map(() => '?').join(',')})`,
      )
      .all(...vocabIds) as { id: number; pitch_accent_pattern: string | null; pitch_accent_position: number | null }[];
    for (const row of rows) {
      pitch.set(row.id, { pattern: row.pitch_accent_pattern, position: row.pitch_accent_position });
    }
  }

  return NextResponse.json({
    cards: cards.map((card) => ({
      ...card,
      intervals: previewIntervals(card),
      pitch: card.ref_id ? (pitch.get(card.ref_id) ?? null) : null,
    })),
  });
}
