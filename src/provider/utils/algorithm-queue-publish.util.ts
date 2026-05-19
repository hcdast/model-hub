/** 构建 POST /api/v1/task/publish 请求体（与 AGI algorithmCeleryApi 对齐） */
export function buildAlgorithmPublishBody(params: {
  algorithmFrom: string;
  algorithmType: string;
  taskName?: string;
  queueName?: string;
  priority?: number;
  data: Record<string, unknown>;
  webhookOverride?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    acceptVersion: 2,
    algorithmFrom: params.algorithmFrom,
    algorithmType: params.algorithmType,
    priority: params.priority ?? 0,
    data: params.data,
  };
  if (params.taskName) body.taskName = params.taskName;
  if (params.queueName) body.queueName = params.queueName;
  if (params.webhookOverride) body.webhookOverride = params.webhookOverride;
  return body;
}
