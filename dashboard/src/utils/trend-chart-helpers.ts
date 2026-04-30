/**
 * 趋势图表纯函数模块
 * 提供数据聚合、成功率计算、ECharts 图表配置生成等功能
 */

/** 后端返回的每日统计记录（按 featureType/provider/model 分组） */
export interface TaskDailyStatsRecord {
  date: string;
  featureType: string;
  provider: string;
  model: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  timeoutCount: number;
  cancelledCount: number;
}

/** 按日期聚合后的汇总数据 */
export interface DailySummary {
  date: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  timeoutCount: number;
  cancelledCount: number;
}

/**
 * 将多维度 TaskDailyStats 记录按日期聚合为 DailySummary 数组
 * 结果按日期升序排列
 */
export function aggregateDailySummary(records: TaskDailyStatsRecord[]): DailySummary[] {
  if (records.length === 0) return [];

  // 按日期分组聚合
  const map = new Map<string, DailySummary>();

  for (const record of records) {
    const existing = map.get(record.date);
    if (existing) {
      existing.totalCount += record.totalCount;
      existing.successCount += record.successCount;
      existing.failedCount += record.failedCount;
      existing.timeoutCount += record.timeoutCount;
      existing.cancelledCount += record.cancelledCount;
    } else {
      map.set(record.date, {
        date: record.date,
        totalCount: record.totalCount,
        successCount: record.successCount,
        failedCount: record.failedCount,
        timeoutCount: record.timeoutCount,
        cancelledCount: record.cancelledCount,
      });
    }
  }

  // 按日期升序排列
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 计算成功率百分比
 * 公式：successCount / (successCount + failedCount + timeoutCount + cancelledCount) * 100
 * 当分母为 0 时返回 0，返回值精确到小数点后一位
 */
export function calcSuccessRate(summary: DailySummary): number {
  const denominator = summary.successCount + summary.failedCount + summary.timeoutCount + summary.cancelledCount;
  if (denominator === 0) return 0;
  const rate = (summary.successCount / denominator) * 100;
  return Math.round(rate * 10) / 10;
}

/**
 * 生成任务量趋势折线图的 ECharts Option
 * 包含三条折线：总量（蓝色 #1890ff）、成功（绿色 #52c41a）、失败（红色 #ff4d4f）
 */
export function buildTaskVolumeOption(data: DailySummary[]): object {
  const dates = data.map((d) => d.date);

  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['总量', '成功', '失败'] },
    xAxis: { type: 'category', data: dates },
    yAxis: { type: 'value', name: '任务数量' },
    series: [
      {
        name: '总量',
        type: 'line',
        smooth: true,
        data: data.map((d) => d.totalCount),
        itemStyle: { color: '#1890ff' },
      },
      {
        name: '成功',
        type: 'line',
        smooth: true,
        data: data.map((d) => d.successCount),
        itemStyle: { color: '#52c41a' },
      },
      {
        name: '失败',
        type: 'line',
        smooth: true,
        data: data.map((d) => d.failedCount),
        itemStyle: { color: '#ff4d4f' },
      },
    ],
  };
}

/**
 * 生成成功率趋势折线图的 ECharts Option
 * 包含一条成功率折线（绿色 #52c41a）和 95% 基准线（红色虚线 markLine）
 * Y 轴固定 0-100
 */
export function buildSuccessRateOption(data: DailySummary[]): object {
  const dates = data.map((d) => d.date);
  const rates = data.map((d) => calcSuccessRate(d));

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const point = Array.isArray(params) ? params[0] : params;
        return `${point.axisValue}<br/>${point.seriesName}: ${point.value.toFixed(1)}%`;
      },
    },
    legend: { data: ['成功率'] },
    xAxis: { type: 'category', data: dates },
    yAxis: { type: 'value', name: '成功率(%)', min: 0, max: 100 },
    series: [
      {
        name: '成功率',
        type: 'line',
        smooth: true,
        data: rates,
        itemStyle: { color: '#52c41a' },
        markLine: {
          silent: true,
          data: [
            {
              yAxis: 95,
              label: { formatter: '95%' },
              lineStyle: { type: 'dashed', color: '#ff4d4f' },
            },
          ],
        },
      },
    ],
  };
}
