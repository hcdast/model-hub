/** Object keys are relative to the bucket, independent of the public URL. */
export const MODELHUB_STORAGE_ROOT = 'modelhub';

// Register new features here; callers select a purpose, never supply a path.
export const ASSET_STORAGE_PATHS = {
  upload: 'workflow/uploads',
  'output-text': 'workflow/outputs',
  'drama-upload': 'short-drama/uploads',
  'drama-archive': 'short-drama/archives',
  'drama-render': 'short-drama/renders',
} as const;

export type AssetStoragePurpose = keyof typeof ASSET_STORAGE_PATHS;
export interface AssetStorageContext {
  assetId: string;
  ownerKey: string;
  fileExt: string;
  contentType: string;
  purpose?: AssetStoragePurpose;
}

export function normalizeAssetStoragePrefix(value: unknown = MODELHUB_STORAGE_ROOT): string {
  if (typeof value !== 'string' || !value.split('/').every(segment => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(segment))) {
    throw new Error('Invalid asset storage prefix');
  }
  // Upgrade the old default even when it remains in a deployed configuration.
  if (value === 'workflow-assets') return MODELHUB_STORAGE_ROOT;
  return value === MODELHUB_STORAGE_ROOT || value.startsWith(`${MODELHUB_STORAGE_ROOT}/`)
    ? value : `${MODELHUB_STORAGE_ROOT}/${value}`;
}

export function buildAssetStorageKey(prefix: string | undefined, context: AssetStorageContext): string {
  const purpose = context.purpose === undefined ? 'upload' : context.purpose;
  if (!Object.prototype.hasOwnProperty.call(ASSET_STORAGE_PATHS, purpose) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.assetId) ||
    !/^[0-9a-f]{64}$/.test(context.ownerKey) || !/^[a-z0-9]{1,10}$/.test(context.fileExt) ||
    typeof context.contentType !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(context.contentType)) {
    throw new Error('Invalid asset storage context');
  }
  const mediaType = context.contentType.split('/')[0];
  const kind = ['image', 'video', 'audio'].includes(mediaType) ? mediaType
    : ['text/plain', 'application/json'].includes(context.contentType) ? 'text' : undefined;
  if (!kind) throw new Error('Invalid asset storage media type');
  return `${normalizeAssetStoragePrefix(prefix)}/${ASSET_STORAGE_PATHS[purpose]}/${kind}/${context.ownerKey}/${context.assetId}.${context.fileExt}`;
}
