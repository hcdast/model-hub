import { Logger } from '@nestjs/common';
import axios from 'axios';
import {
  createStorageServiceSdk,
  type InternalMultipartInitDto,
  type InternalUploadSignatureDto,
  type StorageServiceSdk,
} from '@akool-sdk/storage';
import {
  StorageAdapter,
  StoragesvcUploadContext,
} from '../interfaces/storage-adapter.interface';
import type { LinkConversionConfig } from '../../admin/link-conversion-config.types';

/** 与 AGI-Content-Job util_workspace.storagesvcUploadFile 一致：≥50MB 走分片 */
const MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024;

/** 网关可能返回 part_urls（upload_url）或 urls（url），与 SDK .d.ts 局部定义不一致，运行时统一归一化 */
function normalizeBatchPartUrls(batch: unknown): Array<{
  part_number: number;
  upload_url: string;
}> {
  const b = batch as {
    part_urls?: Array<{ upload_url?: string; part_number: number }>;
    urls?: Array<{ url?: string; part_number: number }>;
  };
  if (Array.isArray(b.part_urls) && b.part_urls.length > 0) {
    return b.part_urls.map(p => ({
      part_number: p.part_number,
      upload_url: p.upload_url || '',
    })).filter(p => p.upload_url);
  }
  if (Array.isArray(b.urls) && b.urls.length > 0) {
    return b.urls
      .map(p => ({
        part_number: p.part_number,
        upload_url: p.url || '',
      }))
      .filter(p => p.upload_url);
  }
  return [];
}

/**
 * 通过 @akool-sdk/storage 上传（generateSignature / 分片），不直接使用 AWS SDK。
 */
export class AkoolStoragesvcAdapter implements StorageAdapter {
  private readonly logger = new Logger(AkoolStoragesvcAdapter.name);

  constructor(private readonly sdk: StorageServiceSdk) {}

  async upload(buffer: Buffer, ctx: StoragesvcUploadContext): Promise<string> {
    const fileExt = ctx.fileExt.startsWith('.') ? ctx.fileExt : `.${ctx.fileExt}`;

    if (buffer.length >= MULTIPART_THRESHOLD_BYTES) {
      return this.multipartUpload(buffer, ctx, fileExt);
    }
    return this.singlePutUpload(buffer, ctx, fileExt);
  }

  /**
   * 与 Job 侧 opts 对齐；biz_id、bucket 由网关扩展字段消费，故对 DTO 做断言。
   */
  private toSignatureDto(
    buffer: Buffer,
    ctx: StoragesvcUploadContext,
    fileExt: string,
  ): InternalUploadSignatureDto {
    return {
      biz_type: ctx.bizType,
      mime_type: ctx.contentType,
      file_ext: fileExt,
      file_size: buffer.length,
      team_id: ctx.teamId,
      uid: ctx.uid,
      ...(ctx.bizId ? { biz_id: ctx.bizId } : {}),
      ...(ctx.bucket ? { bucket: ctx.bucket } : {}),
    } as InternalUploadSignatureDto;
  }

  private toMultipartInitDto(
    buffer: Buffer,
    ctx: StoragesvcUploadContext,
    fileExt: string,
  ): InternalMultipartInitDto {
    return {
      biz_type: ctx.bizType,
      mime_type: ctx.contentType,
      file_ext: fileExt,
      file_size: buffer.length,
      team_id: ctx.teamId,
      uid: ctx.uid,
      ...(ctx.bizId ? { biz_id: ctx.bizId } : {}),
      ...(ctx.bucket ? { bucket: ctx.bucket } : {}),
    } as InternalMultipartInitDto;
  }

  private async singlePutUpload(
    buffer: Buffer,
    ctx: StoragesvcUploadContext,
    fileExt: string,
  ): Promise<string> {
    const dto = this.toSignatureDto(buffer, ctx, fileExt);
    const signature = await this.sdk.upload.generateSignature(dto);

    const headers: Record<string, string> = {};
    const ct = signature.content_type || ctx.contentType;
    if (ct) {
      headers['Content-Type'] = ct;
    }

    await axios.put(signature.upload_url, buffer, {
      headers,
      timeout: ctx.uploadTimeoutMs,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: s => s >= 200 && s < 300,
    });

    if (!signature.final_url) {
      throw new Error('storagesvc generateSignature 响应缺少 final_url');
    }
    this.logger.debug(`storagesvc 单文件上传完成 object_key=${signature.object_key || ''}`);
    return signature.final_url;
  }

  private async multipartUpload(
    buffer: Buffer,
    ctx: StoragesvcUploadContext,
    fileExt: string,
  ): Promise<string> {
    const dto = this.toMultipartInitDto(buffer, ctx, fileExt);
    let sessionId: string | null = null;
    try {
      const init = await this.sdk.upload.initMultipartUpload(dto);
      sessionId = init.session_id;

      const fileSize = buffer.length;
      const partSize = 10 * 1024 * 1024;
      const totalParts = Math.max(1, Math.ceil(fileSize / partSize));
      const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);

      const batchPartUrlsResult = await this.sdk.upload.getBatchPartUrls({
        session_id: sessionId,
        part_numbers: partNumbers,
      });

      const urls = normalizeBatchPartUrls(batchPartUrlsResult);
      if (!urls.length) {
        throw new Error(
          `storagesvc getBatchPartUrls 未返回有效分片 URL: ${JSON.stringify(batchPartUrlsResult)}`,
        );
      }

      const headers: Record<string, string> = {};
      const ct = ctx.contentType;
      if (ct) {
        headers['Content-Type'] = ct;
      }

      const chunkSize = Math.ceil(fileSize / totalParts);
      const parts: { etag: string; part_number: number }[] = [];

      for (let i = 0; i < urls.length; i++) {
        const { part_number: partNumber, upload_url: putUrl } = urls[i];
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, fileSize);
        const partBuffer = buffer.subarray(start, end);

        if (!putUrl) {
          throw new Error(`分片 ${partNumber} 缺少 upload_url`);
        }

        const res = await axios.put(putUrl, partBuffer, {
          headers,
          timeout: ctx.uploadTimeoutMs,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          validateStatus: s => s >= 200 && s < 300,
        });

        let etag = res.headers.etag ?? (res.headers as Record<string, string>)['ETag'];
        if (!etag) {
          throw new Error(`分片 ${partNumber} 上传成功但未收到 ETag`);
        }
        etag = String(etag).replace(/^"|"$/g, '');
        parts.push({ etag, part_number: partNumber });
      }

      const completeResult = await this.sdk.upload.completeMultipartUpload(sessionId, {
        parts,
      });

      if (!completeResult?.url) {
        throw new Error(
          `storagesvc completeMultipartUpload 响应缺少 url: ${JSON.stringify(completeResult)}`,
        );
      }
      this.logger.debug(`storagesvc 分片上传完成 session=${sessionId}`);
      return completeResult.url;
    } catch (err) {
      if (sessionId) {
        try {
          await this.sdk.upload.abortMultipartUpload(sessionId);
        } catch (abortErr) {
          this.logger.warn(
            `abortMultipartUpload 失败: ${abortErr instanceof Error ? abortErr.message : String(abortErr)}`,
          );
        }
      }
      throw err;
    }
  }
}

/** 按管理端「链接转换」配置构造 storagesvc 适配器（与 AGI-Content-Job storagesvc 初始化对齐） */
export function createLinkConversionStorageAdapter(
  config: LinkConversionConfig,
): StorageAdapter {
  const st = config.storagesvc;
  const sdk = createStorageServiceSdk({
    baseUrl: st.host,
    jwt: {
      secret: st.jwt_secret,
      roles: ['app'],
      userIdPrefix: st.jwt_user_id_prefix ?? 'model-hub-lc-',
      issuer: st.jwt_issuer ?? 'model-hub',
      expiresIn: st.jwt_expires_in ?? '2m',
    },
    resilience: st.resilience,
    timeoutMs: st.timeout_ms ?? 10_000,
  });
  return new AkoolStoragesvcAdapter(sdk);
}
