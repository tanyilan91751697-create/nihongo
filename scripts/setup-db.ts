/**
 * Initialise db/nihongo.db from db/schema.sql.
 *
 * Safe to re-run: every statement is CREATE ... IF NOT EXISTS, so this both
 * bootstraps a fresh database and adds tables introduced by a later schema.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { log } from './lib/http';

const DB_PATH = path.join(process.cwd(), 'db', 'nihongo.db');
const SCHEMA_PATH = path.join(process.cwd(), 'db', 'schema.sql');

export function setupDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const db = new Database(DB_PATH);
  db.exec(schema);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  db.close();
  log(`database ready at db/nihongo.db (${tables.length} tables)`);
  return tables.map((t) => t.name);
}

if (process.argv[1] && process.argv[1].endsWith('setup-db.ts')) {
  const tables = setupDb();
  log(`  ${tables.join(', ')}`);
}
