import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECORDINGS_DIR = path.join(process.cwd(), 'recordings');

/** Serves a saved recording. Only basenames inside recordings/ are reachable. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requested = searchParams.get('path');
  if (!requested) return NextResponse.json({ error: 'path is required' }, { status: 400 });

  const name = path.basename(requested);
  const file = path.join(RECORDINGS_DIR, name);
  if (!file.startsWith(RECORDINGS_DIR + path.sep) || !fs.existsSync(file)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const data = fs.readFileSync(file);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': 'audio/webm',
      'Content-Length': String(data.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
