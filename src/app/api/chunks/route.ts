import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Chunk bank: seed collocations plus anything extracted from islands. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const topic = searchParams.get('topic');
  const level = searchParams.get('level');
  const islandId = searchParams.get('island_id');
  const query = searchParams.get('q');
  const limit = Number(searchParams.get('limit') ?? 40);

  const clauses: string[] = [];
  if (topic && topic !== 'all') clauses.push("topic_tags LIKE '%' || @topic || '%'");
  if (level && level !== 'all') clauses.push('jlpt_level = @level');
  if (islandId) clauses.push('island_id = @islandId');
  if (query) clauses.push('(phrase LIKE @like OR meaning LIKE @like OR reading LIKE @like)');

  const chunks = db
    .prepare(
      `SELECT * FROM chunks
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY RANDOM() LIMIT @limit`,
    )
    .all({ topic, level, islandId: islandId ? Number(islandId) : null, like: `%${query}%`, limit });
  return NextResponse.json({ chunks });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    phrase: string;
    reading?: string;
    meaning?: string;
    jlpt_level?: string;
    topic_tags?: string[];
    source?: string;
    island_id?: number | null;
  };
  if (!body.phrase?.trim()) return NextResponse.json({ error: 'phrase is required' }, { status: 400 });
  const info = db
    .prepare(
      `INSERT INTO chunks (phrase, reading, meaning, jlpt_level, topic_tags, source, island_id)
       VALUES (@phrase, @reading, @meaning, @jlpt_level, @topic_tags, @source, @island_id)
       ON CONFLICT(phrase, source, island_id) DO UPDATE SET
         reading = excluded.reading, meaning = excluded.meaning,
         jlpt_level = excluded.jlpt_level, topic_tags = excluded.topic_tags`,
    )
    .run({
      phrase: body.phrase.trim(),
      reading: body.reading ?? null,
      meaning: body.meaning ?? null,
      jlpt_level: body.jlpt_level ?? null,
      topic_tags: (body.topic_tags ?? []).join(','),
      source: body.source ?? 'manual',
      island_id: body.island_id ?? null,
    });
  return NextResponse.json({ id: Number(info.lastInsertRowid) });
}
