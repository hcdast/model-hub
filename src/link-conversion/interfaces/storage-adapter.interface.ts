/**
 * 链接转换上传上下文（对齐 AGI-Content-Job storagesvcUploadFile 的 opts）
 */
export interface StoragesvcUploadContext {
  fileExt: string;
  contentType: string;
  bizType: string;
  bizId: string;
  teamId: string;
  uid: number;
  bucket?: string;
  uploadTimeoutMs: number;
}

export interface StorageAdapter {
  upload(buffer: Buffer, ctx: StoragesvcUploadContext): Promise<string>;
}
