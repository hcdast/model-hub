import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { lookup } from 'dns/promises';
import type { LookupAddress } from 'dns';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { createWriteStream } from 'fs';
import { mkdtemp, open, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { BlockList, isIP } from 'net';
import type { MediaConstraints, NumericRange, ParamDefinitions } from '../common/interfaces/param-definition.interface';

const run = promisify(execFile);
const MAX_FILE = 512 * 1024 * 1024;
const denied = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) denied.addSubnet(address, prefix, 'ipv4');
export interface VerifiedMedia { kind: MediaConstraints['kind']; mime: string; bytes: number; width?: number; height?: number; duration?: number }

export async function mediaProbeStatus(): Promise<{ ready: boolean; version?: string }> {
  try {
    const executable = process.env.MEDIA_FFPROBE_PATH || process.env.DRAMA_FFPROBE_PATH || require('@ffprobe-installer/ffprobe').path;
    const { stdout } = await run(executable, ['-version'], { timeout: 2000, maxBuffer: 65536, windowsHide: true });
    return { ready: true, version: stdout.split(/\r?\n/)[0] };
  } catch { return { ready: false }; }
}

export function isPublicMediaIPv4(address: string): boolean {
  return isIP(address) === 4 && !denied.check(address, 'ipv4');
}

/** DNS is pinned to a checked address, including every redirect; byte/time limits bound resource use. */
export async function downloadMedia(url: string, file: string, maxBytes: number, timeout: number, redirects = 0): Promise<void> {
  const started = Date.now();
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || (target.port && target.port !== (target.protocol === 'https:' ? '443' : '80'))) throw new Error('仅允许公开 HTTP(S) 媒体地址');
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('媒体域名解析超时')), Math.min(timeout, 5000));
    lookup(target.hostname, { all: true, family: 4 }).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  if (!addresses.length || addresses.some(v => !isPublicMediaIPv4(v.address))) throw new Error('媒体地址必须解析到公网 IPv4');
  if (Date.now() - started >= timeout) throw new Error('媒体读取超时');
  await new Promise<void>((resolve, reject) => {
    const req = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
      method: 'GET', headers: { 'User-Agent': 'ModelHub-MediaValidation/1.0', 'Accept-Encoding': 'identity' },
      lookup: ((_host: any, options: any, callback: any) => options?.all ? callback(null, [addresses[0]]) : callback(null, addresses[0].address, 4)) as any,
    }, res => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.resume();
        if (redirects >= 3 || !res.headers.location) { reject(new Error('媒体重定向过多或无效')); return; }
        const remaining = timeout - (Date.now() - started);
        if (remaining <= 0) { reject(new Error('媒体读取超时')); return; }
        downloadMedia(new URL(res.headers.location, target).href, file, maxBytes, remaining, redirects + 1).then(resolve, reject); return;
      }
      if (status !== 200 || Number(res.headers['content-length']) > maxBytes || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) {
        res.destroy(); reject(new Error('媒体读取失败、过大或编码不支持')); return;
      }
      let bytes = 0;
      const limit = new Transform({ transform(chunk, _enc, callback) {
        bytes += chunk.length;
        callback(bytes > maxBytes ? new Error(`文件不能超过 ${maxBytes} 字节`) : null, chunk);
      } });
      pipeline(res, limit, createWriteStream(file, { flags: 'wx' })).then(() => resolve(), reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('媒体读取超时')), timeout - (Date.now() - started));
    req.on('error', reject); req.on('close', () => clearTimeout(timer)); req.end();
  });
}

export async function probeMedia(file: string): Promise<VerifiedMedia> {
  let executable = process.env.MEDIA_FFPROBE_PATH || process.env.DRAMA_FFPROBE_PATH;
  if (!executable) { try { executable = require('@ffprobe-installer/ffprobe').path; } catch { /* Handled below. */ } }
  if (!executable) throw new ServiceUnavailableException('媒体检测器未安装，请配置 MEDIA_FFPROBE_PATH 或安装 @ffprobe-installer/ffprobe');
  const handle = await open(file, 'r');
  const head = Buffer.alloc(64);
  try { await handle.read(head, 0, head.length, 0); } finally { await handle.close(); }
  // Reject playlists/manifests before probing, so they cannot refer to local or remote resources.
  const signature = head.toString('ascii', 0, 12);
  if (!(head[0] === 255 || head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    || /^GIF8[79]a/.test(signature) || /^(BM|RIFF|fLaC|OggS|ID3)/.test(signature)
    || head.subarray(0, 4).equals(Buffer.from([73,73,42,0])) || head.subarray(0, 4).equals(Buffer.from([77,77,0,42]))
    || head.subarray(0, 4).equals(Buffer.from([26,69,223,163])) || ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(head.toString('ascii', 4, 8)))) throw new Error('媒体格式不支持或内容损坏');
  let result: any;
  try {
    const { stdout } = await run(executable, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', file], { timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true });
    result = JSON.parse(stdout);
  } catch (error: any) {
    if (error.code === 'ENOENT' || error.code === 'EACCES') throw new ServiceUnavailableException('媒体检测器无法运行');
    throw new Error('媒体损坏或无法识别');
  }
  let mime = '';
  if (head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
  else if (head[0] === 255 && head[1] === 216 && head[2] === 255) mime = 'image/jpeg';
  else if (/^GIF8[79]a/.test(head.toString('ascii', 0, 6))) mime = 'image/gif';
  else if (head.subarray(0, 4).equals(Buffer.from([73,73,42,0])) || head.subarray(0, 4).equals(Buffer.from([77,77,0,42]))) mime = 'image/tiff';
  else if (head.toString('ascii', 0, 2) === 'BM') mime = 'image/bmp';
  else if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') mime = 'image/webp';
  else if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE') mime = 'audio/wav';
  else if (head.toString('ascii', 0, 4) === 'fLaC') mime = 'audio/flac';
  const streams = result.streams || [];
  const video = streams.find((v: any) => v.codec_type === 'video' && !v.disposition?.attached_pic);
  const audio = streams.find((v: any) => v.codec_type === 'audio');
  const format = String(result.format?.format_name || '');
  if (!mime && head.toString('ascii', 4, 8) === 'ftyp') mime = /avif|avis/.test(head.toString('ascii', 8, 32)) ? 'image/avif' : video ? (head.toString('ascii', 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4') : 'audio/mp4';
  if (!mime && ['moov', 'mdat', 'wide', 'free', 'skip'].includes(head.toString('ascii', 4, 8)) && format.includes('mov') && video) mime = 'video/quicktime';
  if (!mime && format === 'mp3' && audio) mime = 'audio/mpeg';
  if (!mime && format === 'ogg' && audio && !video) mime = 'audio/ogg';
  if (!mime && format.includes('webm') && video) mime = 'video/webm';
  const kind = mime.split('/')[0] as VerifiedMedia['kind'];
  if (!mime || (kind === 'image' && !video) || (kind === 'video' && !video) || (kind === 'audio' && (!audio || video))) throw new Error('媒体格式不支持或内容与容器不匹配');
  const duration = Math.max(Number(result.format?.duration) || 0, ...streams.map((s: any) => Number(s.duration) || 0));
  if (kind !== 'image' && (!Number.isFinite(duration) || duration <= 0)) throw new Error('无法读取媒体时长');
  let width = Number(video?.width), height = Number(video?.height);
  const rotation = Number(video?.side_data_list?.find((s: any) => s.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0);
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  if (kind !== 'audio' && (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)) throw new Error('无法读取媒体尺寸');
  return { kind, mime, bytes: (await stat(file)).size, ...(kind !== 'audio' ? { width, height } : {}), ...(kind !== 'image' ? { duration } : {}) };
}

export function checkMediaRange(actual: number | undefined, range: NumericRange | undefined, label: string) {
  if (!range) return;
  if (!Number.isFinite(actual) || (range.min !== undefined && (range.exclusive ? actual! <= range.min : actual! < range.min))
    || (range.max !== undefined && (range.exclusive ? actual! >= range.max : actual! > range.max))) throw new Error(`${label}超出允许范围 ${range.exclusive ? '(不含边界)' : ''} [${range.min ?? '-'}, ${range.max ?? '-'}]，实际 ${actual}`);
}

@Injectable()
export class MediaInputValidatorService {
  // Methods are replaceable in isolated tests; production always downloads and probes the actual bytes.
  protected download = downloadMedia;
  protected probe = probeMedia;

  async validate(input: Record<string, any>, definitions: ParamDefinitions): Promise<void> {
    const deadline = Date.now() + 120000;
    let count = 0, totalBytes = 0;
    const visit = async (values: Record<string, any>, defs: ParamDefinitions, prefix = '', depth = 0) => {
      if (depth > 12) throw new BadRequestException('媒体参数嵌套过深');
      for (const [key, def] of Object.entries(defs)) {
        const value = values?.[key], field = prefix + key;
        if (value == null || value === '' || (Array.isArray(value) && !value.length)) continue;
        if (def.media) {
          const media = def.media, urls = Array.isArray(value) ? value : [value];
          let duration = 0;
          for (const [index, url] of urls.entries()) {
            const path = Array.isArray(value) ? `${field}[${index}]` : field;
            if (++count > 64) throw new BadRequestException('单次请求媒体数量不能超过 64');
            const folder = await mkdtemp(join(tmpdir(), 'model-hub-media-'));
            try {
              const remaining = deadline - Date.now();
              if (remaining <= 0) throw new Error('媒体校验超时');
              const file = join(folder, 'input');
              const maxBytes = Math.min(media.maxBytes ?? MAX_FILE, MAX_FILE, 1024 * 1024 * 1024 - totalBytes);
              await this.download(url, file, maxBytes, Math.min(45000, remaining));
              const actual = await this.probe(file);
              totalBytes += actual.bytes;
              if (actual.bytes > maxBytes) throw new Error('媒体文件超过大小限制');
              if (actual.kind !== media.kind) throw new Error(`需要 ${media.kind}，实际为 ${actual.kind}`);
              if (media.accept?.length && !media.accept.some(v => v === actual.mime || v === `${actual.kind}/*`)) throw new Error(`不支持格式 ${actual.mime}`);
              checkMediaRange(actual.width, media.width, '宽度'); checkMediaRange(actual.height, media.height, '高度');
              if (media.resolution) { checkMediaRange(Math.min(actual.width!, actual.height!), { min: media.resolution.min }, '短边'); checkMediaRange(Math.max(actual.width!, actual.height!), { max: media.resolution.max }, '长边'); }
              checkMediaRange(actual.width! / actual.height!, media.aspectRatio, '宽高比');
              checkMediaRange(actual.duration, media.duration, '时长（秒）');
              duration += actual.duration || 0;
            } catch (error: any) {
              if (error instanceof ServiceUnavailableException) throw error;
              throw new BadRequestException({ message: '媒体校验失败', errors: [{ field: path, message: error.message }] });
            } finally { await rm(folder, { recursive: true, force: true }); }
          }
          try {
            checkMediaRange(duration, media.totalDuration, '素材总时长（秒）');
            const output = input[media.outputDurationField || 'duration'];
            if (media.maxInputOutputSeconds !== undefined && typeof output === 'number' && output > 0 && duration + output > media.maxInputOutputSeconds) throw new Error(`输入与输出总时长不能超过 ${media.maxInputOutputSeconds} 秒`);
          } catch (error: any) { throw new BadRequestException({ message: '媒体校验失败', errors: [{ field, message: error.message }] }); }
        } else if (def.type === 'object' && def.properties) await visit(value, def.properties, field + '.', depth + 1);
        else if (def.type === 'array' && def.items && Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) await visit({ item: value[i] }, { item: def.items }, `${field}[${i}].`, depth + 1);
        }
      }
    };
    await visit(input, definitions);
  }
}
