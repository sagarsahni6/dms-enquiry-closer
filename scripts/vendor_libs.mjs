import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const rootDir = process.cwd();
const extDir = path.join(rootDir, 'dms-enquiry-closer');
const vendorDir = path.join(extDir, 'vendor');
const iconsDir = path.join(extDir, 'icons');

fs.mkdirSync(vendorDir, { recursive: true });
fs.mkdirSync(iconsDir, { recursive: true });

// 1. Copy SheetJS (xlsx) local browser bundle
const xlsxSrc = path.join(rootDir, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');
const xlsxLicenseSrc = path.join(rootDir, 'node_modules', 'xlsx', 'LICENSE');
if (!fs.existsSync(xlsxSrc)) {
  throw new Error(`SheetJS bundle not found at ${xlsxSrc}. Run "npm install" first.`);
}
fs.copyFileSync(xlsxSrc, path.join(vendorDir, 'xlsx.full.min.js'));
if (fs.existsSync(xlsxLicenseSrc)) {
  fs.copyFileSync(xlsxLicenseSrc, path.join(vendorDir, 'xlsx.LICENSE'));
}
console.log('Copied vendor/xlsx.full.min.js');

// 2. Generate crisp PNG icons using built-in zlib (no native/external dependencies)
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function renderIconPng(size) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  const cornerR = size * 0.22;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type None
    for (let x = 0; x < size; x++) {
      const idx = rowStart + 1 + x * 4;
      // Signed distance to rounded rectangle
      const nx = Math.max(0, Math.abs(x + 0.5 - size / 2) - (size / 2 - cornerR));
      const ny = Math.max(0, Math.abs(y + 0.5 - size / 2) - (size / 2 - cornerR));
      const dist = Math.hypot(nx, ny) - cornerR;

      if (dist > 0.5) {
        raw[idx] = 0;
        raw[idx + 1] = 0;
        raw[idx + 2] = 0;
        raw[idx + 3] = 0;
        continue;
      }

      // Checkmark geometry in normalized [0..1] coordinates
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      // Two segments: (0.25, 0.54) -> (0.43, 0.72) -> (0.76, 0.32)
      function distToSeg(px, py, ax, ay, bx, by) {
        const vx = bx - ax;
        const vy = by - ay;
        const wx = px - ax;
        const wy = py - ay;
        const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
        return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
      }

      const d1 = distToSeg(u, v, 0.25, 0.54, 0.43, 0.72);
      const d2 = distToSeg(u, v, 0.43, 0.72, 0.76, 0.31);
      const stroke = Math.min(d1, d2);
      const isCheck = stroke < 0.085;

      // Subtle diagonal gradient from Hero crimson (#D71920) to deeper red (#A40E15)
      const grad = (u + v) * 0.5;
      let r = Math.round(215 - grad * 45);
      let g = Math.round(25 - grad * 10);
      let b = Math.round(32 - grad * 10);

      if (isCheck) {
        r = 255;
        g = 255;
        b = 255;
      }

      const alpha = dist > -0.5 ? Math.round((0.5 - dist) * 255) : 255;
      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
      raw[idx + 3] = Math.max(0, Math.min(255, alpha));
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

for (const size of [16, 48, 128]) {
  const outPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(outPath, renderIconPng(size));
  console.log(`Generated icons/icon${size}.png`);
}
