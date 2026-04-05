#!/usr/bin/env node
/**
 * cust*m Tab — Icon Generator (Node.js)
 * Zero dependencies. Uses only built-in Node.js modules.
 * Run: node icons/generate-icons.js
 */

'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ─── CRC-32 ───────────────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ─── PNG chunk builder ───────────────────────────────────────────────────────
function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf    = Buffer.allocUnsafe(4);
  const crcBuf    = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

// ─── PNG encoder (color type 6 = RGBA 8-bit) ────────────────────────────────
function encodePNG(width, height, getPixel) {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 6; // color type: RGBA
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive
  ihdr[12] = 0; // interlace: none

  // Raw pixel data: 1 filter byte per row + RGBA per pixel
  const raw = Buffer.allocUnsafe(height * (1 + width * 4));
  let pos = 0;
  for (let y = 0; y < height; y++) {
    raw[pos++] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y);
      raw[pos++] = r;
      raw[pos++] = g;
      raw[pos++] = b;
      raw[pos++] = a;
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    PNG_SIG,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Icon pixel function ──────────────────────────────────────────────────────
/**
 * Returns [r, g, b, a] for pixel (x, y) in an icon of given size.
 * Design: dark rounded-square background + indigo 6-arm asterisk.
 */
function iconPixel(x, y, size) {
  const BG     = [26, 26, 26, 255];       // #1a1a1a
  const ACCENT = [99, 102, 241, 255];     // #6366f1
  const TRANSP = [0, 0, 0, 0];

  const cx = size / 2;
  const cy = size / 2;
  const cornerR = size * 0.20;

  // ── 1. Rounded-rectangle mask ─────────────────────────────────────────────
  const ax = Math.abs(x - cx);
  const ay = Math.abs(y - cy);
  const hw = size / 2;
  const hh = size / 2;

  // Outside bounding box
  if (ax > hw || ay > hh) return TRANSP;

  // Inside corner zone → check corner circle
  if (ax > hw - cornerR && ay > hh - cornerR) {
    const cornerDx = ax - (hw - cornerR);
    const cornerDy = ay - (hh - cornerR);
    if (cornerDx * cornerDx + cornerDy * cornerDy > cornerR * cornerR) {
      return TRANSP;
    }
  }

  // ── 2. Asterisk (6 arms at 0°, 60°, 120°, 180°, 240°, 300°) ─────────────
  const px = x - cx;
  const py = y - cy;
  const armHalfWidth = size * 0.085; // perpendicular half-width of each arm
  const armLength    = size * 0.345; // arm length from center to tip

  for (let arm = 0; arm < 6; arm++) {
    const angle = (arm * Math.PI) / 3;
    const cos   = Math.cos(angle);
    const sin   = Math.sin(angle);
    const along = px * cos  + py * sin;          // projection along arm axis
    const perp  = Math.abs(-px * sin + py * cos); // perpendicular distance

    if (perp < armHalfWidth && Math.abs(along) < armLength) {
      return ACCENT;
    }
  }

  // Center hub
  const dist = Math.sqrt(px * px + py * py);
  if (dist < armHalfWidth * 1.6) {
    return ACCENT;
  }

  return BG;
}

// ─── Generate all sizes ───────────────────────────────────────────────────────
const SIZES  = [16, 32, 48, 128];
const outDir = path.resolve(__dirname);

SIZES.forEach(size => {
  const png      = encodePNG(size, size, (x, y) => iconPixel(x, y, size));
  const filePath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`✓ icons/icon${size}.png  (${png.length} bytes)`);
});

console.log('\n✅ Icons generated. Load the extension at chrome://extensions → Load unpacked.');
