import path from 'node:path';
import kuromoji, { type Tokenizer } from 'kuromoji';
import { toHiragana } from 'wanakana';

/**
 * kuromoji wrapper.
 *
 * Building the tokenizer reads ~15 MB of dictionary files, so it is built once
 * and shared. The promise is cached rather than the tokenizer itself so that
 * concurrent requests during startup all wait on the same build.
 */

export type KuromojiToken = {
  word_id: number;
  word_type: string;
  word_position: number;
  surface_form: string;
  pos: string;
  pos_detail_1: string;
  pos_detail_2: string;
  pos_detail_3: string;
  conjugated_type: string;
  conjugated_form: string;
  basic_form: string;
  reading?: string;
  pronunciation?: string;
};

export type Token = {
  index: number;
  surface: string;
  dictionaryForm: string;
  reading: string;
  readingKatakana: string;
  pos: string;
  posDetail: string;
  conjugatedType: string;
  conjugatedForm: string;
  position: number;
  isJapanese: boolean;
  needsFurigana: boolean;
  sentenceIndex: number;
};

declare global {
  var __kuromojiTokenizer: Promise<Tokenizer<KuromojiToken>> | undefined;
}

const DICT_PATH = path.join(process.cwd(), 'node_modules', 'kuromoji', 'dict');

export function getTokenizer(): Promise<Tokenizer<KuromojiToken>> {
  if (!globalThis.__kuromojiTokenizer) {
    globalThis.__kuromojiTokenizer = new Promise((resolve, reject) => {
      kuromoji.builder<KuromojiToken>({ dicPath: DICT_PATH }).build((err, tokenizer) => {
        if (err) reject(err);
        else resolve(tokenizer as Tokenizer<KuromojiToken>);
      });
    });
  }
  return globalThis.__kuromojiTokenizer;
}

const KANJI = /[一-龯㐀-䶿]/;
const JAPANESE = /[぀-ヿ一-龯㐀-䶿ｦ-ﾟ]/;

/** Split on Japanese sentence enders, keeping the punctuation with the sentence. */
export function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[。！？!?])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()].filter(Boolean);
}

export async function tokenize(text: string): Promise<Token[]> {
  const tokenizer = await getTokenizer();
  const sentences = splitSentences(text);
  const tokens: Token[] = [];
  let index = 0;
  let offset = 0;

  sentences.forEach((sentence, sentenceIndex) => {
    const raw = tokenizer.tokenize(sentence) as KuromojiToken[];
    for (const t of raw) {
      const readingKatakana = t.reading && t.reading !== '*' ? t.reading : '';
      const reading = readingKatakana ? toHiragana(readingKatakana) : '';
      const surface = t.surface_form;
      const isJapanese = JAPANESE.test(surface);
      tokens.push({
        index: index++,
        surface,
        dictionaryForm: t.basic_form && t.basic_form !== '*' ? t.basic_form : surface,
        reading,
        readingKatakana,
        pos: t.pos,
        posDetail: [t.pos_detail_1, t.pos_detail_2, t.pos_detail_3].filter((d) => d && d !== '*').join('/'),
        conjugatedType: t.conjugated_type === '*' ? '' : t.conjugated_type,
        conjugatedForm: t.conjugated_form === '*' ? '' : t.conjugated_form,
        position: offset + (t.word_position ? t.word_position - 1 : 0),
        isJapanese,
        // Furigana is only useful where the surface actually contains kanji and
        // the reading differs from what is already written.
        needsFurigana: KANJI.test(surface) && Boolean(reading) && reading !== surface,
        sentenceIndex,
      });
    }
    offset += sentence.length;
  });

  return tokens;
}

/**
 * Split a surface form into furigana segments so that only the kanji runs carry
 * a reading: 食べる -> [{text:'食', ruby:'た'}, {text:'べる'}].
 *
 * Falls back to a single whole-word ruby when the okurigana cannot be aligned,
 * which is the honest thing to do for irregular readings (今日, 大人).
 */
export function furiganaSegments(surface: string, reading: string): { text: string; ruby?: string }[] {
  if (!reading || surface === reading) return [{ text: surface }];
  if (!KANJI.test(surface)) return [{ text: surface }];

  // Strip a common kana suffix (okurigana) and prefix from both sides.
  let start = 0;
  while (
    start < surface.length &&
    start < reading.length &&
    !KANJI.test(surface[start]) &&
    surface[start] === reading[start]
  ) {
    start += 1;
  }
  let end = 0;
  while (
    end < surface.length - start &&
    end < reading.length - start &&
    !KANJI.test(surface[surface.length - 1 - end]) &&
    surface[surface.length - 1 - end] === reading[reading.length - 1 - end]
  ) {
    end += 1;
  }

  const prefix = surface.slice(0, start);
  const suffix = end ? surface.slice(surface.length - end) : '';
  const core = surface.slice(start, surface.length - end);
  const coreReading = reading.slice(start, reading.length - end);

  const segments: { text: string; ruby?: string }[] = [];
  if (prefix) segments.push({ text: prefix });
  if (core) segments.push(coreReading ? { text: core, ruby: coreReading } : { text: core });
  if (suffix) segments.push({ text: suffix });
  return segments.length ? segments : [{ text: surface, ruby: reading }];
}

/** Content words worth looking up; particles and punctuation are skipped. */
export function isContentToken(token: Token): boolean {
  if (!token.isJapanese) return false;
  if (token.pos === '記号') return false;
  if (token.pos === '助詞' || token.pos === '助動詞') return false;
  if (token.pos === 'フィラー') return false;
  return true;
}
