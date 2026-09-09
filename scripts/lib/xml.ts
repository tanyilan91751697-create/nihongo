import { Transform } from 'node:stream';

/**
 * JMdict and KANJIDIC2 declare ~200 custom entities in their DTD (&n; &vs;
 * &adj-i; …) and use them as element content. A streaming parser has no DTD
 * knowledge, so this rewrites `&foo;` into plain `foo` before parsing, leaving
 * the five XML built-ins alone.
 *
 * The tail buffer keeps the last few bytes of each chunk so an entity split
 * across a chunk boundary is still rewritten correctly.
 */
export function stripCustomEntities() {
  const BUILTIN = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);
  const rewrite = (s: string) =>
    s.replace(/&(#?[A-Za-z0-9._-]+);/g, (match, name: string) => {
      if (name.startsWith('#') || BUILTIN.has(name)) return match;
      return name;
    });

  let tail = '';
  return new Transform({
    decodeStrings: false,
    transform(chunk, _enc, cb) {
      const text = tail + chunk.toString('utf8');
      // Hold back anything after the last '&' that has no closing ';' yet.
      const lastAmp = text.lastIndexOf('&');
      let head = text;
      if (lastAmp !== -1 && text.indexOf(';', lastAmp) === -1 && text.length - lastAmp < 64) {
        head = text.slice(0, lastAmp);
        tail = text.slice(lastAmp);
      } else {
        tail = '';
      }
      cb(null, rewrite(head));
    },
    flush(cb) {
      cb(null, rewrite(tail));
    },
  });
}
