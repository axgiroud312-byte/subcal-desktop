import { deflateSync } from 'node:zlib';
import { nativeImage } from 'electron';
import type { NativeImage } from 'electron';

/**
 * SubCal 自有托盘/窗口图标：运行时用代码生成的靛蓝圆角方块 + 日历图形。
 * 不使用任何第三方或网络素材，许可见 docs/assets.md。
 */

type Rgba = readonly [number, number, number, number];

const INDIGO: Rgba = [79, 70, 229, 255]; // #4F46E5 品牌主色
const WHITE: Rgba = [255, 255, 255, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

const LOGICAL_SIZE = 16;

/** 16x16 逻辑像素画：圆角方块底 + 日历（挂环、头部、日期点）。 */
function drawLogicalPixels(): Rgba[] {
  const g: Rgba[] = new Array(LOGICAL_SIZE * LOGICAL_SIZE).fill(CLEAR);
  const set = (x: number, y: number, c: Rgba) => {
    g[y * LOGICAL_SIZE + x] = c;
  };
  // 圆角方块底：四个角各去掉一个 2px 三角
  const cornerCut = (x: number, y: number): boolean =>
    (x <= 1 && y <= 1 && x + y < 2) ||
    (x >= 14 && y <= 1 && (15 - x) + y < 2) ||
    (x <= 1 && y >= 14 && x + (15 - y) < 2) ||
    (x >= 14 && y >= 14 && (15 - x) + (15 - y) < 2);
  for (let y = 0; y < LOGICAL_SIZE; y++) {
    for (let x = 0; x < LOGICAL_SIZE; x++) {
      if (!cornerCut(x, y)) set(x, y, INDIGO);
    }
  }
  // 日历白色卡片主体
  for (let y = 6; y <= 12; y++) {
    for (let x = 4; x <= 11; x++) {
      set(x, y, WHITE);
    }
  }
  // 卡片头部靛蓝横条
  for (let x = 4; x <= 11; x++) set(x, 8, INDIGO);
  // 两个白色挂环
  set(6, 4, WHITE);
  set(6, 5, WHITE);
  set(9, 4, WHITE);
  set(9, 5, WHITE);
  // 日期点（2x2 靛蓝）
  for (const [dx, dy] of [
    [6, 10],
    [7, 10],
    [6, 11],
    [7, 11],
  ] as const) {
    set(dx, dy, INDIGO);
  }
  return g;
}

const LOGICAL_PIXELS = drawLogicalPixels();

/** 最近邻放大到任意尺寸，输出 RGBA 字节数组。 */
function renderRgba(size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const lx = Math.min(LOGICAL_SIZE - 1, Math.floor((x * LOGICAL_SIZE) / size));
      const ly = Math.min(LOGICAL_SIZE - 1, Math.floor((y * LOGICAL_SIZE) / size));
      const c = LOGICAL_PIXELS[ly * LOGICAL_SIZE + lx];
      const i = (y * size + x) * 4;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = c[3];
    }
  }
  return out;
}

/* —— 最小 PNG 编码器（8bit RGBA，无交错），只依赖 Node 内置 zlib —— */

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

export function encodePngRgba(size: number, rgba: Uint8Array): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // compression/filter/interlace 均为 0
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size * 4; x++) {
      raw[rowStart + 1 + x] = rgba[y * size * 4 + x];
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 托盘图标：16px 与 32px 两个缩放表示。 */
export function createTrayIcon(): NativeImage {
  const image = nativeImage.createEmpty();
  const png16 = encodePngRgba(16, renderRgba(16));
  const png32 = encodePngRgba(32, renderRgba(32));
  image.addRepresentation({ scaleFactor: 1, width: 16, height: 16, buffer: png16 });
  image.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: png32 });
  return image;
}

/** 窗口图标：单个 48px PNG。 */
export function createWindowIcon(): NativeImage {
  return nativeImage.createFromBuffer(encodePngRgba(48, renderRgba(48)), {
    width: 48,
    height: 48,
  });
}
