const MAX_CELLS = 250_000;

/**
 * Returns a line diff of two texts. Each line starts with ' ' (unchanged), '-' (removed) or '+' (added).
 * Large inputs skip the alignment and show all old lines as removed and all new lines as added.
 */
export function lineDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > MAX_CELLS) {
    return [...a.map((line) => `-${line}`), ...b.map((line) => `+${line}`)].join("\n");
  }

  // lengths[i][j] is the length of the longest common subsequence of a[i..] and b[j..].
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] = a[i] === b[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }

  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push(` ${a[i++]}`);
      j++;
    } else if (i < a.length && (j === b.length || lengths[i + 1]![j]! >= lengths[i]![j + 1]!)) {
      lines.push(`-${a[i++]}`);
    } else {
      lines.push(`+${b[j++]}`);
    }
  }
  return lines.join("\n");
}
