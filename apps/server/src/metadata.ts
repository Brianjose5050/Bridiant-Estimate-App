import type { DetectedType } from './security.js';

/**
 * Removes location and camera metadata (EXIF, XMP, IPTC, GPS, comments) from JPEG, PNG, and WebP
 * files by dropping the segments or chunks that carry them. Image pixels are copied unchanged.
 * Written on Uint8Array only, so it runs in Cloudflare Workers without Node compatibility flags.
 *
 * HEIC is not supported here: removing its metadata needs a dedicated decoder. HEIC uploads are
 * refused until that decision is made.
 */
export class MetadataError extends Error {
  constructor(readonly code: 'unsupported_format' | 'malformed_file') {
    super(code);
    this.name = 'MetadataError';
  }
}

type Bytes = Uint8Array<ArrayBuffer>;

function concat(parts: Bytes[]): Bytes {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u16be(buf: Bytes, at: number): number {
  return ((buf[at] ?? 0) << 8) | (buf[at + 1] ?? 0);
}

function u32be(buf: Bytes, at: number): number {
  return (((buf[at] ?? 0) << 24) >>> 0) + (((buf[at + 1] ?? 0) << 16) | ((buf[at + 2] ?? 0) << 8) | (buf[at + 3] ?? 0));
}

function u32le(buf: Bytes, at: number): number {
  return (((buf[at + 3] ?? 0) << 24) >>> 0) + (((buf[at + 2] ?? 0) << 16) | ((buf[at + 1] ?? 0) << 8) | (buf[at] ?? 0));
}

function ascii(buf: Bytes, from: number, to: number): string {
  let out = '';
  for (let i = from; i < to && i < buf.length; i += 1) out += String.fromCharCode(buf[i] ?? 0);
  return out;
}

function writeAscii(target: Bytes, at: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) target[at + i] = text.charCodeAt(i);
}

function writeU32le(target: Bytes, at: number, value: number): void {
  target[at] = value & 0xff;
  target[at + 1] = (value >>> 8) & 0xff;
  target[at + 2] = (value >>> 16) & 0xff;
  target[at + 3] = (value >>> 24) & 0xff;
}

/**
 * JPEG: drop every APP1 to APP15 segment (EXIF, XMP, IPTC, Photoshop, vendor data) and every COM comment.
 * Keep the image structure, quantisation and Huffman tables, and APP0 (JFIF). Copy scan data unchanged.
 */
function stripJpeg(buf: Bytes): Bytes {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new MetadataError('malformed_file');
  const out: Bytes[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new MetadataError('malformed_file');
    let marker = buf[i + 1];
    while (marker === 0xff && i + 2 < buf.length) {
      i += 1;
      marker = buf[i + 1];
    }
    if (marker === undefined) throw new MetadataError('malformed_file');
    if (marker === 0xd9) {
      out.push(buf.subarray(i, i + 2));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) throw new MetadataError('malformed_file');
    const length = u16be(buf, i + 2);
    const end = i + 2 + length;
    if (end > buf.length) throw new MetadataError('malformed_file');
    if (marker === 0xda) {
      // Start of scan: the header is kept, then the entropy-coded data up to the end-of-image marker.
      out.push(buf.subarray(i));
      break;
    }
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) out.push(buf.subarray(i, end));
    i = end;
  }
  return concat(out);
}

const PNG_SIGNATURE: Bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function stripPng(buf: Bytes): Bytes {
  if (buf.length < 8 || PNG_SIGNATURE.some((byte, index) => buf[index] !== byte)) throw new MetadataError('malformed_file');
  const out: Bytes[] = [PNG_SIGNATURE];
  let i = 8;
  while (i + 8 <= buf.length) {
    const length = u32be(buf, i);
    const type = ascii(buf, i + 4, i + 8);
    const end = i + 12 + length;
    if (end > buf.length) throw new MetadataError('malformed_file');
    if (!PNG_DROP_CHUNKS.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return concat(out);
}

function stripWebp(buf: Bytes): Bytes {
  if (ascii(buf, 0, 4) !== 'RIFF' || ascii(buf, 8, 12) !== 'WEBP') throw new MetadataError('malformed_file');
  const chunks: Bytes[] = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const fourcc = ascii(buf, i, i + 4);
    const size = u32le(buf, i + 4);
    const padded = size + (size % 2);
    const end = i + 8 + padded;
    if (end > buf.length) throw new MetadataError('malformed_file');
    // EXIF and XMP chunks carry location and camera data. Other chunks (VP8, VP8L, ALPH, ICCP) are kept.
    if (fourcc !== 'EXIF' && fourcc !== 'XMP ') chunks.push(buf.subarray(i, end));
    i = end;
  }
  const body = concat(chunks);
  const header: Bytes = new Uint8Array(12);
  writeAscii(header, 0, 'RIFF');
  writeU32le(header, 4, body.length + 4);
  writeAscii(header, 8, 'WEBP');
  return concat([header, body]);
}

export function stripMetadata(buffer: Bytes, type: DetectedType): Bytes {
  switch (type) {
    case 'image/jpeg':
      return stripJpeg(buffer);
    case 'image/png':
      return stripPng(buffer);
    case 'image/webp':
      return stripWebp(buffer);
    default:
      throw new MetadataError('unsupported_format');
  }
}
