import { bulkLookup, db, knowledgeStatusMap, logActivity, upsertKnowledgeNode } from './db';
import { detectGrammar, loadRules, type GrammarMatch } from './grammar-detector';
import { furiganaSegments, isContentToken, splitSentences, tokenize, type Token } from './tokenizer';

/**
 * Text analysis pipeline shared by the Reader and the Island Workshop.
 *
 * One pass produces everything the UI needs: tokens with furigana and JLPT
 * colouring, grammar matches from the rule engine, a level histogram, and
 * (optionally) the persisted text plus its vocabulary/grammar encounters.
 */

export type AnalyzedToken = {
  index: number;
  surface: string;
  reading: string;
  dictionaryForm: string;
  pos: string;
  posDetail: string;
  conjugatedForm: string;
  sentenceIndex: number;
  isContent: boolean;
  furigana: { text: string; ruby?: string }[];
  level: string | null;
  vocabularyId: number | null;
  gloss: string | null;
  knowledge: string | null;
};

export type AnalysisResult = {
  tokens: AnalyzedToken[];
  grammar: (GrammarMatch & { meaning?: string | null })[];
  sentences: string[];
  levelSummary: Record<string, number>;
  uniqueWords: number;
  textId?: number;
};

const LEVEL_KEYS = ['N5', 'N4', 'N3', 'N2', 'N1', 'unknown'] as const;

export async function analyzeText(
  text: string,
  options: { save?: boolean; title?: string; sourceUrl?: string } = {},
): Promise<AnalysisResult> {
  const tokens = await tokenize(text);
  const sentences = splitSentences(text);

  const contentForms = tokens.filter(isContentToken).map((t) => t.dictionaryForm);
  const dictionary = bulkLookup([...contentForms, ...tokens.map((t) => t.surface)]);
  const knowledge = knowledgeStatusMap([...contentForms, ...tokens.map((t) => t.surface)]);

  const levelSummary: Record<string, number> = Object.fromEntries(LEVEL_KEYS.map((k) => [k, 0]));
  const uniqueSurfaces = new Set<string>();

  const analyzed: AnalyzedToken[] = tokens.map((token) => {
    const content = isContentToken(token);
    const info = dictionary.get(token.dictionaryForm) ?? dictionary.get(token.surface) ?? null;
    const level = info?.jlptLevel ?? null;
    if (content) {
      uniqueSurfaces.add(token.dictionaryForm);
      const key = level && LEVEL_KEYS.includes(level as (typeof LEVEL_KEYS)[number]) ? level : 'unknown';
      levelSummary[key] += 1;
    }
    return {
      index: token.index,
      surface: token.surface,
      reading: token.reading,
      dictionaryForm: token.dictionaryForm,
      pos: token.pos,
      posDetail: token.posDetail,
      conjugatedForm: token.conjugatedForm,
      sentenceIndex: token.sentenceIndex,
      isContent: content,
      furigana: token.needsFurigana ? furiganaSegments(token.surface, token.reading) : [{ text: token.surface }],
      level,
      vocabularyId: info?.vocabularyId ?? null,
      gloss: info?.gloss ?? null,
      knowledge: knowledge[token.dictionaryForm] ?? knowledge[token.surface] ?? null,
    };
  });

  const matches = detectGrammar(tokens, loadRules());

  // Resolve each match against the database by slug, not by the id stored in
  // the rules file: row ids change whenever the grammar set is reimported, and
  // a stale id would either mislabel an encounter or break its foreign key.
  const points = new Map<string, { id: number; meaning: string | null }>();
  if (matches.length) {
    const slugs = [...new Set(matches.map((m) => m.slug))];
    const rows = db
      .prepare(
        `SELECT id, slug, meaning_en FROM grammar_points WHERE slug IN (${slugs.map(() => '?').join(',')})`,
      )
      .all(...slugs) as { id: number; slug: string; meaning_en: string | null }[];
    for (const row of rows) points.set(row.slug, { id: row.id, meaning: row.meaning_en });
  }
  const grammar = matches.map((m) => ({
    ...m,
    grammarId: points.get(m.slug)?.id,
    meaning: points.get(m.slug)?.meaning ?? null,
  }));

  const result: AnalysisResult = {
    tokens: analyzed,
    grammar,
    sentences,
    levelSummary,
    uniqueWords: uniqueSurfaces.size,
  };

  if (options.save) {
    result.textId = saveAnalysis(text, result, tokens, options);
  }
  return result;
}

function sentenceOf(sentences: string[], index: number): string {
  return sentences[index] ?? sentences[0] ?? '';
}

function saveAnalysis(
  body: string,
  result: AnalysisResult,
  tokens: Token[],
  options: { title?: string; sourceUrl?: string },
): number {
  const title = options.title?.trim() || body.trim().slice(0, 40).replace(/\s+/g, ' ') || 'Untitled text';

  const save = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO texts (title, body, source_url, token_count, unique_words, level_summary, tokens_json, grammar_json)
         VALUES (@title, @body, @source_url, @token_count, @unique_words, @level_summary, @tokens_json, @grammar_json)`,
      )
      .run({
        title,
        body,
        source_url: options.sourceUrl ?? null,
        token_count: result.tokens.length,
        unique_words: result.uniqueWords,
        level_summary: JSON.stringify(result.levelSummary),
        tokens_json: JSON.stringify(result.tokens),
        grammar_json: JSON.stringify(result.grammar),
      });
    const textId = Number(info.lastInsertRowid);

    const insertVocab = db.prepare(
      `INSERT INTO text_vocabulary_encounters (text_id, vocabulary_id, surface, dictionary_form, reading, sentence, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const seen = new Set<string>();
    for (const token of result.tokens) {
      if (!token.isContent) continue;
      if (seen.has(token.dictionaryForm)) continue;
      seen.add(token.dictionaryForm);
      insertVocab.run(
        textId,
        token.vocabularyId,
        token.surface,
        token.dictionaryForm,
        token.reading,
        sentenceOf(result.sentences, token.sentenceIndex),
        token.index,
      );
    }

    const insertGrammar = db.prepare(
      `INSERT INTO text_grammar_encounters (text_id, grammar_point_id, matched_text, sentence, position)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const match of result.grammar) {
      insertGrammar.run(
        textId,
        // NULL rather than a dangling reference when a rule names a grammar
        // point that is not in this database.
        match.grammarId ?? null,
        match.matchedText,
        sentenceOf(result.sentences, match.sentenceIndex),
        match.startIndex,
      );
    }
    return textId;
  });

  const textId = save();
  logActivity({
    activity: 'reader_analyze',
    strand: 'input',
    ref_table: 'texts',
    ref_id: textId,
    detail: `${result.tokens.length} tokens, ${result.uniqueWords} unique words`,
    // Rough reading time: ~400 Japanese characters per minute for an
    // intermediate learner working through a text carefully.
    minutes: Math.max(1, Math.round(body.length / 400)),
  });
  void tokens;
  return textId;
}

/** Record that a word was met, without creating an SRS card. */
export function markEncountered(input: {
  surface: string;
  reading?: string | null;
  vocabularyId?: number | null;
  status?: string;
}) {
  return upsertKnowledgeNode({
    node_type: 'vocabulary',
    ref_id: input.vocabularyId ?? null,
    surface: input.surface,
    reading: input.reading ?? null,
    status: input.status,
  });
}
