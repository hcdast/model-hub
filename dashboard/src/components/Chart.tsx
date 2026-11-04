import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsReactProps } from 'echarts-for-react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, TitleComponent, DataZoomComponent, MarkLineComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, TitleComponent, DataZoomComponent, MarkLineComponent, CanvasRenderer]);

/** Share only chart types used by the dashboard instead of loading the full ECharts bundle. */
export default function Chart(props: Omit<EChartsReactProps, 'echarts'>) {
  return <ReactEChartsCore {...props} echarts={echarts} />;
}
