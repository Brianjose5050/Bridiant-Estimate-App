import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripMetadata, MetadataError } from '../src/metadata.js';
import { detectFileType } from '../src/security.js';

const GPS = 'GPSLatitude 52.5200N GPSLongitude 13.4050E CameraModel TestPhone';

function jpegWithMetadata(): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]); // JFIF
  const exifPayload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from(GPS, 'latin1')]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(exifPayload.length + 2); return b; })(), exifPayload]);
  const comment = Buffer.from('COM-owner-note ' + GPS, 'latin1');
  const com = Buffer.concat([Buffer.from([0xff, 0xfe]), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(comment.length + 2); return b; })(), comment]);
  const dqt = Buffer.from([0xff, 0xdb, 0x00, 0x43, 0x00, ...Array(64).fill(8)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  const scan = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, app0, app1, com, dqt, sof, sos, scan, eoi]);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

function pngWithMetadata(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('tEXt', Buffer.from('Location\0' + GPS, 'latin1')), chunk('eXIf', Buffer.from(GPS, 'latin1')), chunk('IDAT', Buffer.from([1, 2, 3])), chunk('IEND', Buffer.alloc(0))]);
}

function webpWithMetadata(): Buffer {
  const vp8l = Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00]);
  const vp8lChunk = Buffer.concat([Buffer.from('VP8L', 'latin1'), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(vp8l.length); return b; })(), vp8l, Buffer.alloc(vp8l.length % 2)]);
  const exif = Buffer.from(GPS, 'latin1');
  const exifChunk = Buffer.concat([Buffer.from('EXIF', 'latin1'), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(exif.length); return b; })(), exif, Buffer.alloc(exif.length % 2)]);
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), vp8lChunk, exifChunk]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

describe('metadata removal', () => {
  it('removes EXIF, GPS, and comments from a JPEG and keeps the image structure', () => {
    const input = jpegWithMetadata();
    expect(input.toString('latin1')).toContain('GPSLatitude');
    const output = stripMetadata(input, 'image/jpeg');
    const text = output.toString('latin1');
    expect(text).not.toContain('GPS');
    expect(text).not.toContain('CameraModel');
    expect(text).not.toContain('COM-owner-note');
    expect(text).not.toContain('Exif');
    expect(output.includes(Buffer.from([0xff, 0xdb]))).toBe(true); // quantisation table kept
    expect(output.includes(Buffer.from([0xff, 0xc0]))).toBe(true); // frame header kept
    expect(output.includes(Buffer.from([0x12, 0x34, 0x56, 0x78]))).toBe(true); // scan data kept
    expect(output.subarray(output.length - 2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(detectFileType(output)).toBe('image/jpeg');
  });

  it('removes text and EXIF chunks from a PNG and keeps the image data', () => {
    const output = stripMetadata(pngWithMetadata(), 'image/png');
    const text = output.toString('latin1');
    expect(text).not.toContain('GPS');
    expect(text).not.toContain('tEXt');
    expect(text).not.toContain('eXIf');
    expect(text).toContain('IHDR');
    expect(text).toContain('IDAT');
    expect(detectFileType(output)).toBe('image/png');
  });

  it('removes EXIF and XMP chunks from a WebP and fixes the file size', () => {
    const output = stripMetadata(webpWithMetadata(), 'image/webp');
    const text = output.toString('latin1');
    expect(text).not.toContain('GPS');
    expect(text).not.toContain('EXIF');
    expect(text).toContain('VP8L');
    expect(output.readUInt32LE(4)).toBe(output.length - 8);
    expect(detectFileType(output)).toBe('image/webp');
  });

  it('refuses formats it cannot strip safely, and malformed files', () => {
    expect(() => stripMetadata(Buffer.from('ftypheic'), 'image/heic')).toThrow(MetadataError);
    expect(() => stripMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), 'image/jpeg')).toThrow(MetadataError);
    expect(() => stripMetadata(Buffer.from('not a png at all'), 'image/png')).toThrow(MetadataError);
  });

  it('keeps a real JPEG valid and pixel-identical after removing injected GPS data (ImageMagick round trip)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'exif-'));
    const clean = join(dir, 'clean.jpg');
    execFileSync('convert', ['-size', '64x48', 'gradient:navy-white', clean]);
    const real = readFileSync(clean);
    // Insert a camera-style EXIF block with GPS coordinates right after the start-of-image marker.
    const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from('GPSLatitude 52/1,31/1,12/1 GPSLongitude 13/1,24/1,3/1 Make TestCam', 'latin1')]);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(exif.length + 2);
    const withGps = Buffer.concat([real.subarray(0, 2), Buffer.from([0xff, 0xe1]), len, exif, real.subarray(2)]);
    expect(withGps.toString('latin1')).toContain('GPSLatitude');
    const stripped = stripMetadata(withGps, 'image/jpeg');
    expect(stripped.toString('latin1')).not.toContain('GPS');
    expect(stripped.toString('latin1')).not.toContain('TestCam');
    const out = join(dir, 'stripped.jpg');
    writeFileSync(out, stripped);
    expect(execFileSync('identify', ['-format', '%w %h', out]).toString().trim()).toBe('64 48');
    const pixelsOriginal = execFileSync('convert', [clean, 'rgb:-']);
    const pixelsStripped = execFileSync('convert', [out, 'rgb:-']);
    expect(pixelsStripped.equals(pixelsOriginal)).toBe(true);
  });
});
