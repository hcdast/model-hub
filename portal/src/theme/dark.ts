import { theme } from 'antd';
import type { ThemeConfig } from 'antd';

// 设计 Token
export const tokens = {
  // 背景色
  bg: {
    primary: '#0a0a0f',
    secondary: '#12121e',
    tertiary: '#16162a',
    elevated: '#1e1e35',
    hover: '#252545',
  },

  // 强调色
  accent: {
    primary: '#6366f1',      // 靛蓝紫
    primaryHover: '#818cf8',
    secondary: '#22d3ee',    // 青色
    secondaryHover: '#67e8f9',
    gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%)',
    gradientHover: 'linear-gradient(135deg, #818cf8 0%, #a78bfa 50%, #c4b5fd 100%)',
  },

  // 状态色
  status: {
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
    draft: '#94a3b8',
    active: '#22c55e',
    archived: '#6b7280',
  },

  // 文字色
  text: {
    primary: '#e2e8f0',
    secondary: '#94a3b8',
    tertiary: '#64748b',
    disabled: '#475569',
    inverse: '#0f172a',
  },

  // 边框色
  border: {
    default: 'rgba(255, 255, 255, 0.06)',
    hover: 'rgba(255, 255, 255, 0.12)',
    focus: 'rgba(99, 102, 241, 0.5)',
    accent: 'rgba(99, 102, 241, 0.3)',
  },

  // 阴影
  shadow: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
    md: '0 4px 12px rgba(0, 0, 0, 0.4)',
    lg: '0 8px 24px rgba(0, 0, 0, 0.5)',
    xl: '0 16px 48px rgba(0, 0, 0, 0.6)',
    glow: '0 0 20px rgba(99, 102, 241, 0.3)',
    glowLg: '0 0 40px rgba(99, 102, 241, 0.4)',
  },

  // 圆角
  radius: {
    sm: '6px',
    md: '10px',
    lg: '14px',
    xl: '20px',
    full: '9999px',
  },

  // 间距
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    xxl: '48px',
  },

  // 字体
  font: {
    family: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    size: {
      xs: '11px',
      sm: '12px',
      base: '14px',
      md: '16px',
      lg: '20px',
      xl: '24px',
      xxl: '32px',
      hero: '48px',
    },
    weight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
  },
};

// Ant Design 主题配置
export const antTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: tokens.accent.primary,
    colorSuccess: tokens.status.success,
    colorWarning: tokens.status.warning,
    colorError: tokens.status.error,
    colorInfo: tokens.status.info,

    colorBgBase: tokens.bg.primary,
    colorBgContainer: tokens.bg.tertiary,
    colorBgElevated: tokens.bg.elevated,
    colorBgLayout: tokens.bg.primary,

    colorText: tokens.text.primary,
    colorTextSecondary: tokens.text.secondary,
    colorTextTertiary: tokens.text.tertiary,
    colorTextDisabled: tokens.text.disabled,

    colorBorder: tokens.border.default,
    colorBorderSecondary: tokens.border.default,

    borderRadius: 10,
    fontFamily: tokens.font.family,
    fontSize: 14,

    // 按钮
    controlHeight: 36,
    controlHeightLG: 44,
    controlHeightSM: 28,

    // 链接
    colorLink: tokens.accent.primary,
    colorLinkHover: tokens.accent.primaryHover,
  },
  components: {
    Button: {
      primaryShadow: 'none',
      defaultShadow: 'none',
      defaultBg: tokens.bg.elevated,
      defaultBorderColor: tokens.border.default,
      defaultHoverBg: tokens.bg.hover,
      defaultHoverBorderColor: tokens.border.hover,
    },
    Card: {
      colorBgContainer: tokens.bg.tertiary,
      colorBorderSecondary: tokens.border.default,
    },
    Input: {
      colorBgContainer: tokens.bg.secondary,
      activeBorderColor: tokens.accent.primary,
    },
    Select: {
      colorBgContainer: tokens.bg.secondary,
    },
    Table: {
      colorBgContainer: tokens.bg.tertiary,
      headerBg: tokens.bg.secondary,
      rowHoverBg: tokens.bg.hover,
    },
    Modal: {
      contentBg: tokens.bg.elevated,
      headerBg: tokens.bg.elevated,
    },
    Drawer: {
      colorBgElevated: tokens.bg.elevated,
    },
    Menu: {
      darkItemBg: 'transparent',
      darkSubMenuItemBg: 'transparent',
      darkItemSelectedBg: tokens.bg.hover,
      darkItemHoverBg: tokens.bg.hover,
    },
    Tag: {
      defaultBg: tokens.bg.elevated,
      defaultColor: tokens.text.secondary,
    },
  },
};

export default tokens;
