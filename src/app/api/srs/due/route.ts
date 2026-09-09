import { NextResponse } from 'next/server';
import { dueCards, previewIntervals } from '@/lib/srs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') ?? 60);
  const cards = dueCards(limit);
  return NextResponse.json({
    cards: cards.map((card) => ({ ...card, intervals: previewIntervals(card) })),
  });
}
