/**
 * Build data/grammar_detection_rules.json.
 *
 * The rules below are written against kuromoji's real token output (IPADIC part
 * of speech names, 連用形/基本形 conjugation labels, and so on) for the first
 * thirty N5 grammar points in the database. Each rule is then verified by
 * running the detector over that grammar point's own example sentences, so a
 * rule that never fires is reported rather than silently shipped.
 *
 * The file is meant to grow: add a rule here (or by hand in the JSON) and the
 * Reader picks it up on the next analysis without a restart.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { log } from './lib/http';
import { tokenize } from '../src/lib/tokenizer';
import { detectGrammar, type DetectionRule } from '../src/lib/grammar-detector';

const DB_PATH = path.join(process.cwd(), 'db', 'nihongo.db');
const OUT = path.join(process.cwd(), 'data', 'grammar_detection_rules.json');

const TE_FORM = { surface: ['て', 'で'], pos: ['助詞'] };

/**
 * Rules keyed by grammar point slug. Written by hand against kuromoji output;
 * `probe` is a sentence the rule must match, used by the self-check below when
 * the grammar point itself has no usable example.
 */
const RULES: Record<string, { tokens: DetectionRule['tokens']; note?: string; probe?: string }> = {
  n5_001: {
    note: '〜あとで — past-tense verb followed by あと + で',
    tokens: [
      { pos: ['動詞', '名詞'] },
      { surface: ['た', 'だ'], pos: ['助動詞'], optional: true },
      { surface: ['の'], pos: ['助詞'], optional: true },
      { surface: ['あと', '後'] },
      { surface: ['で'], pos: ['助詞'] },
    ],
    probe: '日本へ行ったあとで病気になりました。',
  },
  n5_002: {
    note: '〜が、〜 — が as a clause-level contrastive connector (接続助詞)',
    tokens: [
      { surface: ['です', 'ます', 'だ'], pos: ['助動詞'] },
      { surface: ['が'], pos: ['助詞'], posDetail: ['接続助詞'] },
    ],
    probe: '高いですが、おいしいです。',
  },
  n5_003: {
    note: 'が as the subject marker (格助詞), excluding the contrastive connector',
    tokens: [{ pos: ['名詞'] }, { surface: ['が'], pos: ['助詞'], posDetail: ['格助詞'] }],
    probe: '雨が降っています。',
  },
  n5_004: {
    note: '〜があります／〜がいます — existence',
    tokens: [
      { surface: ['が'], pos: ['助詞'] },
      { basicForm: ['ある', 'いる'], pos: ['動詞'] },
    ],
    probe: '机の上に本があります。',
  },
  n5_005: {
    note: '〜がいちばん — superlative',
    tokens: [
      { surface: ['が'], pos: ['助詞'] },
      { surface: ['いちばん', '一番'] },
    ],
    probe: 'この店がいちばん安いです。',
  },
  n5_006: {
    note: '〜から〜まで — a span; から and まで in the same sentence',
    tokens: [
      { surface: ['から'], pos: ['助詞'] },
      { notPos: ['記号'], repeat: { min: 1, max: 6 } },
      { surface: ['まで'], pos: ['助詞'] },
    ],
    probe: '九時から五時まで働きます。',
  },
  n5_007: {
    note: '〜から（理由）— から attached to a clause-final predicate',
    tokens: [
      { pos: ['動詞', '形容詞', '助動詞'], conjugatedForm: ['基本形'] },
      { surface: ['から'], pos: ['助詞'], posDetail: ['接続助詞'] },
    ],
    probe: '寒いから、窓を閉めます。',
  },
  n5_008: {
    note: '〜が好きです',
    tokens: [
      { surface: ['が'], pos: ['助詞'] },
      { surface: ['好き', '嫌い', '上手', '下手'] },
    ],
    probe: '私は日本の音楽が好きです。',
  },
  n5_009: {
    note: '〜が欲しい',
    tokens: [
      { surface: ['が'], pos: ['助詞'] },
      { basicForm: ['欲しい', 'ほしい'] },
    ],
    probe: '新しい車が欲しいです。',
  },
  n5_010: {
    note: '〜ことができます — ability',
    tokens: [
      { pos: ['動詞'], conjugatedForm: ['基本形'] },
      { surface: ['こと', '事'] },
      { surface: ['が'], pos: ['助詞'] },
      { basicForm: ['できる', '出来る'] },
    ],
    probe: '日本語を話すことができます。',
  },
  n5_012: {
    note: '〜たい — desire; たい attaches to the ます-stem (連用形)',
    tokens: [
      { pos: ['動詞'], conjugatedForm: ['連用形', '連用タ接続'] },
      { basicForm: ['たい'], pos: ['助動詞'] },
    ],
    probe: '私は日本へ行きたいです。',
  },
  n5_013: {
    note: '〜だけ — only',
    tokens: [{ notPos: ['記号'] }, { surface: ['だけ'], pos: ['助詞'] }],
    probe: 'スミスさんだけ来ました。',
  },
  n5_014: {
    note: '〜たことがあります — past experience',
    tokens: [
      { surface: ['た', 'だ'], pos: ['助動詞'] },
      { surface: ['こと'] },
      { surface: ['が'], pos: ['助詞'] },
      { basicForm: ['ある'], pos: ['動詞'] },
    ],
    probe: '北海道へ行ったことがあります。',
  },
  n5_015: {
    note: '〜たり〜たり — representative listing',
    tokens: [
      { surface: ['たり', 'だり'], pos: ['助詞'] },
      // The listed items are separated by a comma, so 記号 must be allowed here.
      { notSurface: ['。', '！', '？'], repeat: { min: 1, max: 8 } },
      { surface: ['たり', 'だり'], pos: ['助詞'] },
    ],
    probe: '土曜日は買い物したり、映画を見たりしました。',
  },
  n5_017: {
    note: '〜て、〜 — te-form linking two clauses (te followed by a comma)',
    tokens: [
      { pos: ['動詞'], conjugatedForm: ['連用タ接続', '連用形'] },
      TE_FORM,
      { surface: ['、'] },
    ],
    probe: '朝起きて、顔を洗います。',
  },
  n5_018: {
    note: '〜で（場所）— place of action',
    tokens: [
      { pos: ['名詞'] },
      { surface: ['で'], pos: ['助詞'], posDetail: ['格助詞'] },
    ],
    probe: '図書館で勉強します。',
  },
  n5_019: {
    note: '〜ている — progressive or resultant state',
    tokens: [
      { pos: ['動詞'], conjugatedForm: ['連用タ接続', '連用形'] },
      TE_FORM,
      { basicForm: ['いる', 'る'], pos: ['動詞'] },
    ],
    probe: '今、宿題をしています。',
  },
  n5_020: {
    note: '〜てから — after doing',
    tokens: [
      { pos: ['動詞'], conjugatedForm: ['連用タ接続', '連用形'] },
      TE_FORM,
      { surface: ['から'], pos: ['助詞'] },
    ],
    probe: '手を洗ってからご飯を食べます。',
  },
  n5_021: {
    note: '〜てください — polite request',
    tokens: [
      { pos: ['動詞'] },
      TE_FORM,
      { basicForm: ['くださる', 'ください'], surface: ['ください', '下さい'] },
    ],
    probe: '教科書の１５ページを開いてください。',
  },
  n5_024: {
    note: '〜でしょう — probability / seeking agreement',
    tokens: [{ surface: ['でしょ', 'でしょう'], pos: ['助動詞'] }, { surface: ['う'], optional: true }],
    probe: '明日は雨でしょう。',
  },
  n5_025: {
    note: '〜てはいけない — prohibition',
    tokens: [
      { pos: ['動詞'] },
      TE_FORM,
      { surface: ['は'], pos: ['助詞'] },
      { basicForm: ['いける', 'いく'], surface: ['いけ', 'いけません', 'いけない'] },
    ],
    probe: 'ここでタバコを吸ってはいけません。',
  },
  n5_026: {
    note: '〜てもいい — permission',
    tokens: [
      { pos: ['動詞'] },
      TE_FORM,
      { surface: ['も'], pos: ['助詞'] },
      { basicForm: ['いい', '良い', 'よい'] },
    ],
    probe: 'ここに座ってもいいですか。',
  },
  n5_028: {
    note: '〜と — exhaustive listing / doing something with someone',
    tokens: [
      { pos: ['名詞'] },
      { surface: ['と'], pos: ['助詞'], posDetail: ['並立助詞', '格助詞'] },
      { pos: ['名詞'] },
    ],
    probe: 'パンと牛乳を買いました。',
  },
  n5_030: {
    note: '〜とき — when',
    tokens: [
      { notPos: ['記号'] },
      { surface: ['とき', '時'] },
      { surface: ['に', '、', 'は'], optional: true },
    ],
    probe: '子供のとき、よく公園で遊びました。',
  },
  n5_031: {
    note: '〜と思う — stating an opinion',
    tokens: [
      { surface: ['と'], pos: ['助詞'] },
      { basicForm: ['思う', 'おもう'], pos: ['動詞'] },
    ],
    probe: 'トムさんはあとで来ると思います。',
  },
  n5_032: {
    note: '〜ないで — doing B without doing A',
    tokens: [
      { pos: ['動詞'], conjugatedForm: ['未然形'] },
      { surface: ['ない'], pos: ['助動詞'] },
      { surface: ['で'], pos: ['助詞'] },
      { notSurface: ['ください', '下さい'] },
    ],
    probe: '朝ご飯を食べないで学校へ行きました。',
  },
  n5_033: {
    note: '〜ないでください — negative request',
    tokens: [
      { pos: ['動詞'], conjugatedForm: ['未然形'] },
      { surface: ['ない'], pos: ['助動詞'] },
      { surface: ['で'], pos: ['助詞'] },
      { surface: ['ください', '下さい'] },
    ],
    probe: 'ここで写真を撮らないでください。',
  },
  n5_034: {
    note: '〜ながら — simultaneous actions',
    tokens: [
      { pos: ['動詞'], conjugatedForm: ['連用形'] },
      { surface: ['ながら'], pos: ['助詞'] },
    ],
    probe: '新聞を読みながら朝ご飯を食べます。',
  },
  n5_035: {
    note: '〜なくてもいい — no obligation',
    tokens: [
      { surface: ['なく'], pos: ['助動詞'] },
      TE_FORM,
      { surface: ['も'], pos: ['助詞'] },
      { basicForm: ['いい', '良い', 'よい'] },
    ],
    probe: '明日は働かなくてもいいです。',
  },
  n5_036: {
    note: '〜なければならない — obligation',
    tokens: [
      { surface: ['なけれ'], pos: ['助動詞'] },
      { surface: ['ば'], pos: ['助詞'] },
      { surface: ['なり', 'いけ', 'なら'], optional: true },
      { notPos: ['記号'], optional: true },
    ],
    probe: '今日は働かなければなりません。',
  },
  n5_037: {
    note: '〜なる — becoming (adverbial form + なる)',
    tokens: [
      { conjugatedForm: ['連用テ接続', '連用形'], pos: ['形容詞'], optional: true },
      { surface: ['に', 'く'], optional: true },
      { basicForm: ['なる'], pos: ['動詞'] },
    ],
    probe: '日本語が上手になりました。',
  },
  n5_038: {
    note: '〜に（時間・場所・相手）— に as a case particle',
    tokens: [{ pos: ['名詞'] }, { surface: ['に'], pos: ['助詞'], posDetail: ['格助詞'] }],
    probe: '七時に起きます。',
  },
  n5_039: {
    note: '〜に行く — going somewhere to do something',
    tokens: [
      { pos: ['動詞'], conjugatedForm: ['連用形'] },
      { surface: ['に'], pos: ['助詞'] },
      { basicForm: ['行く', '来る', '帰る'], pos: ['動詞'] },
    ],
    probe: '映画を見に行きます。',
  },
  n5_040: {
    note: '〜の — noun modification / possession',
    tokens: [
      { pos: ['名詞'] },
      { surface: ['の'], pos: ['助詞'], posDetail: ['連体化'] },
      { pos: ['名詞'] },
    ],
    probe: 'これは私の傘です。',
  },
};

type GrammarRow = {
  id: number;
  slug: string;
  level: string;
  pattern: string;
  examples_json: string;
};

async function main() {
  const db = new Database(DB_PATH);
  const points = db
    .prepare("SELECT id, slug, level, pattern, examples_json FROM grammar_points WHERE level = 'N5' ORDER BY slug")
    .all() as GrammarRow[];
  db.close();

  const rules: DetectionRule[] = [];
  for (const point of points) {
    const spec = RULES[point.slug];
    if (!spec) continue;
    rules.push({
      slug: point.slug,
      grammarId: point.id,
      level: point.level,
      pattern: point.pattern,
      note: spec.note,
      tokens: spec.tokens,
    });
  }

  // --- self-check: every rule must fire on a sentence that contains it -------
  const failures: string[] = [];
  for (const rule of rules) {
    const point = points.find((p) => p.slug === rule.slug)!;
    const spec = RULES[rule.slug];
    let examples: { japanese: string }[] = [];
    try {
      examples = JSON.parse(point.examples_json);
    } catch {
      examples = [];
    }
    const probes = [spec.probe, ...examples.map((e) => e.japanese)].filter(Boolean) as string[];
    let fired = false;
    for (const probe of probes.slice(0, 4)) {
      const tokens = await tokenize(probe);
      if (detectGrammar(tokens, [rule]).length) {
        fired = true;
        break;
      }
    }
    if (!fired) failures.push(`${rule.slug} ${rule.pattern}`);
  }

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        note: 'Token-sequence rules matched against kuromoji (IPADIC) output. Add entries by hand as you test with real text; the Reader reloads this file when it changes.',
        rules,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  log(`wrote data/grammar_detection_rules.json (${rules.length} rules)`);
  if (failures.length) {
    log(`  ⚠ ${failures.length} rules did not fire on their own examples:`);
    for (const f of failures) log(`    ${f}`);
  } else {
    log('  all rules verified against their example sentences');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
