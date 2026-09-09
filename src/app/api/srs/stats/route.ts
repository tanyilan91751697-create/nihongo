import { NextResponse } from 'next/server';
import { srsStats } from '@/lib/srs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(srsStats());
}
