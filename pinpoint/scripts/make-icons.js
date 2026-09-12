#!/usr/bin/env node
/** Generate Pinpoint app icons (PNG) with no extra packages. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[(width * 4 + 1) * y] = 0;
    rgba.copy(raw, (width * 4 + 1) * y + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function setPx(rgba, size, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  rgba[i] = r;
  rgba[i + 1] = g;
  rgba[i + 2] = b;
  rgba[i + 3] = a;
}

function fillCircle(rgba, size, cx, cy, radius, color) {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(size - 1, Math.ceil(cx + radius));
  const y1 = Math.min(size - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) setPx(rgba, size, x, y, ...color);
    }
  }
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const bg = [15, 42, 36, 255];
  for (let i = 0; i < size * size; i += 1) {
    rgba[i * 4] = bg[0];
    rgba[i * 4 + 1] = bg[1];
    rgba[i * 4 + 2] = bg[2];
    rgba[i * 4 + 3] = 255;
  }
  fillCircle(rgba, size, size * 0.5, size * 0.5, size * 0.42, [26, 74, 62, 255]);
  const pinX = size * 0.5;
  const pinY = size * 0.42;
  fillCircle(rgba, size, pinX, pinY, size * 0.16, [255, 208, 137, 255]);
  fillCircle(rgba, size, pinX, pinY, size * 0.07, [15, 42, 36, 255]);
  const tipY = size * 0.72;
  for (let y = Math.floor(pinY); y <= tipY; y += 1) {
    const t = (y - pinY) / (tipY - pinY);
    const half = size * 0.16 * (1 - t) * 0.85 + 1;
    for (let x = Math.floor(pinX - half); x <= pinX + half; x += 1) {
      setPx(rgba, size, x, y, 255, 208, 137, 255);
    }
  }
  fillCircle(rgba, size, pinX, pinY, size * 0.16, [255, 208, 137, 255]);
  fillCircle(rgba, size, pinX, pinY, size * 0.07, [15, 107, 76, 255]);
  return encodePng(size, size, rgba);
}

const dir = path.join(__dirname, '..', 'src', 'public', 'icons');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon-192.png'), drawIcon(192));
fs.writeFileSync(path.join(dir, 'icon-512.png'), drawIcon(512));
fs.writeFileSync(path.join(dir, 'apple-touch-icon.png'), drawIcon(180));
console.log('Wrote icons to', dir);
