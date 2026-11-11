/**
 * Minimal, safe text format for Welcome Center chapters. The owner writes plain text;
 * the site renders it. No HTML is accepted.
 *
 *   # Heading                      -> heading block
 *   - item                         -> list block (consecutive lines)
 *   Label | text                   -> labelled item (consecutive lines)
 *   anything else                  -> paragraph (consecutive lines are joined)
 *   blank line                     -> separates blocks
 */
export type Block =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string; emphasis: boolean }
  | { type: 'list'; items: string[] }
  | { type: 'labelled'; items: Array<{ label: string; text: string }> };

const MAX_LINES = 200;

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_LINES).map((l) => l.trimEnd());
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] ?? '').trim();
    if (line === '') {
      i += 1;
      continue;
    }
    if (line.startsWith('# ')) {
      blocks.push({ type: 'heading', text: line.slice(2).trim() });
      i += 1;
      continue;
    }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('- ')) {
        items.push((lines[i] ?? '').trim().slice(2).trim());
        i += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }
    if (line.includes(' | ') && !line.startsWith('*')) {
      const items: Array<{ label: string; text: string }> = [];
      while (i < lines.length && (lines[i] ?? '').includes(' | ')) {
        const raw = (lines[i] ?? '').trim();
        const sep = raw.indexOf(' | ');
        items.push({ label: raw.slice(0, sep).trim(), text: raw.slice(sep + 3).trim() });
        i += 1;
      }
      blocks.push({ type: 'labelled', items });
      continue;
    }
    // Paragraph: a line starting with "*" is emphasised (italic in the design).
    const emphasis = line.startsWith('*');
    const parts: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !(lines[i] ?? '').trim().startsWith('# ') && !(lines[i] ?? '').trim().startsWith('- ') && !(lines[i] ?? '').includes(' | ')) {
      parts.push((lines[i] ?? '').trim().replace(/^\*\s?/, ''));
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: parts.join('\n'), emphasis });
  }
  return blocks;
}

/** Returns the plain text length, used to keep chapters within a readable size. */
export function blocksLength(blocks: Block[]): number {
  return blocks.reduce((n, b) => {
    if (b.type === 'list') return n + b.items.join('').length;
    if (b.type === 'labelled') return n + b.items.map((x) => x.label + x.text).join('').length;
    return n + b.text.length;
  }, 0);
}
