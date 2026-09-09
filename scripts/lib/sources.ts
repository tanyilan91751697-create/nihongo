/**
 * Every external dataset the project pulls, in one place.
 *
 * EDRDG assets (JMdict, KANJIDIC2) are the canonical sources but their host is
 * unreachable from some networks (corporate proxies, CI sandboxes). Each entry
 * therefore lists community mirrors that carry equivalent data; the importers
 * fall back in order and record which source actually produced the data.
 */

export const JMDICT_SOURCES = [
  {
    label: 'EDRDG JMdict_e (canonical)',
    kind: 'xml-gz' as const,
    url: 'http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz',
    filename: 'JMdict_e.gz',
  },
  {
    label: 'EDRDG JMdict_e (https)',
    kind: 'xml-gz' as const,
    url: 'https://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz',
    filename: 'JMdict_e.gz',
  },
];

/** JMdict-derived JSON mirror, used when the EDRDG host cannot be reached. */
export const JMDICT_MIRROR_PARTS = [1, 2, 3, 4].map((i) => ({
  label: `jlpt-kanji-dictionary part ${i} (JMdict-derived mirror)`,
  url: `https://raw.githubusercontent.com/AnchorI/jlpt-kanji-dictionary/main/dictionary_part_${i}.json`,
  filename: `jmdict_mirror_part_${i}.json`,
}));

export const KANJIDIC_SOURCES = [
  {
    label: 'EDRDG kanjidic2 (canonical)',
    kind: 'xml-gz' as const,
    url: 'http://ftp.edrdg.org/pub/Nihongo/kanjidic2.xml.gz',
    filename: 'kanjidic2.xml.gz',
  },
  {
    label: 'EDRDG kanjidic2 (https)',
    kind: 'xml-gz' as const,
    url: 'https://ftp.edrdg.org/pub/Nihongo/kanjidic2.xml.gz',
    filename: 'kanjidic2.xml.gz',
  },
];

/** KANJIDIC-derived JSON mirror (adds modern JLPT levels + WaniKani data). */
export const KANJIDIC_MIRROR = {
  label: 'davidluzgouveia/kanji-data (KANJIDIC-derived mirror)',
  url: 'https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json',
  filename: 'kanji_data.json',
};

export const JLPT_VOCAB_SOURCE = {
  label: 'Bluskyo/JLPT_Vocabulary (tanos.co.uk lists, N5-N1)',
  url: 'https://raw.githubusercontent.com/Bluskyo/JLPT_Vocabulary/main/data/vocab/results/JLPT_vocab_ALL.json',
  filename: 'jlpt_vocab_all.json',
};

export const PITCH_ACCENT_SOURCE = {
  label: 'mifunetoshiro/kanjium pitch accent database',
  url: 'https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/accents.txt',
  filename: 'kanjium_accents.txt',
};

export const GRAMMAR_SOURCES = {
  nihongoKyoushi: {
    label: 'AlexW00/fluent-jp — nihongo-kyoushi JLPT grammar (via aiko-tanaka)',
    url: 'https://raw.githubusercontent.com/AlexW00/fluent-jp/main/languages/ja-JP/grammar/jlpt_grammar.json',
    filename: 'grammar_nihongo_kyoushi.json',
  },
  edewakaru: [1, 2, 3].map((i) => ({
    label: `aiko-tanaka/Grammar-Dictionaries — e de wakaru term bank ${i}`,
    url: `https://raw.githubusercontent.com/aiko-tanaka/Grammar-Dictionaries/main/edewakaru/term_bank_${i}.json`,
    filename: `grammar_edewakaru_${i}.json`,
  })),
  dojg: [
    {
      label: 'aiko-tanaka/Grammar-Dictionaries — Dictionary of Japanese Grammar',
      url: 'https://raw.githubusercontent.com/aiko-tanaka/Grammar-Dictionaries/main/dojg/term_bank_1.json',
      filename: 'grammar_dojg_1.json',
    },
  ],
};
