import { describe, expect, it } from 'vitest';
import { parseBlocks } from '../src/index.js';

describe('Welcome Center text format', () => {
  it('parses headings, paragraphs, lists, and labelled items', () => {
    const blocks = parseBlocks(`# Before Your Visit

Confirmation | We confirm scheduling details ahead of time.
Communication | Questions are handled directly.

First line of a paragraph
continues here.

- Pets secured
- Access arranged

*An italic closing line.`);
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'labelled', 'paragraph', 'list', 'paragraph']);
    expect(blocks[1]).toEqual({ type: 'labelled', items: [{ label: 'Confirmation', text: 'We confirm scheduling details ahead of time.' }, { label: 'Communication', text: 'Questions are handled directly.' }] });
    expect(blocks[2]).toEqual({ type: 'paragraph', text: 'First line of a paragraph\ncontinues here.', emphasis: false });
    expect(blocks[4]).toEqual({ type: 'paragraph', text: 'An italic closing line.', emphasis: true });
  });

  it('never produces HTML: markup is kept as plain text', () => {
    const blocks = parseBlocks('<script>alert(1)</script> and <b>bold</b>');
    expect(blocks).toEqual([{ type: 'paragraph', text: '<script>alert(1)</script> and <b>bold</b>', emphasis: false }]);
  });

  it('limits very long input', () => {
    const many = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    expect(parseBlocks(many).length).toBeLessThanOrEqual(200);
  });

  it('handles empty input', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('\n\n')).toEqual([]);
  });
});
