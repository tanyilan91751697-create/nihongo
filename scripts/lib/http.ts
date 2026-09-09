import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export const CACHE_DIR = path.join(process.cwd(), 'data', 'cache');

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function log(...args: unknown[]) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
}

/**
 * Download a URL to the local cache, skipping the transfer when the file is
 * already present. Returns the path on disk.
 */
export async function download(url: string, filename: string, opts: { force?: boolean } = {}) {
  ensureDir(CACHE_DIR);
  const dest = path.join(CACHE_DIR, filename);
  if (!opts.force && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    log(`cached  ${filename} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);
    return dest;
  }
  log(`GET     ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status} ${res.statusText}): ${url}`);
  }
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  log(`saved   ${filename} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);
  return dest;
}

/**
 * Try each URL in turn and return the first that downloads successfully.
 * Mirrors matter here: the canonical EDRDG host is unreachable from some
 * networks, so every EDRDG asset carries community mirrors as a fallback.
 */
export async function downloadFirst(
  candidates: { url: string; filename: string; label?: string }[],
): Promise<{ path: string; url: string }> {
  const errors: string[] = [];
  for (const c of candidates) {
    try {
      const p = await download(c.url, c.filename);
      return { path: p, url: c.url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`  ✗ ${c.label ?? c.url}: ${message}`);
      errors.push(`${c.url}: ${message}`);
    }
  }
  throw new Error(`All sources failed:\n  ${errors.join('\n  ')}`);
}

export async function fetchJson<T>(url: string): Promise<T> {
  log(`GET     ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`);
  return (await res.json()) as T;
}

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function writeJson(file: string, data: unknown) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  log(`wrote   ${path.relative(process.cwd(), file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}
