/**
 * 从任务 payload 中的远程 URL 提取资源元数据（管理端展示 / 异步落库）。
 */

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { fetchAndParseMp4Metadata } from './mp4-metadata.util';

export enum ResourceType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  OTHER = 'other',
}

export interface ResourceMetadata {
  resourceType: ResourceType;
  mimeType: string;
  fileSize: number;
  duration?: number;
  resolution?: { width: number; height: number };
  aspectRatio?: string;
  codec?: string;
  bitrate?: number;
  dimensions?: { width: number; height: number };
  colorSpace?: string;
  dpi?: number;
  sampleRate?: number;
  channels?: number;
  audioBitrate?: number;
  format?: string;
  createdAt?: Date;
  modifiedAt?: Date;
}

interface ExtractedUrl {
  url: string;
  resourceType: ResourceType;
}

@Injectable()
export class RemoteMetadataExtractorService {
  private readonly logger = new Logger(RemoteMetadataExtractorService.name);

  async extractFromUrl(url: string): Promise<ResourceMetadata> {
    this.logger.log(`提取元数据: ${url}`);

    try {
      const headResponse = await axios.head(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ModelHub/1.0)',
        },
        maxRedirects: 5,
      });

      const contentType = headResponse.headers['content-type'] || 'application/octet-stream';
      const contentLength = parseInt(headResponse.headers['content-length'] || '0', 10);
      const resourceType = this.guessResourceType(contentType, url);

      const baseMetadata: ResourceMetadata = {
        resourceType,
        mimeType: contentType.split(';')[0].trim(),
        fileSize: contentLength,
        format: this.getFormat(contentType, url),
      };

      switch (resourceType) {
        case ResourceType.IMAGE:
          return await this.extractImageMetadata(url, baseMetadata);
        case ResourceType.VIDEO:
          return await this.extractVideoMetadata(url, baseMetadata);
        case ResourceType.AUDIO:
          return await this.extractAudioMetadata(url, baseMetadata);
        default:
          return baseMetadata;
      }
    } catch (error) {
      this.logger.warn(`元数据提取失败: ${url}`, error);
      return {
        resourceType: ResourceType.OTHER,
        mimeType: 'application/octet-stream',
        fileSize: 0,
      };
    }
  }

  async extractFromUrls(urls: string[]): Promise<Map<string, ResourceMetadata>> {
    const results = new Map<string, ResourceMetadata>();
    const concurrency = 3;
    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);
      const promises = batch.map(async (url) => {
        const metadata = await this.extractFromUrl(url);
        return { url, metadata };
      });

      const batchResults = await Promise.allSettled(promises);
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.set(result.value.url, result.value.metadata);
        }
      }
    }

    return results;
  }

  private async extractImageMetadata(
    url: string,
    baseMetadata: ResourceMetadata,
  ): Promise<ResourceMetadata> {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { Range: 'bytes=0-8191' },
        timeout: 10000,
      });

      const buffer = Buffer.from(response.data);
      const dimensions = this.parseImageDimensions(buffer, baseMetadata.mimeType);

      if (dimensions) {
        return {
          ...baseMetadata,
          dimensions,
          aspectRatio: this.calculateAspectRatio(dimensions.width, dimensions.height),
        };
      }

      return baseMetadata;
    } catch (error) {
      this.logger.warn(`图片元数据提取失败: ${url}`, error);
      return baseMetadata;
    }
  }

  private parseImageDimensions(
    buffer: Buffer,
    mimeType: string,
  ): { width: number; height: number } | undefined {
    if (mimeType.includes('png') || (buffer[0] === 0x89 && buffer[1] === 0x50)) {
      return this.parsePngDimensions(buffer);
    }

    if (mimeType.includes('jpeg') || mimeType.includes('jpg') || (buffer[0] === 0xFF && buffer[1] === 0xD8)) {
      return this.parseJpegDimensions(buffer);
    }

    if (mimeType.includes('gif') || buffer.toString('ascii', 0, 3) === 'GIF') {
      return this.parseGifDimensions(buffer);
    }

    if (mimeType.includes('webp') || (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')) {
      return this.parseWebpDimensions(buffer);
    }

    return undefined;
  }

  private parsePngDimensions(buffer: Buffer): { width: number; height: number } | undefined {
    try {
      if (buffer.length >= 24) {
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        if (width > 0 && height > 0 && width < 65536 && height < 65536) {
          return { width, height };
        }
      }
    } catch { /* ignore */ }
    return undefined;
  }

  private parseJpegDimensions(buffer: Buffer): { width: number; height: number } | undefined {
    try {
      for (let i = 0; i < buffer.length - 9; i++) {
        if (buffer[i] === 0xFF && (buffer[i + 1] === 0xC0 || buffer[i + 1] === 0xC2)) {
          const height = buffer.readUInt16BE(i + 5);
          const width = buffer.readUInt16BE(i + 7);
          if (width > 0 && height > 0 && width < 65536 && height < 65536) {
            return { width, height };
          }
        }
      }
    } catch { /* ignore */ }
    return undefined;
  }

  private parseGifDimensions(buffer: Buffer): { width: number; height: number } | undefined {
    try {
      if (buffer.length >= 10) {
        const width = buffer.readUInt16LE(6);
        const height = buffer.readUInt16LE(8);
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
    } catch { /* ignore */ }
    return undefined;
  }

  private parseWebpDimensions(buffer: Buffer): { width: number; height: number } | undefined {
    try {
      if (buffer.length >= 30 && buffer.toString('ascii', 12, 16) === 'VP8 ') {
        const width = buffer.readUInt16LE(26) & 0x3FFF;
        const height = buffer.readUInt16LE(28) & 0x3FFF;
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
      if (buffer.length >= 25 && buffer.toString('ascii', 12, 16) === 'VP8L') {
        const bits = buffer.readUInt32LE(21);
        const width = (bits & 0x3FFF) + 1;
        const height = ((bits >> 14) & 0x3FFF) + 1;
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
    } catch { /* ignore */ }
    return undefined;
  }

  private async extractVideoMetadata(
    url: string,
    baseMetadata: ResourceMetadata,
  ): Promise<ResourceMetadata> {
    const lower = url.toLowerCase().split('?')[0];
    const looksMp4 =
      baseMetadata.mimeType.includes('video/mp4') ||
      /\.(mp4|m4v)(\s|$)/.test(lower);

    if (!looksMp4) {
      return baseMetadata;
    }

    try {
      const mp4 = await fetchAndParseMp4Metadata(url);
      if (!mp4) return baseMetadata;

      const duration = mp4.durationSeconds;
      const resolution =
        mp4.width != null && mp4.height != null
          ? { width: mp4.width, height: mp4.height }
          : undefined;

      let bitrate = baseMetadata.bitrate;
      if (
        bitrate == null &&
        baseMetadata.fileSize > 0 &&
        duration != null &&
        duration > 0
      ) {
        bitrate = Math.round((baseMetadata.fileSize * 8) / duration);
      }

      const aspectRatio =
        resolution != null
          ? this.calculateAspectRatio(resolution.width, resolution.height)
          : undefined;

      return {
        ...baseMetadata,
        ...(duration != null && duration > 0 ? { duration } : {}),
        ...(resolution ? { resolution, ...(aspectRatio ? { aspectRatio } : {}) } : {}),
        ...(mp4.codecFourCc ? { codec: mp4.codecFourCc } : {}),
        ...(bitrate != null && bitrate > 0 ? { bitrate } : {}),
      };
    } catch {
      return baseMetadata;
    }
  }

  private async extractAudioMetadata(
    _url: string,
    baseMetadata: ResourceMetadata,
  ): Promise<ResourceMetadata> {
    return baseMetadata;
  }

  extractUrls(obj: any, prefix = ''): ExtractedUrl[] {
    if (typeof obj === 'string' && /^https?:\/\//.test(obj)) {
      return [{ url: obj, resourceType: this.guessResourceTypeFromUrl(obj) }];
    }
    if (Array.isArray(obj)) {
      return obj.flatMap((item) => this.extractUrls(item, prefix));
    }
    if (!obj || typeof obj !== 'object') return [];

    const urls: ExtractedUrl[] = [];
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && /^https?:\/\//.test(value)) {
        urls.push({
          url: value,
          resourceType: this.guessResourceTypeFromUrl(value),
        });
      } else if (typeof value === 'object' && value !== null) {
        urls.push(...this.extractUrls(value, prefix ? `${prefix}.${key}` : key));
      }
    }

    return urls;
  }

  private guessResourceType(mimeType: string, url: string): ResourceType {
    if (mimeType.startsWith('image/')) return ResourceType.IMAGE;
    if (mimeType.startsWith('video/')) return ResourceType.VIDEO;
    if (mimeType.startsWith('audio/')) return ResourceType.AUDIO;
    if (mimeType === 'application/pdf' || mimeType.startsWith('application/vnd.')) {
      return ResourceType.DOCUMENT;
    }

    return this.guessResourceTypeFromUrl(url);
  }

  private guessResourceTypeFromUrl(url: string): ResourceType {
    const lowerUrl = url.toLowerCase().split('?')[0];
    if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|ico|tiff)$/.test(lowerUrl)) return ResourceType.IMAGE;
    if (/\.(mp4|avi|mov|wmv|flv|webm|mkv|m4v)$/.test(lowerUrl)) return ResourceType.VIDEO;
    if (/\.(mp3|wav|ogg|aac|flac|m4a|wma)$/.test(lowerUrl)) return ResourceType.AUDIO;
    if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/.test(lowerUrl)) return ResourceType.DOCUMENT;
    return ResourceType.OTHER;
  }

  private getFormat(mimeType: string, url: string): string {
    const formatMap: Record<string, string> = {
      'image/jpeg': 'JPEG',
      'image/png': 'PNG',
      'image/gif': 'GIF',
      'image/webp': 'WebP',
      'video/mp4': 'MP4',
      'video/webm': 'WebM',
      'video/quicktime': 'MOV',
      'audio/mpeg': 'MP3',
      'audio/wav': 'WAV',
      'audio/ogg': 'OGG',
      'application/pdf': 'PDF',
    };

    const mime = mimeType.split(';')[0].trim();
    if (formatMap[mime]) return formatMap[mime];

    const ext = url.toLowerCase().split('?')[0].split('.').pop();
    if (ext) return ext.toUpperCase();

    return mime.split('/')[1]?.toUpperCase() || 'Unknown';
  }

  private calculateAspectRatio(width: number, height: number): string {
    const gcd = this.greatestCommonDivisor(width, height);
    const ratioWidth = width / gcd;
    const ratioHeight = height / gcd;

    const commonRatios: Record<string, string> = {
      '16:9': '16:9',
      '4:3': '4:3',
      '3:2': '3:2',
      '1:1': '1:1',
      '21:9': '21:9',
      '9:16': '9:16',
      '3:4': '3:4',
      '2:3': '2:3',
    };

    const ratioKey = `${ratioWidth}:${ratioHeight}`;
    return commonRatios[ratioKey] || ratioKey;
  }

  private greatestCommonDivisor(a: number, b: number): number {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) {
      const t = b;
      b = a % b;
      a = t;
    }
    return a;
  }

  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts: string[] = [];
    if (hours > 0) parts.push(hours.toString().padStart(2, '0'));
    parts.push(minutes.toString().padStart(2, '0'));
    parts.push(secs.toString().padStart(2, '0'));

    return parts.join(':');
  }

  formatResolution(width: number, height: number): string {
    return `${width}×${height}`;
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
  }
}
