import { NextResponse } from 'next/server';
import { bulkLookup, db } from '@/lib/db';
import { isContentToken, tokenize } from '@/lib/tokenizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Extract this island's chunk bank from its Japanese text.
 *
 * Runs the same tokenizer the Reader uses, keeps content words and the
 * noun+particle+verb collocations around them, and stores them as island-scoped
 * chunks so they can be drilled or pushed to the SRS.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const islandId = Number(id);
  const island = db.prepare('SELECT * FROM islands WHERE id = ?').get(islandId) as
    | { verified_version: string | null; l2_translation: string | null }
    | undefined;
  if (!island) return NextResponse.json({ error: 'Island not found' }, { status: 404 });

  const text = island.verified_version || island.l2_translation || '';
  if (!text.trim()) return NextResponse.json({ error: 'This island has no Japanese text yet.' }, { status: 400 });

  const tokens = await tokenize(text);
  const dictionary = bulkLookup(tokens.map((t) => t.dictionaryForm));

  const phrases = new Map<string, { reading: string; meaning: string | null; level: string | null }>();

  // Auxiliaries (the いる of 〜ている), pronouns, numbers and suffixes are not
  // worth banking as chunks — they carry no topic-specific meaning.
  const isBankable = (posDetail: string) =>
    !['非自立', '代名詞', '数', '接尾', '接頭'].some((tag) => posDetail.includes(tag));

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!isContentToken(token)) continue;
    if (!isBankable(token.posDetail)) continue;
    const info = dictionary.get(token.dictionaryForm);

    // Single content words.
    if (token.pos === '名詞' || token.pos === '動詞' || token.pos === '形容詞') {
      phrases.set(token.dictionaryForm, {
        reading: token.reading,
        meaning: info?.gloss ?? null,
        level: info?.jlptLevel ?? null,
      });
    }

    // Noun + case particle + verb, the collocation shape worth drilling.
    const particle = tokens[i + 1];
    const verb = tokens[i + 2];
    if (
      token.pos === '名詞' &&
      particle?.pos === '助詞' &&
      ['を', 'に', 'が', 'で', 'と'].includes(particle.surface) &&
      verb?.pos === '動詞' &&
      isBankable(verb.posDetail)
    ) {
      const phrase = `${token.surface}${particle.surface}${verb.dictionaryForm}`;
      const verbInfo = dictionary.get(verb.dictionaryForm);
      phrases.set(phrase, {
        reading: `${token.reading}${particle.surface}${verb.reading}`,
        meaning: [info?.gloss, verbInfo?.gloss].filter(Boolean).join(' + ') || null,
        level: verbInfo?.jlptLevel ?? info?.jlptLevel ?? null,
      });
    }
  }

  const insert = db.prepare(
    `INSERT INTO chunks (phrase, reading, meaning, jlpt_level, topic_tags, source, island_id)
     VALUES (?, ?, ?, ?, '', 'island', ?)
     ON CONFLICT(phrase, source, IFNULL(island_id, -1)) DO UPDATE SET
       reading = excluded.reading, meaning = excluded.meaning, jlpt_level = excluded.jlpt_level`,
  );
  const insertMany = db.transaction(() => {
    for (const [phrase, info] of phrases) {
      insert.run(phrase, info.reading, info.meaning, info.level, islandId);
    }
  });
  insertMany();

  return NextResponse.json({
    extracted: phrases.size,
    chunks: db.prepare('SELECT * FROM chunks WHERE island_id = ? ORDER BY id').all(islandId),
  });
}
