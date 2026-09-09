import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const row = db
    .prepare('SELECT * FROM grammar_points WHERE slug = ? OR id = ?')
    .get(slug, Number(slug) || -1) as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let examples: unknown[] = [];
  try {
    examples = JSON.parse(String(row.examples_json ?? '[]'));
  } catch {
    examples = [];
  }
  return NextResponse.json({ point: { ...row, examples } });
}
