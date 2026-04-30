/**
 * 将优先级数值 (0-100) 映射为标签和颜色
 * @param priority 优先级数值
 * @returns 标签和颜色对象
 */
export function priorityToLabel(priority: number): { label: string; color: string } {
  if (priority <= 33) return { label: '高', color: 'red' };
  if (priority <= 66) return { label: '中', color: 'orange' };
  return { label: '低', color: 'blue' };
}

/**
 * 格式化日期时间为中文本地化字符串
 * @param t ISO 日期字符串
 * @returns 格式化后的日期时间字符串，无效输入返回 '-'
 */
export function formatDateTime(t: string | null | undefined): string {
  return t ? new Date(t).toLocaleString('zh-CN') : '-';
}
