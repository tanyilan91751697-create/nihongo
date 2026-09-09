import { NextResponse } from 'next/server';
import { reviewCard } from '@/lib/srs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json()) as { cardId?: number; rating?: number; durationMs?: number };
  if (!body.cardId || !body.rating || body.rating < 1 || body.rating > 4) {
    return NextResponse.json({ error: 'cardId and a rating of 1-4 are required' }, { status: 400 });
  }
  const outcome = reviewCard(body.cardId, body.rating as 1 | 2 | 3 | 4, body.durationMs);
  return NextResponse.json(outcome);
}
