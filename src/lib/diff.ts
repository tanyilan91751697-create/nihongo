/**
 * Character-level diff for Japanese text.
 *
 * Japanese has no word delimiters, so the usual word-diff is useless here: the
 * unit that matters is the character (or the token). This is a plain
 * longest-common-subsequence diff over characters, with adjacent operations
 * merged into runs so the UI shows "この → その" rather than a per-character
 * confetti of changes.
 *
 * The scripts being compared are a few hundred characters at most, so the
 * quadratic LCS table is comfortably fast and worth its exactness.
 */

export type DiffOp = { type: 'equal' | 'insert' | 'delete'; value: string };

const MAX_LENGTH = 4000;

export function diffChars(before: string, after: string): DiffOp[] {
  const a = [...before];
  const b = [...after];

  if (a.length > MAX_LENGTH || b.length > MAX_LENGTH) {
    // Fall back to a whole-block replacement rather than allocating a huge table.
    return before === after
      ? [{ type: 'equal', value: before }]
      : [
          { type: 'delete', value: before },
          { type: 'insert', value: after },
        ];
  }

  // lengths[i][j] = LCS length of a[i:] and b[j:]
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  const push = (type: DiffOp['type'], value: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.value += value;
    else ops.push({ type, value });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      push('delete', a[i]);
      i += 1;
    } else {
      push('insert', b[j]);
      j += 1;
    }
  }
  while (i < a.length) {
    push('delete', a[i]);
    i += 1;
  }
  while (j < b.length) {
    push('insert', b[j]);
    j += 1;
  }
  return ops;
}

export type Change = {
  before: string;
  after: string;
  context: string;
};

/**
 * Collapse a diff into discrete changes, each with a little surrounding
 * context, so every change can become an error-log entry on its own.
 */
export function extractChanges(before: string, after: string, contextChars = 12): Change[] {
  const ops = diffChars(before, after);
  const changes: Change[] = [];
  let position = 0;
  let pending: { before: string; after: string; start: number } | null = null;

  const flush = (end: number) => {
    if (!pending) return;
    if (pending.before || pending.after) {
      const contextStart = Math.max(0, pending.start - contextChars);
      const contextEnd = Math.min(before.length, end + contextChars);
      changes.push({
        before: pending.before,
        after: pending.after,
        context: before.slice(contextStart, contextEnd),
      });
    }
    pending = null;
  };

  for (const op of ops) {
    if (op.type === 'equal') {
      flush(position);
      position += op.value.length;
      continue;
    }
    if (!pending) pending = { before: '', after: '', start: position };
    if (op.type === 'delete') {
      pending.before += op.value;
      position += op.value.length;
    } else {
      pending.after += op.value;
    }
  }
  flush(position);
  return changes;
}
