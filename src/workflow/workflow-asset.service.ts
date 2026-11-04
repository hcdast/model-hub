import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomUUID } from 'crypto';
import { TextDecoder } from 'util';
import { WorkflowAsset, WorkflowAssetDocument } from '../database/schemas/workflow-asset.schema';
import { WorkflowRun, WorkflowRunDocument } from '../database/schemas/workflow-run.schema';
import { LinkConversionConfigService } from '../admin/link-conversion-config.service';
import { createLinkConversionStorageAdapter } from '../link-conversion/adapters/akool-storagesvc.adapter';
import { S3WorkflowAssetStorageService } from './s3-workflow-asset-storage.service';

export const WORKFLOW_ASSET_MAX_BYTES = 20 * 1024 * 1024;
export const WORKFLOW_ASSET_TEXT_MAX_BYTES = 1024 * 1024;
export const WORKFLOW_ASSET_TYPES: Record<string, { ext: string; kind: 'image' | 'video' | 'audio' | 'text' }> = {
  'image/png': { ext: 'png', kind: 'image' },
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
  'image/gif': { ext: 'gif', kind: 'image' },
  'video/mp4': { ext: 'mp4', kind: 'video' },
  'video/webm': { ext: 'webm', kind: 'video' },
  'audio/mpeg': { ext: 'mp3', kind: 'audio' },
  'audio/wav': { ext: 'wav', kind: 'audio' },
  'audio/ogg': { ext: 'ogg', kind: 'audio' },
  'text/plain': { ext: 'txt', kind: 'text' },
  'application/json': { ext: 'json', kind: 'text' },
};

export function validateAssetFile(buffer: Buffer, mime: string): string | undefined {
  const type = WORKFLOW_ASSET_TYPES[mime];
  if (!type) throw new BadRequestException('不支持的文件类型；仅支持 PNG/JPEG/WebP/GIF、MP4/WebM、MP3/WAV/OGG、UTF-8 TXT/JSON');
  if (!buffer.length || buffer.length > WORKFLOW_ASSET_MAX_BYTES || (type.kind === 'text' && buffer.length > WORKFLOW_ASSET_TEXT_MAX_BYTES)) {
    throw new BadRequestException('文件不能为空；媒体最大 20 MiB，文本/JSON 最大 1 MiB');
  }
  if (type.kind === 'text') {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      if (text.includes('\u0000')) throw new Error('binary');
      if (mime === 'application/json') JSON.parse(text);
      return text;
    } catch { throw new BadRequestException('文本必须是有效 UTF-8；JSON 必须可解析'); }
  }
  const starts = (...bytes: number[]) => bytes.every((byte, i) => buffer[i] === byte);
  const at = (text: string, offset = 0) => buffer.toString('ascii', offset, offset + text.length) === text;
  const valid = mime === 'image/png' ? starts(137, 80, 78, 71, 13, 10, 26, 10)
    : mime === 'image/jpeg' ? starts(255, 216, 255)
    : mime === 'image/gif' ? at('GIF87a') || at('GIF89a')
    : mime === 'image/webp' ? at('RIFF') && at('WEBP', 8)
    : mime === 'video/mp4' ? at('ftyp', 4)
    : mime === 'video/webm' ? starts(0x1a, 0x45, 0xdf, 0xa3)
    : mime === 'audio/wav' ? at('RIFF') && at('WAVE', 8)
    : mime === 'audio/ogg' ? at('OggS')
    : mime === 'audio/mpeg' ? at('ID3') || (buffer[0] === 255 && (buffer[1] & 0xe0) === 0xe0)
    : false;
  if (!valid) throw new BadRequestException('文件内容与声明类型不匹配');
}

function safeName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 180) || '素材';
}

function publicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      host.includes('.') && !host.endsWith('.local') && !host.endsWith('.localhost') &&
      !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  } catch { return false; }
}

@Injectable()
export class WorkflowAssetService {
  constructor(
    @InjectModel(WorkflowAsset.name) private readonly assets: Model<WorkflowAssetDocument>,
    @InjectModel(WorkflowRun.name) private readonly runs: Model<WorkflowRunDocument>,
    private readonly config: LinkConversionConfigService,
    private readonly s3Storage: S3WorkflowAssetStorageService,
  ) {}

  private view(asset: WorkflowAsset) {
    const { id, name, kind, url, text, mimeType, size, source, workflowId, runId, nodeId } = asset;
    return { id, name, kind, url, text, mimeType, size, source, workflowId, runId, nodeId };
  }

  async list(ownerId: string, page: number, pageSize: number) {
    const filter = { ownerId };
    const [items, total] = await Promise.all([
      this.assets.find(filter).sort({ createdAt: -1, id: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean().exec(),
      this.assets.countDocuments(filter).exec(),
    ]);
    return { items: items.map(item => this.view(item)), total, page, pageSize };
  }

  async upload(ownerId: string, file: { buffer: Buffer; mimetype: string; originalname: string }, source = 'upload', origin?: { workflowId: string; runId: string; nodeId: string }) {
    if (!file?.buffer) throw new BadRequestException('请选择上传文件');
    const text = validateAssetFile(file.buffer, file.mimetype);
    const type = WORKFLOW_ASSET_TYPES[file.mimetype];
    const id = randomUUID();
    const ownerKey = createHash('sha256').update(ownerId).digest('hex');
    let url: string;
    if (this.s3Storage.enabled) {
      url = await this.s3Storage.upload(file.buffer, { assetId: id, ownerKey, fileExt: type.ext, contentType: file.mimetype });
    } else {
      const config = await this.config.getEffectiveConfig();
      if (!config.storagesvc.host?.trim() || !config.storagesvc.jwt_secret?.trim() || !config.storage_config.bucket?.trim()) {
        throw new ServiceUnavailableException('素材存储未配置：请在管理后台链接转换配置中设置 storagesvc.host、storagesvc.jwt_secret 与 storage_config.bucket');
      }
      try {
        url = await createLinkConversionStorageAdapter(config).upload(file.buffer, {
          fileExt: type.ext, contentType: file.mimetype,
          bizType: config.storage_config.biz_type || 'model-hub-link-conversion',
          bizId: `asset_${id}`, teamId: `workflow_${ownerKey}`, uid: 0,
          bucket: config.storage_config.bucket, uploadTimeoutMs: config.timeout.upload_ms,
        });
      } catch {
        throw new ServiceUnavailableException('素材存储上传失败，请管理员检查现有存储服务配置和连通性');
      }
    }
    if (!publicHttpUrl(url)) throw new ServiceUnavailableException('存储服务未返回供应商可访问的 HTTP(S) 资源 URL；请检查 final_url/CDN 配置');
    let asset: WorkflowAssetDocument;
    try {
      asset = await this.assets.create({ id, ownerId, name: safeName(file.originalname), kind: type.kind, url, text, mimeType: file.mimetype, size: file.buffer.length, source, ...origin });
    } catch {
      if (this.s3Storage.enabled) this.s3Storage.logMetadataFailure({ assetId: id, ownerKey, fileExt: type.ext });
      throw new ServiceUnavailableException('素材元数据保存失败，请稍后重试');
    }
    return this.view(asset);
  }

  async fromOutput(ownerId: string, input: { workflowId: string; runId: string; nodeId: string; name?: string }) {
    const run = await this.runs.findOne({ runId: input.runId, workflowId: input.workflowId, triggerId: ownerId }).lean().exec();
    if (!run) throw new NotFoundException('运行记录不存在');
    const state = run.nodeStates.find(node => node.nodeId === input.nodeId);
    if (!state || state.status !== 'succeeded' || state.output == null) throw new BadRequestException('该节点没有成功的真实输出');
    const output = state.output;
    for (const kind of ['image', 'video', 'audio'] as const) {
      const url = output[kind];
      if (typeof url !== 'string') continue;
      if (!publicHttpUrl(url)) throw new BadRequestException('输出资源不是可访问的 HTTP(S) URL，无法保存为媒体素材');
      const asset = await this.assets.create({ id: randomUUID(), ownerId, name: safeName(input.name || `${input.nodeId} 输出`), kind, url, mimeType: `${kind}/*`, source: 'output-reference', workflowId: input.workflowId, runId: input.runId, nodeId: input.nodeId });
      return this.view(asset);
    }
    const isText = typeof output === 'string' || typeof output.text === 'string';
    const text = typeof output === 'string' ? output : isText ? output.text : JSON.stringify(output.json ?? output.result ?? output, null, 2);
    return this.upload(ownerId, { buffer: Buffer.from(text, 'utf8'), mimetype: isText ? 'text/plain' : 'application/json', originalname: input.name || `${input.nodeId}.${isText ? 'txt' : 'json'}` }, 'output-text', { workflowId: input.workflowId, runId: input.runId, nodeId: input.nodeId });
  }

  async delete(ownerId: string, id: string) {
    const result = await this.assets.deleteOne({ id, ownerId }).exec();
    if (!result.deletedCount) throw new NotFoundException('素材不存在');
    // 现有存储适配器仅支持上传；删除素材记录不撤销工作流或第三方输出已引用的 URL。
    return { id, storageObjectDeleted: false };
  }
}
