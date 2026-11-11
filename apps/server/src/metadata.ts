import type { DetectedType } from './security.js';

/**
 * Removes location and camera metadata (EXIF, XMP, IPTC, GPS, comments) from JPEG, PNG, and WebP
 * files by dropping the segments or chunks that carry them. Image pixels are copied unchanged.
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

/**
 * JPEG: drop every APP1 to APP15 segment (EXIF, XMP, IPTC, Photoshop, vendor data) and every COM comment.
 * Keep the image structure, quantisation and Huffman tables, and APP0 (JFIF). Copy scan data unchanged.
 */
function stripJpeg(buf: Buffer): Buffer {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new MetadataError('malformed_file');
  const out: Buffer[] = [buf.subarray(0, 2)];
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
    const length = buf.readUInt16BE(i + 2);
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
  return Buffer.concat(out);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function stripPng(buf: Buffer): Buffer {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new MetadataError('malformed_file');
  const out: Buffer[] = [PNG_SIGNATURE];
  let i = 8;
  while (i + 8 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + length;
    if (end > buf.length) throw new MetadataError('malformed_file');
    if (!PNG_DROP_CHUNKS.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}

function stripWebp(buf: Buffer): Buffer {
  if (buf.subarray(0, 4).toString('latin1') !== 'RIFF' || buf.subarray(8, 12).toString('latin1') !== 'WEBP') throw new MetadataError('malformed_file');
  const chunks: Buffer[] = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const fourcc = buf.subarray(i, i + 4).toString('latin1');
    const size = buf.readUInt32LE(i + 4);
    const padded = size + (size % 2);
    const end = i + 8 + padded;
    if (end > buf.length) throw new MetadataError('malformed_file');
    // EXIF and XMP chunks carry location and camera data. Other chunks (VP8, VP8L, ALPH, ICCP) are kept.
    if (fourcc !== 'EXIF' && fourcc !== 'XMP ') chunks.push(buf.subarray(i, end));
    i = end;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, body]);
}

export function stripMetadata(buffer: Buffer, type: DetectedType): Buffer {
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
