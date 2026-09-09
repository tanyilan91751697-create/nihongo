import { NextResponse } from 'next/server';
import { analyzeText } from '@/lib/reader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json()) as { text?: string; title?: string; save?: boolean; sourceUrl?: string };
  const text = body.text?.trim();
  if (!text) return NextResponse.json({ error: 'No text supplied.' }, { status: 400 });
  if (text.length > 50_000) {
    return NextResponse.json({ error: 'Text is too long — analyse at most 50,000 characters at a time.' }, { status: 413 });
  }
  try {
    const result = await analyzeText(text, {
      save: body.save !== false,
      title: body.title,
      sourceUrl: body.sourceUrl,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('analyze failed', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
