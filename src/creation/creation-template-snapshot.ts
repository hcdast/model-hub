import type { DramaPlan } from '../short-drama/drama.types';
import { normalizeDramaPlan } from '../short-drama/drama-plan';
import type { WorkflowDefinition } from '../database/schemas/workflow-template.schema';

/** Templates carry editable instructions, never personal media, results or execution credentials. */
export function dramaTemplateSnapshot(input: DramaPlan): DramaPlan {
  const plan = normalizeDramaPlan(input);
  plan.step = 0; plan.storyConfirmed = false; plan.castConfirmed = false; plan.storyboardConfirmed = false;
  plan.production = { provider: 'akool-maas', models: {} };
  delete plan.guide;
  for (const role of [...plan.characters, ...plan.scenes]) delete role.selected;
  for (const shot of plan.shots) {
    delete shot.image; delete shot.video; delete shot.voice;
    delete shot.captions; delete shot.captionSource; delete shot.trimStart;
  }
  delete plan.settings.music;
  return plan;
}

function portable(value: unknown, depth = 0): any {
  if (depth > 20) return undefined;
  if (typeof value === 'string') return /(?:https?:\/\/|data:|blob:|file:)/i.test(value) ? undefined : value;
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(v => portable(v, depth + 1)).filter(v => v !== undefined);
  if (typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/token|secret|password|api.?key|credential|asset.?id|candidate|output|billing|callback|__proto__|constructor|prototype/i.test(key),
  ).map(([key, v]) => [key, portable(v, depth + 1)]).filter(([, v]) => v !== undefined));
}

export function workflowTemplateSnapshot(input: WorkflowDefinition): WorkflowDefinition {
  return { name: input.name, description: input.description,
    nodes: input.nodes.map(node => ({ id: node.id, type: node.type, position: { ...node.position },
      data: portable(Object.fromEntries(['label', 'modelId', 'modelSelection', 'parameters', 'textDocument', 'messages', 'conditions', 'loopConfig', 'transform'].filter(key => key in node.data).map(key => [key, (node.data as any)[key]]))) })),
    edges: structuredClone(input.edges || []), viewport: input.viewport,
    inputSchema: Object.fromEntries(Object.entries(input.inputSchema || {}).map(([key, value]) => [key, { type: value.type, required: value.required }])),
    outputMapping: portable(input.outputMapping || {}), executionConfig: input.executionConfig,
  };
}
