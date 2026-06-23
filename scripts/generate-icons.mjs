import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const rootDir = new URL("..", import.meta.url).pathname;
const outDir = join(rootDir, "icons");
await mkdir(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = makeIcon(size);
  await writeFile(join(outDir, `icon${size}.png`), png);
}

console.log(`Generated icons in ${outDir}`);

function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  fill(rgba, size, 0, 0, size, size, [27, 111, 143, 255]);

  const pad = Math.max(2, Math.round(size * 0.13));
  const tabHeight = Math.max(3, Math.round(size * 0.18));
  const gap = Math.max(1, Math.round(size * 0.06));
  const radius = Math.max(1, Math.round(size * 0.06));
  const x = pad;
  const width = size - pad * 2;
  const y1 = Math.round(size * 0.26);
  const y2 = y1 + tabHeight + gap;
  const y3 = y2 + tabHeight + gap;

  roundedRect(rgba, size, x, y1, width, tabHeight, radius, [238, 246, 249, 255]);
  roundedRect(rgba, size, x, y2, Math.round(width * 0.78), tabHeight, radius, [167, 220, 232, 255]);
  roundedRect(rgba, size, x, y3, Math.round(width * 0.58), tabHeight, radius, [246, 211, 106, 255]);

  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    pixels[rowStart] = 0;
    rgba.copy(pixels, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  const chunks = [
    chunk("IHDR", concatUInt32(size, size, Buffer.from([8, 6, 0, 0, 0]))),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0))
  ];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

function fill(buffer, size, x, y, width, height, color) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) setPixel(buffer, size, xx, yy, color);
  }
}

function roundedRect(buffer, size, x, y, width, height, radius, color) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      const dx = Math.max(x + radius - xx, 0, xx - (x + width - radius - 1));
      const dy = Math.max(y + radius - yy, 0, yy - (y + height - radius - 1));
      if (dx * dx + dy * dy <= radius * radius) setPixel(buffer, size, xx, yy, color);
    }
  }
}

function setPixel(buffer, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (y * size + x) * 4;
  buffer[offset] = color[0];
  buffer[offset + 1] = color[1];
  buffer[offset + 2] = color[2];
  buffer[offset + 3] = color[3];
}

function concatUInt32(width, height, rest) {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  return Buffer.concat([buffer, rest]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
