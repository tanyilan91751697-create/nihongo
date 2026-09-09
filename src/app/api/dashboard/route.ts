import { NextResponse } from 'next/server';
import { dashboard } from '@/lib/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(dashboard());
}
