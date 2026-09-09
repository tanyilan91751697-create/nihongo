import { NextResponse } from 'next/server';
import {
  getKnowledgeNode,
  grammarExamplesContaining,
  kanjiInfo,
  lookupWord,
  db,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everything the Reader sidebar shows for one clicked word. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const surface = searchParams.get('surface')?.trim();
  const reading = searchParams.get('reading')?.trim() || null;
  if (!surface) return NextResponse.json({ error: 'surface is required' }, { status: 400 });

  const entries = lookupWord(surface, reading);
  const kanjiChars = [...surface].filter((ch) => /[一-龯㐀-䶿]/.test(ch));
  const kanji = kanjiChars.map((ch) => kanjiInfo(ch)).filter(Boolean);
  const knowledge = getKnowledgeNode('vocabulary', surface, reading) ?? getKnowledgeNode('vocabulary', surface, null);
  const grammarExamples = grammarExamplesContaining(surface, 5);

  const cards = db
    .prepare(
      `SELECT id, card_type, stage, due FROM srs_cards
       WHERE front = ? OR back = ? OR front = ?
       LIMIT 5`,
    )
    .all(surface, surface, entries[0]?.kanji ?? surface);

  const encounters = db
    .prepare(
      `SELECT e.sentence, t.id AS text_id, t.title
       FROM text_vocabulary_encounters e
       JOIN texts t ON t.id = e.text_id
       WHERE e.dictionary_form = ? OR e.surface = ?
       ORDER BY e.id DESC LIMIT 5`,
    )
    .all(surface, surface);

  return NextResponse.json({ surface, reading, entries, kanji, knowledge, grammarExamples, cards, encounters });
}
