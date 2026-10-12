const SIGNATURE_LINE =
  /^(export\s+)?(async\s+)?(function|class|interface|type|enum)\s+[\w$]+/;

const SIGNATURE_BLOCK =
  /^(export\s+)?(default\s+)?(async\s+)?function\s*\w*\s*\([^)]*\)/;

export function extractMatchSlices(
  source: string,
  lineNumbers: number[],
  contextLines = 14,
): string {
  const lines = source.split(/\r?\n/);
  const ranges: Array<{ start: number; end: number }> = [];
  const sorted = [...new Set(lineNumbers)].filter((n) => n >= 1 && n <= lines.length);
  sorted.sort((a, b) => a - b);

  for (const lineNo of sorted.slice(0, 8)) {
    const start = Math.max(1, lineNo - contextLines);
    const end = Math.min(lines.length, lineNo + contextLines);
    ranges.push({ start, end });
  }

  ranges.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (!last || r.start > last.end + 2) {
      merged.push({ ...r });
    } else {
      last.end = Math.max(last.end, r.end);
    }
  }

  const chunks: string[] = [];
  for (const { start, end } of merged) {
    const body = lines.slice(start - 1, end).join("\n");
    chunks.push(`// lines ${start}-${end}\n${body}`);
  }

  if (chunks.length === 0) return source.slice(0, 4000);
  return chunks.join("\n\n…\n\n");
}

export function extractSignatures(source: string, relPath: string): string {
  const lines = source.split(/\r?\n/);
  const picked: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line || line.startsWith("//") || line.startsWith("*")) continue;
    if (SIGNATURE_LINE.test(line) || SIGNATURE_BLOCK.test(line)) {
      picked.push(line);
      let j = i + 1;
      while (j < lines.length && j < i + 4) {
        const next = lines[j];
        if (next.trim() === "" || next.includes("{")) break;
        if (/^\s+[\w$]/.test(next)) {
          picked.push(next.trimEnd());
          j++;
        } else break;
      }
      i = j;
    }
    if (picked.length >= 48) break;
  }

  if (picked.length === 0) {
    const head = lines.slice(0, 40).join("\n");
    return `// signature fallback (first lines)\n${head}`;
  }

  return `// signatures from ${relPath}\n${picked.join("\n")}`;
}
