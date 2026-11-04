import type { MediaConstraints, ParamDefinition } from '../interfaces/param-definition.interface';

/** Convert explicit legacy metadata; prose is never interpreted as executable rules. */
export function legacyMediaConstraints(name: string, raw: any): MediaConstraints | undefined {
  const kind = /^(images?|image_url|first_frame|last_frame|last_image|first_image|mask|start_image|end_image)$/.test(name) ? 'image'
    : /^(videos?|video_url)$/.test(name) ? 'video' : /^(audios?|audio_url)$/.test(name) ? 'audio' : undefined;
  if (!kind || !['string', 'array'].includes(raw.type)) return undefined;
  const media: MediaConstraints = { kind, accept: [`${kind}/*`] };
  const mb = raw.size?.max ?? raw.maxSize;
  if (Number.isFinite(mb) && mb > 0) media.maxBytes = Math.round(mb * 1024 * 1024);
  for (const key of ['resolution', 'duration', 'totalDuration', 'width', 'height'] as const) {
    const source = raw[key] || (key === 'duration' ? { min: raw.minDuration, max: raw.maxDuration } : undefined);
    if (source) {
      const range = Object.fromEntries(['min', 'max'].filter(k => Number.isFinite(source[k])).map(k => [k, source[k]]));
      if (source.exclusive === true) range.exclusive = true;
      if (Object.keys(range).length) media[key] = range;
    }
  }
  const ratio = raw.aspectRatio || raw.ratio;
  if (ratio) {
    media.aspectRatio = {};
    if (Number.isFinite(ratio.min)) media.aspectRatio.min = ratio.min;
    if (Number.isFinite(ratio.max)) {
      media.aspectRatio.max = ratio.max;
      if (ratio.min === undefined && ratio.max > 0) media.aspectRatio.min = 1 / ratio.max;
    }
  }
  const formats: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif', tiff: 'image/tiff', mp4: 'video/mp4', mov: 'video/quicktime', wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg' };
  if (Array.isArray(raw.format)) media.accept = raw.format.map((v: string) => formats[v.toLowerCase()]).filter(Boolean);
  return media;
}

export function legacySizeRules(raw: any): ParamDefinition['sizeRules'] {
  if (!raw || typeof raw !== 'object') return undefined;
  return Object.fromEntries(['minSide', 'maxSide', 'minTotalPixels', 'maxTotalPixels', 'minAspectRatio', 'maxAspectRatio', 'sizeSeparator'].filter(k => raw[k] !== undefined).map(k => [k, raw[k]]));
}

export function imageSizeError(value: string, rules: NonNullable<ParamDefinition['sizeRules']>): string | undefined {
  // Named provider presets such as 2K are checked by enum, custom sizes by geometry.
  if (!/\d\s*[x*]\s*\d/i.test(value)) return undefined;
  const match = value.match(rules.sizeSeparator === '*' ? /^(\d+)\*(\d+)$/ : /^(\d+)x(\d+)$/i);
  if (!match) return '自定义尺寸格式无效';
  const w = Number(match[1]), h = Number(match[2]);
  if (w <= 0 || h <= 0 || !Number.isSafeInteger(w * h)) return '自定义尺寸无效';
  const checks: Array<[number, number | undefined, boolean]> = [
    [Math.min(w, h), rules.minSide, true], [Math.max(w, h), rules.maxSide, false],
    [w * h, rules.minTotalPixels, true], [w * h, rules.maxTotalPixels, false],
    [w / h, rules.minAspectRatio, true], [w / h, rules.maxAspectRatio, false],
  ];
  return checks.some(([actual, bound, min]) => bound !== undefined && (min ? actual < bound : actual > bound)) ? '自定义尺寸超出边长、像素总数或宽高比限制' : undefined;
}
