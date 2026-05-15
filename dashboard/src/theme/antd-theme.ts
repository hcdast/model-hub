import type { ThemeConfig } from 'antd';
import { theme } from 'antd';

export type DashboardThemeMode = 'light' | 'dark';

/** 品牌主色：电青，偏 AI / 中台气质 */
const COLOR_PRIMARY = '#0ea5e9';
const COLOR_INFO = '#6366f1';

const FONT_STACK =
  '"Plus Jakarta Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';

/**
 * 集中管理 Ant Design 主题：算法、全局 token、关键组件覆盖。
 * 明暗模式共用同一套品牌色，仅调整背景与菜单对比度。
 */
export function buildAntdTheme(mode: DashboardThemeMode): ThemeConfig {
  const isDark = mode === 'dark';

  return {
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: COLOR_PRIMARY,
      colorInfo: COLOR_INFO,
      borderRadius: 10,
      fontFamily: FONT_STACK,
      ...(isDark
        ? {
            colorBgLayout: '#0b1120',
          }
        : {
            colorBgLayout: '#f1f5f9',
          }),
    },
    components: {
      Layout: {
        headerHeight: 56,
        headerPadding: '0 20px',
        ...(isDark
          ? {
              bodyBg: '#0b1120',
              headerBg: '#0f172a',
            }
          : {
              bodyBg: '#f1f5f9',
              headerBg: '#ffffff',
            }),
      },
      Menu: {
        iconSize: 16,
        collapsedIconSize: 16,
        itemBorderRadius: 8,
        ...(isDark
          ? {
              darkItemBg: 'transparent',
              darkSubMenuItemBg: 'transparent',
              darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
              darkItemSelectedBg: 'rgba(14, 165, 233, 0.22)',
              darkItemSelectedColor: '#e0f2fe',
            }
          : {}),
      },
      Card: {
        borderRadiusLG: 12,
        paddingLG: 20,
      },
      Button: {
        controlHeight: 36,
        controlHeightLG: 40,
      },
    },
  };
}

export { COLOR_PRIMARY, COLOR_INFO };
