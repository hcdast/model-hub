/**
 * 轻量 MP4（moov）解析：从远程 URL 拉取片段解析时长、分辨率、编码四类信息。
 * 不依赖 ffmpeg；适用于典型 progressive MP4（moov 在文件头或尾部）。
 */

import axios from 'axios';

export interface Mp4DerivedMetadata {
  durationSeconds?: number;
  width?: number;
  height?: number;
  codecFourCc?: string;
}

function walkChildBoxes(
  buf: Buffer,
  start: number,
  end: number,
  visit: (type: string, payloadStart: number, payloadEnd: number) => void,
): void {
  let o = start;
  while (o + 8 <= end) {
    let size = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) break;
      size = Number(buf.readBigUInt64BE(o + 8));
      header = 16;
    }
    if (size < header || o + size > end) break;
    const payloadStart = o + header;
    const payloadEnd = o + size;
    visit(type, payloadStart, payloadEnd);
    o = payloadEnd;
  }
}

function parseMvhdDurationSec(buf: Buffer, payloadStart: number, payloadEnd: number): number | undefined {
  if (payloadEnd - payloadStart < 20) return undefined;
  const version = buf[payloadStart];
  if (version === 0) {
    const timescale = buf.readUInt32BE(payloadStart + 12);
    const duration = buf.readUInt32BE(payloadStart + 16);
    if (timescale > 0 && duration > 0) return duration / timescale;
  } else if (version === 1) {
    if (payloadEnd - payloadStart < 32) return undefined;
    const timescale = buf.readUInt32BE(payloadStart + 20);
    const duration = Number(buf.readBigUInt64BE(payloadStart + 24));
    if (timescale > 0 && duration > 0) return duration / timescale;
  }
  return undefined;
}

function parseTkhdDimensions(buf: Buffer, payloadStart: number, payloadEnd: number): { width: number; height: number } | undefined {
  const version = buf[payloadStart];
  const minLen = version === 1 ? 92 : 80;
  if (payloadEnd - payloadStart < minLen) return undefined;
  /** tkhd v0：width/height 位于 payload +72；v1：位于 +84（ISO 14496-12） */
  const dimOffset = version === 1 ? payloadStart + 84 : payloadStart + 72;
  if (dimOffset + 8 > payloadEnd) return undefined;
  const wFixed = buf.readUInt32BE(dimOffset);
  const hFixed = buf.readUInt32BE(dimOffset + 4);
  const width = wFixed >> 16;
  const height = hFixed >> 16;
  if (width > 0 && height > 0 && width < 32768 && height < 32768) return { width, height };
  return undefined;
}

/** stsd：取第一条样本条目的 format fourcc（如 avc1、hvc1） */
function parseStsdCodec(buf: Buffer, payloadStart: number, payloadEnd: number): string | undefined {
  if (payloadEnd - payloadStart < 16) return undefined;
  const entryCount = buf.readUInt32BE(payloadStart + 4);
  if (entryCount < 1) return undefined;
  const off = payloadStart + 8;
  if (off + 8 > payloadEnd) return undefined;
  const entrySize = buf.readUInt32BE(off);
  if (entrySize < 8 || off + entrySize > payloadEnd) return undefined;
  const format = buf.toString('ascii', off + 4, off + 8).replace(/\0/g, '').trim();
  if (format.length >= 3 && format.length <= 8 && /^[\x21-\x7E]+$/.test(format)) return format;
  return undefined;
}

export function parseMoovBox(moovBox: Buffer): Mp4DerivedMetadata {
  const out: Mp4DerivedMetadata = {};
  if (moovBox.length < 8) return out;

  const header = moovBox.readUInt32BE(0) === 1 ? 16 : 8;
  walkChildBoxes(moovBox, header, moovBox.length, (type, pStart, pEnd) => {
    if (type === 'mvhd') {
      const sec = parseMvhdDurationSec(moovBox, pStart, pEnd);
      if (sec != null && sec > 0) out.durationSeconds = sec;
    }
    if (type !== 'trak') return;

    walkChildBoxes(moovBox, pStart, pEnd, (t2, ps2, pe2) => {
      if (t2 === 'tkhd') {
        const dims = parseTkhdDimensions(moovBox, ps2, pe2);
        if (dims && (!out.width || dims.width * dims.height >= (out.width ?? 0) * (out.height ?? 0))) {
          out.width = dims.width;
          out.height = dims.height;
        }
      }
      if (t2 !== 'mdia') return;

      walkChildBoxes(moovBox, ps2, pe2, (t3, ps3, pe3) => {
        if (t3 !== 'minf') return;
        walkChildBoxes(moovBox, ps3, pe3, (t4, ps4, pe4) => {
          if (t4 !== 'stbl') return;
          walkChildBoxes(moovBox, ps4, pe4, (t5, ps5, pe5) => {
            if (t5 === 'stsd' && !out.codecFourCc) {
              const codec = parseStsdCodec(moovBox, ps5, pe5);
              if (codec) out.codecFourCc = codec;
            }
          });
        });
      });
    });
  });

  return out;
}

/** 在缓冲区中定位完整 moov 盒子（含头部） */
export function findMoovBoxInBuffer(buf: Buffer): Buffer | null {
  for (let i = 0; i <= buf.length - 8; i++) {
    const type = buf.toString('ascii', i + 4, i + 8);
    if (type !== 'moov') continue;
    let size = buf.readUInt32BE(i);
    let hdr = 8;
    if (size === 1) {
      if (i + 16 > buf.length) continue;
      size = Number(buf.readBigUInt64BE(i + 8));
      hdr = 16;
    }
    if (size < hdr || i + size > buf.length) continue;
    return buf.subarray(i, i + size);
  }
  return null;
}

const UA = 'Mozilla/5.0 (compatible; ModelHub/1.0; +metadata)';

const MAX_FETCH_BYTES = 3 * 1024 * 1024;

async function fetchRange(url: string, start: number, end: number): Promise<Buffer> {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 25000,
    headers: { Range: `bytes=${start}-${end}`, 'User-Agent': UA },
    maxRedirects: 5,
    maxContentLength: MAX_FETCH_BYTES,
    maxBodyLength: MAX_FETCH_BYTES,
    validateStatus: (s) => (s >= 200 && s < 300) || s === 206,
  });
  let buf = Buffer.from(res.data as ArrayBuffer);
  if (buf.length > MAX_FETCH_BYTES) buf = buf.subarray(0, MAX_FETCH_BYTES);
  return buf;
}

/**
 * 拉取文件头/尾部片段并解析 moov。
 */
export async function fetchAndParseMp4Metadata(url: string): Promise<Mp4DerivedMetadata | null> {
  let totalLen = 0;
  try {
    const headRes = await axios.head(url, {
      timeout: 12000,
      headers: { 'User-Agent': UA },
      maxRedirects: 5,
    });
    totalLen = parseInt(headRes.headers['content-length'] || '0', 10);
  } catch {
    totalLen = 0;
  }

  const headEnd = totalLen > 0 ? Math.min(524287, totalLen - 1) : 524287;
  const first = await fetchRange(url, 0, Math.max(0, headEnd));

  let moov = findMoovBoxInBuffer(first);
  if (!moov && totalLen > first.length) {
    const tailSpan = Math.min(2097152, totalLen);
    const tailStart = Math.max(0, totalLen - tailSpan);
    try {
      const tail = await fetchRange(url, tailStart, totalLen - 1);
      moov = findMoovBoxInBuffer(tail);
    } catch {
      /* ignore */
    }
  }

  if (!moov) return null;
  const parsed = parseMoovBox(moov);
  return Object.keys(parsed).length ? parsed : null;
}
