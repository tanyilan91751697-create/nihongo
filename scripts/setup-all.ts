/**
 * `npm run setup` — build the whole database from scratch.
 *
 * Runs the Phase 0 acquisition steps (only where their output is missing) and
 * then every importer in dependency order. Safe to re-run: downloads are cached
 * under data/cache and every insert is an upsert.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { log } from './lib/http';
import { setupDb } from './setup-db';
import { importJmdict } from './import-jmdict';
import { importKanjidic } from './import-kanjidic';
import { importJlptVocab } from './import-jlpt-vocab';
import { importGrammar } from './import-grammar';
import { importChunks } from './import-chunks';
import { importPitchAccent } from './import-pitch-accent';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');

function runScript(script: string) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), script], {
    stdio: 'inherit',
    cwd: ROOT,
  });
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status}`);
}

async function main() {
  const started = Date.now();

  log('=== Phase 0: data acquisition ===');
  if (!fs.existsSync(path.join(DATA_DIR, 'grammar_points.json'))) {
    runScript(path.join(ROOT, 'scripts', 'acquire-grammar.ts'));
  } else {
    log('grammar_points.json present — skipping acquisition (delete it to rebuild)');
  }
  if (!fs.existsSync(path.join(DATA_DIR, 'seed_chunks.json'))) {
    runScript(path.join(ROOT, 'scripts', 'generate-chunks.ts'));
  } else {
    log('seed_chunks.json present — skipping generation (delete it to rebuild)');
  }

  log('=== Phase 1: database ===');
  setupDb();

  const jmdict = await importJmdict();
  const kanjidic = await importKanjidic();
  await importJlptVocab();
  const grammarCount = importGrammar();
  const chunkCount = importChunks();
  await importPitchAccent();

  log('=== Grammar detection rules ===');
  runScript(path.join(ROOT, 'scripts', 'generate-grammar-rules.ts'));

  const db = new Database(path.join(ROOT, 'db', 'nihongo.db'));
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const vocab = count('vocabulary');
  const kanji = count('kanji');
  const grammar = count('grammar_points');
  const chunks = count('chunks');
  const withPitch = (
    db.prepare('SELECT COUNT(*) AS n FROM vocabulary WHERE pitch_accent_pattern IS NOT NULL').get() as {
      n: number;
    }
  ).n;
  const withJlpt = (
    db.prepare('SELECT COUNT(*) AS n FROM vocabulary WHERE jlpt_level IS NOT NULL').get() as { n: number }
  ).n;
  db.close();

  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  log('');
  log(
    `Setup complete. ${vocab.toLocaleString()} vocabulary entries, ${kanji.toLocaleString()} kanji, ` +
      `${grammar.toLocaleString()} grammar points, ${chunks.toLocaleString()} chunks loaded.`,
  );
  log(`  ${withJlpt.toLocaleString()} entries carry a JLPT level, ${withPitch.toLocaleString()} carry pitch accent.`);
  log(`  vocabulary source: ${jmdict.source}; kanji source: ${kanjidic.source}`);
  log(`  imported ${grammarCount} grammar points and ${chunkCount} chunks in ${seconds}s.`);
  log('');
  log('Next: npm run dev, then open http://localhost:3000');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
