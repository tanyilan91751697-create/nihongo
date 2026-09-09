import { NextResponse } from 'next/server';
import { db, upsertKnowledgeNode } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json()) as {
    surface?: string;
    reading?: string | null;
    node_type?: string;
    ref_id?: number | null;
    status?: string;
  };
  if (!body.surface) return NextResponse.json({ error: 'surface is required' }, { status: 400 });
  const node = upsertKnowledgeNode({
    node_type: body.node_type ?? 'vocabulary',
    ref_id: body.ref_id ?? null,
    surface: body.surface,
    reading: body.reading ?? null,
    status: body.status,
  });
  return NextResponse.json({ node });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const rows = db
    .prepare(
      `SELECT * FROM knowledge_nodes
       ${status ? 'WHERE status = @status' : ''}
       ORDER BY last_seen_at DESC LIMIT 500`,
    )
    .all(status ? { status } : {});
  return NextResponse.json({ nodes: rows });
}
