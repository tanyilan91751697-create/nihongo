import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim();
  const sort = searchParams.get('sort') === 'title' ? 'title ASC' : 'created_at DESC';
  const rows = db
    .prepare(
      `SELECT id, title, source_url, token_count, unique_words, level_summary, created_at,
              substr(body, 1, 120) AS preview
       FROM texts
       ${q ? 'WHERE title LIKE @q OR body LIKE @q' : ''}
       ORDER BY ${sort}
       LIMIT 200`,
    )
    .all(q ? { q: `%${q}%` } : {});
  return NextResponse.json({ texts: rows });
}
