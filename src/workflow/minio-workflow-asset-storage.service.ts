import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import * as http from 'http';
import * as https from 'https';
import { isIP } from 'net';
import { Client } from 'minio';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig, WorkflowAssetMinioConfig } from '../config/interfaces/config.interface';

interface UploadScope {
  controller: AbortController;
  deadline: number;
}

const MAX_BYTES = 20 * 1024 * 1024;
// minio 8.0.6 internal/request.js otherwise retries these with uncancellable sleeps.
const RETRY_STATUSES = new Set([408, 429, 499, 500, 502, 503, 504, 520]);
const SAFE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function invalid(field: string): never {
  throw new Error(`Invalid workflowAssetStorage.${field}`);
}

function validateConfig(value: WorkflowAssetMinioConfig | undefined): WorkflowAssetMinioConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('minio');
  const host = value.endPoint;
  if (typeof host !== 'string' || host.length > 253 || (!isIP(host) &&
    !host.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)))) invalid('minio.endPoint');
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) invalid('minio.port');
  if (typeof value.useSSL !== 'boolean') invalid('minio.useSSL');
  if (typeof value.bucket !== 'string' || value.bucket.length < 3 || value.bucket.length > 63 ||
    !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value.bucket) || /\.\.|\.-|-\./.test(value.bucket) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(value.bucket)) invalid('minio.bucket');
  if (value.region !== undefined && (typeof value.region !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(value.region))) invalid('minio.region');
  if (value.allowInsecureHttp !== undefined && typeof value.allowInsecureHttp !== 'boolean') invalid('minio.allowInsecureHttp');
  const timeout = value.uploadTimeoutMs === undefined ? 60000 : value.uploadTimeoutMs;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 300000) invalid('minio.uploadTimeoutMs');
  const prefix = value.pathPrefix === undefined ? 'workflow-assets' : value.pathPrefix;
  if (typeof prefix !== 'string' || !prefix.split('/').every(segment => SAFE_SEGMENT.test(segment))) invalid('minio.pathPrefix');
  let base: URL;
  try {
    if (typeof value.publicBaseUrl !== 'string' || value.publicBaseUrl.trim() !== value.publicBaseUrl || /[\\\s]/.test(value.publicBaseUrl)) invalid('minio.publicBaseUrl');
    base = new URL(value.publicBaseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || !base.hostname || base.username || base.password ||
      value.publicBaseUrl.includes('?') || value.publicBaseUrl.includes('#')) invalid('minio.publicBaseUrl');
    // Match WorkflowAssetService's resource URL boundary before writing an object.
    const publicHost = base.hostname.toLowerCase();
    if (!publicHost.includes('.') || publicHost.endsWith('.local') || publicHost.endsWith('.localhost') ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(publicHost)) invalid('minio.publicBaseUrl');
    const rawPath = value.publicBaseUrl.replace(/^https?:\/\/[^/]+/, '');
    for (const segment of rawPath.split('/')) {
      const decoded = decodeURIComponent(segment);
      if (decoded === '.' || decoded === '..' || /[\\/\x00-\x1f\x7f]/.test(decoded)) invalid('minio.publicBaseUrl');
    }
  } catch {
    invalid('minio.publicBaseUrl');
  }
  if ((!value.useSSL || base.protocol === 'http:') && value.allowInsecureHttp !== true) invalid('minio.allowInsecureHttp');
  return { ...value, publicBaseUrl: base.href.replace(/\/+$/, ''), pathPrefix: prefix, uploadTimeoutMs: timeout };
}

@Injectable()
export class MinioWorkflowAssetStorageService {
  private readonly logger = new Logger(MinioWorkflowAssetStorageService.name);
  readonly enabled: boolean;
  private readonly client?: Client;
  private readonly config?: WorkflowAssetMinioConfig;
  private readonly uploads = new AsyncLocalStorage<UploadScope>();

  constructor(@Inject(APP_CONFIG) appConfig: AppConfig) {
    const storage = appConfig.workflowAssetStorage;
    if (storage === undefined || storage?.provider === 'storagesvc') {
      this.enabled = false;
      return;
    }
    if (storage?.provider !== 'minio') invalid('provider');
    this.enabled = true;
    this.config = validateConfig(storage.minio);
    const accessKey = process.env.WORKFLOW_ASSET_MINIO_ACCESS_KEY_ID;
    const secretKey = process.env.WORKFLOW_ASSET_MINIO_SECRET_ACCESS_KEY;
    if (!accessKey?.trim() || !secretKey?.trim()) invalid('minio.credentials');
    const network = this.config.useSSL ? https : http;
    // The SDK custom transport keeps signing and region discovery in the SDK.
    const request = (options: http.RequestOptions, callback: (response: http.IncomingMessage) => void): http.ClientRequest => {
      const scope = this.uploads.getStore();
      if (!scope || scope.controller.signal.aborted || Date.now() >= scope.deadline) {
        throw new Error('Workflow asset upload deadline exceeded');
      }
      const req = network.request({ ...options, signal: scope.controller.signal }, response => {
        const abortResponse = () => response.destroy(new Error('Workflow asset upload deadline exceeded'));
        scope.controller.signal.addEventListener('abort', abortResponse, { once: true });
        response.once('close', () => scope.controller.signal.removeEventListener('abort', abortResponse));
        if (RETRY_STATUSES.has(response.statusCode ?? 0)) {
          // requestWithRetry does not retry request errors. Do not hand it a
          // retryable response, which would start an uncancellable backoff.
          req.destroy(new Error('Workflow asset storage unavailable'));
          response.destroy();
          return;
        }
        callback(response);
      });
      return req;
    };
    try {
      this.client = new Client({
        endPoint: this.config.endPoint, port: this.config.port, useSSL: this.config.useSSL,
        region: this.config.region, accessKey, secretKey, pathStyle: true,
        transport: { request: request as typeof http.request },
      });
    } catch {
      invalid('minio.client');
    }
  }

  logMetadataFailure(context: { assetId: string; ownerKey: string; fileExt: string }): void {
    if (!this.config || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.assetId) ||
      !/^[0-9a-f]{64}$/.test(context.ownerKey) || !/^[a-z0-9]{1,10}$/.test(context.fileExt)) return;
    const objectKey = `${this.config.pathPrefix}/${context.ownerKey}/${context.assetId}.${context.fileExt}`;
    this.logger.error({ category: 'metadata_failure', assetId: context.assetId, objectKey });
  }

  async upload(buffer: Buffer, context: { assetId: string; ownerKey: string; fileExt: string; contentType: string }): Promise<string> {
    if (!this.client || !this.config || !Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.assetId) ||
      !/^[0-9a-f]{64}$/.test(context.ownerKey) || !/^[a-z0-9]{1,10}$/.test(context.fileExt) ||
      typeof context.contentType !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(context.contentType)) {
      throw new ServiceUnavailableException('Workflow asset storage unavailable');
    }
    const key = `${this.config.pathPrefix}/${context.ownerKey}/${context.assetId}.${context.fileExt}`;
    const url = `${this.config.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const controller = new AbortController();
    const timeout = this.config.uploadTimeoutMs!;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      await this.uploads.run({ controller, deadline: Date.now() + timeout }, () =>
        // 8.0.6 internally collects both Buffer and Readable inputs into a new
        // Buffer; the application adds no copy. 20 MiB stays below 64 MiB parts.
        this.client!.putObject(this.config!.bucket, key, buffer, buffer.length, { 'Content-Type': context.contentType }));
      if (controller.signal.aborted) throw new Error('Upload deadline exceeded');
      return url;
    } catch {
      // Never attach raw SDK errors: XML and request context may contain secrets.
      this.logger.error({ category: controller.signal.aborted ? 'timeout' : 'storage_failure', assetId: context.assetId });
      throw new ServiceUnavailableException('Workflow asset storage unavailable');
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
