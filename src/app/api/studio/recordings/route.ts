import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECORDINGS_DIR = path.join(process.cwd(), 'recordings');

/** Keep filenames safe and predictable: 432_{date}_{topic}_phase{n}.webm */
function safeSegment(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'untitled';
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get('file');
  const sessionId = Number(form.get('sessionId'));
  const phase = Number(form.get('phase') ?? 1);
  const kind = String(form.get('kind') ?? '432');
  const topic = String(form.get('topic') ?? 'session');
  const duration = Number(form.get('duration') ?? 0);

  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });

  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const name = `${safeSegment(kind)}_${date}_${safeSegment(topic)}_phase${phase}_${sessionId}.webm`;
  const dest = path.join(RECORDINGS_DIR, name);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(dest, buffer);

  const info = db
    .prepare(
      'INSERT INTO session_recordings (session_id, phase, file_path, duration_sec) VALUES (?, ?, ?, ?)',
    )
    .run(sessionId, phase, name, Math.round(duration));

  return NextResponse.json({
    recording: db.prepare('SELECT * FROM session_recordings WHERE id = ?').get(Number(info.lastInsertRowid)),
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = Number(searchParams.get('sessionId'));
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  return NextResponse.json({
    recordings: db.prepare('SELECT * FROM session_recordings WHERE session_id = ? ORDER BY phase').all(sessionId),
  });
}
