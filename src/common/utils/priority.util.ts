/**
 * 将优先级数值 (0-100) 映射为中文标签。
 * 0-33 → 高，34-66 → 中，67-100 → 低
 * Bull 队列中数值越小优先级越高。
 */
export function priorityToLabel(priority: number): string {
  if (priority <= 33) return '高';
  if (priority <= 66) return '中';
  return '低';
}
