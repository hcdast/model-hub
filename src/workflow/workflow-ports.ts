import { WorkflowNode } from '../database/schemas/workflow.schema';

const structuralTypes: Record<string, true> = { input: true, output: true, condition: true, loop: true, transform: true };
export const isModelNode = (node: Pick<WorkflowNode, 'type'>): boolean => !Object.prototype.hasOwnProperty.call(structuralTypes, node.type);
export const isSafePort = (port: string): boolean =>
  typeof port === 'string' && port.length > 0 && port.length <= 100 && !['__proto__', 'constructor', 'prototype'].includes(port);

/** TaskService preserves structured output and normalizes bare URL strings to arrays. */
export function modelTaskOutput(taskId: string, result: unknown): Record<string, unknown> {
  const output: Record<string, unknown> = { taskId, result, output: result, json: result };
  const visit = (value: unknown, hint?: 'image' | 'video' | 'audio' | 'text', depth = 0): void => {
    if (depth > 8) return;
    if (typeof value === 'string') {
      if (hint === 'text') {
        if (output.text === undefined) output.text = value;
        return;
      }
      if (/^https?:\/\//i.test(value)) {
        let path: string;
        try { path = new URL(value).pathname.toLowerCase(); } catch { return; }
        const kind = hint ? hint
          : /\.(png|jpe?g|gif|webp|avif|bmp)$/.test(path) ? 'image'
          : /\.(mp4|webm|mov|m4v)$/.test(path) ? 'video'
          : /\.(mp3|wav|ogg|m4a|flac|aac)$/.test(path) ? 'audio' : undefined;
        if (kind && output[kind] === undefined) output[kind] = value;
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, hint, depth + 1);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    for (const [key, kind] of Object.entries({ text: 'text', image: 'image', image_url: 'image', video: 'video', video_url: 'video', audio: 'audio', audio_url: 'audio' }) as Array<[string, 'text' | 'image' | 'video' | 'audio']>) {
      if (Object.prototype.hasOwnProperty.call(record, key)) visit(record[key], kind, depth + 1);
    }
    for (const key of ['output', 'outputs', 'results', 'url']) {
      if (Object.prototype.hasOwnProperty.call(record, key)) visit(record[key], hint, depth + 1);
    }
  };
  visit(result);
  return output;
}

/** Only documented legacy aliases may represent a whole upstream value. */
export function readOutputPort(node: Pick<WorkflowNode, 'type'> & Partial<Pick<WorkflowNode, 'data'>>, output: Record<string, unknown> | undefined, port: string): unknown {
  if (!isSafePort(port)) throw new Error(`非法输出端口: ${port}`);
  if (!output) throw new Error(`上游节点没有输出: ${port}`);
  if (node.type === 'loop' && node.data?.loopConfig?.outputMode === 'last' && port === 'value' && output.__workflowLoopOutput === 1) {
    const result = Object.prototype.hasOwnProperty.call(output, 'result') ? output.result : undefined;
    if (result !== undefined) {
      if (result === null || typeof result !== 'object' || Array.isArray(result)) return result;
      if (Object.prototype.hasOwnProperty.call(result, 'value') && (result as Record<string, unknown>).value !== undefined) return (result as Record<string, unknown>).value;
    }
    throw new Error(`上游缺少输出端口: ${port}`);
  }
  if (node.type === 'loop' && node.data?.loopConfig?.outputMode === 'last' && ['result', 'output'].includes(port)) {
    if (output.__workflowLoopOutput === 1 && Object.prototype.hasOwnProperty.call(output, 'result')) return output.result;
    // Legacy executor wrapped scalars as exactly { value }; that old shape cannot distinguish a single-key business object.
    // All new last results use the versioned envelope, including objects with value/result/output business keys.
    if (Object.keys(output).length === 1 && Object.prototype.hasOwnProperty.call(output, 'value')) return output.value;
    return output;
  }
  if (Object.prototype.hasOwnProperty.call(output, port) && output[port] !== undefined) return output[port];
  if (isModelNode(node) && ['output', 'json'].includes(port) && Object.prototype.hasOwnProperty.call(output, 'result')) return output.result;
  if (node.type === 'input' && port === 'output') return output;
  if (node.type === 'transform' && port === 'output') return Object.prototype.hasOwnProperty.call(output, 'value') ? output.value : output;
  if (node.type === 'loop' && ['result', 'output'].includes(port) && Object.prototype.hasOwnProperty.call(output, 'results')) return output.results;
  if (node.type === 'loop' && ['result', 'output'].includes(port) && Object.prototype.hasOwnProperty.call(output, 'value')) return output.value;
  if (node.type === 'condition' && (port === 'default' || port === output.branchId)) return output;
  throw new Error(`上游缺少输出端口: ${port}`);
}

export function assignPortInput(input: Record<string, unknown>, node: Pick<WorkflowNode, 'type'>, port: string, value: unknown): void {
  if (!isSafePort(port)) throw new Error(`非法输入端口: ${port}`);
  if (value === undefined) throw new Error(`输入端口缺少值: ${port}`);
  if (isModelNode(node) && port === 'input') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模型 input 端口需要参数对象');
    for (const [key, item] of Object.entries(value)) {
      if (!isSafePort(key)) throw new Error(`非法模型参数: ${key}`);
      if (key === 'prompt' && typeof item !== 'string') throw new Error('模型 prompt 端口需要文本，不能接收对象或数组');
      input[key] = item;
    }
    return;
  }
  if (isModelNode(node) && port === 'prompt' && typeof value !== 'string') throw new Error('模型 prompt 端口需要文本，不能接收对象或数组');
  if (node.type === 'loop' && port === 'array' && !Array.isArray(value)) throw new Error('循环 array 端口需要数组');
  input[port] = value;
}
