# Nihongo Hub

A locally-hosted, single-user Japanese learning workspace: an intelligent reader,
a contextual SRS, an oral studio, an island workshop, an error log and a progress
dashboard. It runs on localhost, keeps everything in one SQLite file, makes no
external API calls while running, and costs nothing to operate.

```bash
npm install
npm run setup      # downloads and imports every dataset (~1-5 min the first time)
npm run dev        # http://localhost:3000
```

There is no login. Open the app and it is yours.

## What is in here

| Page | What it does |
| --- | --- |
| `/` | Progress dashboard — due cards, streak, coverage, fluency, Four Strands audit, island portfolio, error trends, activity timeline, trajectory |
| `/reader` | Paste Japanese, get furigana, JLPT colouring, clickable dictionary entries, pitch accent and detected grammar |
| `/reader/library` | Every text you have analysed, searchable |
| `/srs` | FSRS review queue for recognition and production cards, with the sentence you met the word in |
| `/studio` | 4/3/2 fluency drill, shadowing log, free speaking, session history |
| `/islands` | Rehearsed set-pieces from draft to deployable, with verification diffs and double translation drills |
| `/errors` | Error log with pattern detection and micro-drill generation |

`Cmd/Ctrl+K` opens a quick-add modal from anywhere: log an error, add a card, or
drop a note into the Reader.

## Stack

- **Next.js 15** (App Router) + TypeScript
- **SQLite** through `better-sqlite3` — direct SQL, no ORM
- **kuromoji.js** for tokenization (pure JS, no Python)
- **ts-fsrs** for scheduling
- **Tailwind CSS** with shadcn/ui-style components (Radix primitives + CVA)
- **Recharts** for the dashboard
- Browser `MediaRecorder` for audio, saved to `recordings/` on local disk

## Layout

```
data/                          Datasets and generated files
  grammar_points.json          1,216 merged JLPT grammar points
  grammar_supplement.json      Hand-written N5/N4 basics (checked in)
  grammar_gaps.txt             What is still missing upstream
  seed_chunks.json             505 seed collocations across 10 topics
  grammar_detection_rules.json 34 verified N5 detection rules
  cache/                       Downloaded sources (gitignored)
db/
  schema.sql                   Full schema, 20 tables
  nihongo.db                   Created by `npm run setup` (gitignored)
recordings/                    Audio from the Oral Studio (gitignored)
scripts/                       Acquisition and import pipeline
src/
  app/                         Pages and API route handlers
  components/                  React components
  lib/
    db.ts                      Connection + query helpers
    tokenizer.ts               kuromoji wrapper, furigana segmentation
    srs.ts                     FSRS scheduling
    grammar-detector.ts        Token-sequence rule engine
    diff.ts                    Character-level diff for Japanese
    metrics.ts                 Dashboard calculations
```

The brief sketched `src/api/`; App Router route handlers have to live under
`src/app/api/`, so that is where they are.

## The data pipeline

`npm run setup` runs, in order:

1. `acquire-grammar.ts` — merges four grammar sources into `data/grammar_points.json`
2. `generate-chunks.ts` — composes `data/seed_chunks.json`
3. `setup-db.ts` — creates `db/nihongo.db` from `db/schema.sql`
4. `import-jmdict.ts` — the dictionary
5. `import-kanjidic.ts` — the kanji
6. `import-jlpt-vocab.ts` — tags dictionary entries with JLPT levels
7. `import-grammar.ts`, `import-chunks.ts`, `import-pitch-accent.ts`
8. `generate-grammar-rules.ts` — writes and self-checks the detection rules

Steps 1 and 2 are skipped when their output already exists; delete the file to
rebuild it. Downloads are cached under `data/cache/`, so re-running is cheap.
Individual steps are available as `npm run import:jmdict`, `npm run setup:db`
and so on.

### Where the data comes from

| Dataset | Source | Entries |
| --- | --- | --- |
| Dictionary | [JMdict](http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz) (EDRDG), mirrored by [AnchorI/jlpt-kanji-dictionary](https://github.com/AnchorI/jlpt-kanji-dictionary) | 211,631 |
| Kanji | [KANJIDIC2](http://ftp.edrdg.org/pub/Nihongo/kanjidic2.xml.gz) (EDRDG), mirrored by [davidluzgouveia/kanji-data](https://github.com/davidluzgouveia/kanji-data) | 13,108 |
| JLPT vocabulary | [Bluskyo/JLPT_Vocabulary](https://github.com/Bluskyo/JLPT_Vocabulary) (from tanos.co.uk) | 8,138 words → 8,404 tagged rows |
| Pitch accent | [mifunetoshiro/kanjium](https://github.com/mifunetoshiro/kanjium) | 100,529 rows annotated |
| Grammar | [aiko-tanaka/Grammar-Dictionaries](https://github.com/aiko-tanaka/Grammar-Dictionaries) (nihongo-kyoushi, e de wakaru, DOJG) via [AlexW00/fluent-jp](https://github.com/AlexW00/fluent-jp), plus a hand-written N5/N4 supplement | 1,216 points |
| Collocations | Generated from a curated noun/verb table + set phrases | 505 chunks |

JMdict and KANJIDIC2 are licensed by the [Electronic Dictionary Research and
Development Group](https://www.edrdg.org/edrdg/licence.html) under CC BY-SA 4.0;
the other datasets carry their own upstream licences.

**On the EDRDG mirrors.** The importers try `ftp.edrdg.org` first and parse the
canonical gzipped XML as a stream. Some networks block that host, so each
importer falls back to a community JSON mirror of the same data and records
which source it used in the `import_meta` table. On a normal home connection you
get the canonical files.

## Grammar detection

Detection rules match kuromoji's token stream, not raw text, which is what makes
〜てから distinguishable from a て-clause followed by から as a reason marker.
Rules live in `data/grammar_detection_rules.json`; the Reader reloads the file
when it changes, so you can add rules by hand without restarting.

A rule is a sequence of token specs. Each field is optional, all present fields
must match, and a list matches if any of its values does:

```json
{
  "slug": "n5_020",
  "level": "N5",
  "pattern": "〜てから",
  "note": "after doing",
  "tokens": [
    { "pos": ["動詞"], "conjugatedForm": ["連用タ接続", "連用形"] },
    { "surface": ["て", "で"], "pos": ["助詞"] },
    { "surface": ["から"], "pos": ["助詞"] }
  ]
}
```

`optional: true` lets a spec be skipped and `repeat: {min, max}` lets one consume
several tokens; both backtrack. `notSurface` and `notPos` exclude.

The 34 shipped rules cover N5 and are verified at generation time — each is run
against its own example sentences, and `npm run generate:rules` reports any that
fail to fire rather than shipping a rule that never matches.

## Known gaps

- `data/grammar_gaps.txt` lists what the merged grammar set is missing: N5 has 65
  points against a target of ~75, N1 has 227 against ~300, and 328 DOJG entries
  carry no JLPT level upstream. Points with no English meaning or no examples are
  listed individually.
- Grammar example sentences have no kana readings; the Reader generates furigana
  on the fly, so this only matters for printed study lists.
- `data/jlpt_vocab_unmatched.txt` lists the 72 JLPT list entries with no
  dictionary match.
- Detection rules stop at N5. The format is documented above and the file is
  meant to grow as you test with real text.

## Privacy

Nothing leaves the machine. Recordings are files in `recordings/`, everything
else is rows in `db/nihongo.db`, and the only network traffic is the dataset
downloads during `npm run setup`.
