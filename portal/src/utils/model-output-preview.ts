import type { ParamDefinition } from '../../../src/common/interfaces/param-definition.interface';

/** Read only declared media fields; keep the full result available in the JSON tab. */
export function modelOutputPreview(result: unknown, schema?: ParamDefinition): unknown {
  if (!schema) return result;
  const media: Record<string, string[]> = {};
  const collect = (value: unknown, def: ParamDefinition, depth: number) => {
    if (depth > 12 || value == null) return;
    if (def.media) {
      const urls = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string');
      media[def.media.kind] = [...(media[def.media.kind] || []), ...urls];
    } else if (def.type === 'array' && def.items && Array.isArray(value)) value.forEach(v => collect(v, def.items!, depth + 1));
    else if (def.type === 'object' && def.properties && typeof value === 'object' && !Array.isArray(value)) {
      for (const [field, child] of Object.entries(def.properties)) if (!child.hide) collect((value as Record<string, unknown>)[field], child, depth + 1);
    }
  };
  collect(result, schema, 0);
  return Object.keys(media).length ? media : result;
}
