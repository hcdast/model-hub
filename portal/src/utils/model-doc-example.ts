import type { ParamDocItem } from '../types/model-params';

/** Examples describe the real task API, using only published input fields. */
export function buildModelInput(params: ParamDocItem[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const param of params) {
    if (param.hide || (!param.required && param.default === undefined && param.example === undefined)) continue;
    if (param.example !== undefined) input[param.name] = param.example;
    else if (param.default !== undefined) input[param.name] = param.default;
    else if (param.enum?.length) input[param.name] = param.enum[0];
    else if (param.type === 'boolean') input[param.name] = false;
    else if (param.type === 'integer' || param.type === 'number') input[param.name] = param.min ?? 1;
    else if (param.type === 'array') input[param.name] = Array.from({ length: Math.max(1, param.minItems || 0) }, () => param.items ? buildModelInput([{ ...param.items, name: 'item', required: true }]).item : '<replace with your input>');
    else if (param.type === 'object') input[param.name] = buildModelInput(Object.entries(param.properties || {}).map(([name, def]) => ({ ...def, name })));
    else input[param.name] = param.name.toLowerCase().includes('prompt') ? 'A cinematic landscape at golden hour' : '<replace with your input>';
  }
  return input;
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
export function buildModelExamples(modelId: string, modelType: string, params: ParamDocItem[], selection?: { input?: Record<string, unknown>; configId?: string; configRevision?: number }) {
  const body = { model_id: modelId, input: selection?.input || buildModelInput(params), options: { featureType: modelType,
    ...(selection?.configId ? { configId: selection.configId, configRevision: selection.configRevision || 0 } : {}) } };
  const json = JSON.stringify(body, null, 2);
  return {
    json,
    curl: `curl "$MODEL_HUB_BASE_URL/v1/tasks" \\\n  -H "X-API-Key: $MODEL_HUB_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  --data ${shellQuote(json)}`,
    python: `import json\nimport os\nimport requests\n\nresponse = requests.post(\n    os.environ["MODEL_HUB_BASE_URL"].rstrip("/") + "/v1/tasks",\n    headers={"X-API-Key": os.environ["MODEL_HUB_API_KEY"]},\n    json=json.loads(${JSON.stringify(json)}),\n    timeout=30,\n)\nresponse.raise_for_status()\nprint(response.json())`,
    poll: 'curl "$MODEL_HUB_BASE_URL/v1/tasks/$TASK_ID" \\\n  -H "X-API-Key: $MODEL_HUB_API_KEY"',
  };
}
